// api/cron/check-prices.js
// Vercel Cronから1日1回呼び出される価格チェック処理

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  'mailto:you@example.com', // 適宜自分の連絡先メールに変更してください
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function extractPriceWithAI(html) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[AI_DEBUG] GEMINI_API_KEY is not set');
    return null;
  }

  try {
    const cleanedHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .slice(0, 20000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `以下は商品ページのHTMLです。この商品の現在の販売価格を半角数字のみで答えてください（例: 12800）。カンマや円記号は不要です。価格が見つからない場合は「null」と答えてください。説明や他の文章は一切含めないでください。\n\n${cleanedHtml}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.log('[AI_DEBUG] gemini error:', response.status, errText.slice(0, 300));
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text || /null/i.test(text)) return null;

    const num = parseInt(text.replace(/[^\d]/g, ''), 10);
    return isNaN(num) ? null : num;
  } catch (e) {
    console.log('[AI_DEBUG] exception:', e.message);
    return null;
  }
}

async function fetchCurrentPrice(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9',
      },
    });
    const html = await r.text();

    console.log('[FETCH_DEBUG] url:', url, 'html length:', html.length, 'http status:', r.status);

    const aiPrice = await extractPriceWithAI(html);
    console.log('[FETCH_DEBUG] AI returned:', aiPrice);
    return aiPrice;
  } catch (e) {
    console.log('[FETCH_DEBUG] exception:', e.message);
    return null;
  }
}

async function sendPushToUser(userId, payload) {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) {
    return { pushed: false };
  }

  let anySuccess = false;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      );
      anySuccess = true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  return { pushed: anySuccess };
}

async function sendFallbackEmail(userEmail, payload) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'wishlist@yourdomain.com',
        to: userEmail,
        subject: payload.title,
        html: `<p>${payload.body}</p>`,
      }),
    });
  } catch (e) {
    // メール失敗は握りつぶす(次回チェックで再試行される想定)
  }
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, user_id, name, product_url, current_price')
    .eq('purchased', false)
    .eq('price_check_enabled', true)
    .not('product_url', 'is', null);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const results = [];

  for (const product of products) {
    const newPrice = await fetchCurrentPrice(product.product_url);

    if (newPrice === null) {
      results.push({ id: product.id, status: 'fetch_failed' });
      continue;
    }

    if (newPrice === product.current_price) {
      results.push({ id: product.id, status: 'unchanged' });
      continue;
    }

    await supabaseAdmin.from('price_history').insert({
      product_id: product.id,
      price: newPrice,
      checked_at: new Date().toISOString(),
      source: 'auto_check',
    });

    await supabaseAdmin
      .from('products')
      .update({ current_price: newPrice, updated_at: new Date().toISOString() })
      .eq('id', product.id);

    if (newPrice < product.current_price) {
      const diff = product.current_price - newPrice;
      const payload = {
        title: '♡ 値下がりしました',
        body: `${product.name}が安くなりました\n¥${product.current_price.toLocaleString()} → ¥${newPrice.toLocaleString()}（¥${diff.toLocaleString()} OFF）`,
        url: `/products/${product.id}`,
      };

      const { pushed } = await sendPushToUser(product.user_id, payload);

      if (!pushed) {
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(
          product.user_id
        );
        const email = userData?.user?.email;
        if (email) await sendFallbackEmail(email, payload);
      }

      results.push({ id: product.id, status: 'price_drop_notified', pushed });
    } else {
      results.push({ id: product.id, status: 'price_increased_no_notify' });
    }
  }

  return res.status(200).json({ checked: products.length, results });
}