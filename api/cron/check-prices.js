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

    const host = new URL(url).hostname;
    let price = null;

    if (/amazon\.co\.jp|amazon\.com/i.test(host)) {
      const m =
        html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\d,]+)/i) ||
        html.match(/"priceAmount"\s*:\s*([\d.]+)/i);
      if (m) price = m[1].replace(/,/g, '');
    } else if (/rakuten\.co\.jp/i.test(host)) {
      const m = html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i);
      if (m) price = m[1].replace(/,/g, '');
    } else if (/zozo\.jp/i.test(host)) {
      const m = html.match(/class=["'][^"']*p-goods-price[^"']*["'][^>]*>[^\d]*([\d,]+)/i);
      if (m) price = m[1].replace(/,/g, '');
    } else if (/qoo10\.jp/i.test(host)) {
      const m =
        html.match(/class=["'][^"']*price_real[^"']*["'][^>]*>[^\d]*([\d,]+)/i) ||
        html.match(/"salePrice"\s*:\s*"?([\d,.]+)"?/i);
      if (m) price = m[1].replace(/,/g, '');
    }

    if (!price) {
      const m = html.match(
        /<meta[^>]*(?:property|name)=["'](?:product:price:amount|price)["'][^>]*content=["']([\d.,]+)["']/i
      );
      if (m) price = m[1].replace(/,/g, '');
    }

    return price ? Math.round(parseFloat(price)) : null;
  } catch (e) {
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
        title: '\u2661 \u5024\u4e0b\u304c\u308a\u3057\u307e\u3057\u305f',
        body: `${product.name}\u304c\u5b89\u304f\u306a\u308a\u307e\u3057\u305f\n\u00a5${product.current_price.toLocaleString()} \u2192 \u00a5${newPrice.toLocaleString()}\uff08\u00a5${diff.toLocaleString()} OFF\uff09`,
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
