// api/cron/check-prices.js
// GitHub Actionsから3時間おきに呼び出される価格・在庫チェック処理

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

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractFromJsonLd(html) {
  const result = { price: null };
  const scriptMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scriptMatches) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const product = item['@type'] === 'Product' ? item : item['@graph']?.find?.((n) => n['@type'] === 'Product');
        if (!product) continue;
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (offer?.price != null) {
          const num = parseInt(String(offer.price).replace(/[^\d]/g, ''), 10);
          if (!isNaN(num)) result.price = num;
        }
      }
    } catch {
      // 不正なJSON-LDは無視
    }
    if (result.price != null) break;
  }
  return result;
}

async function extractInfoWithAI(html) {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const pageText = htmlToText(html).slice(0, 15000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `以下は商品ページのテキストです。この商品について次の2点を抽出し、次のJSON形式だけで回答してください。他の説明やテキストは一切不要です。

1. price: 現在の販売価格（数値のみ、カンマや円記号を含めない半角数字）。見つからない場合はnull。
2. stockStatus: 在庫状況を必ず次の4つのいずれか1つの文字列で答えてください。
   - "in_stock" （在庫あり、特に在庫に関する言及がない場合もこれ）
   - "low_stock" （「残りわずか」「残り○点」「あと○個」「残り1点」など、在庫が少ないことを示す表記がある場合）
   - "out_of_stock" （「売り切れ」「在庫切れ」「販売終了」「入荷待ち」など、購入できない状態を示す表記がある場合）
   - "unknown" （ページから在庫状況が全く判断できない場合）

{"price": 12800, "stockStatus": "in_stock"}

${pageText}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }

    let price = null;
    if (parsed.price !== null && parsed.price !== undefined) {
      const priceNum = parseInt(String(parsed.price).replace(/[^\d]/g, ''), 10);
      price = isNaN(priceNum) ? null : priceNum;
    }

    const validStatuses = ['in_stock', 'low_stock', 'out_of_stock', 'unknown'];
    const stockStatus = validStatuses.includes(parsed.stockStatus) ? parsed.stockStatus : 'unknown';

    return { price, stockStatus };
  } catch {
    return null;
  }
}

function decodeBody(buffer, contentType) {
  const headerCs = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  const metaCs = /charset=["']?([\w-]+)/i.exec(buffer.slice(0, 4096).toString('latin1'))?.[1];
  let label = (headerCs || metaCs || 'utf-8').toLowerCase();
  if (/^(shift[-_]?jis|sjis|x-sjis|ms932|windows-31j)$/.test(label)) label = 'shift_jis';
  else if (/^euc[-_]?jp$/.test(label)) label = 'euc-jp';
  try { return new TextDecoder(label).decode(buffer); } catch { return new TextDecoder('utf-8').decode(buffer); }
}

function extractFromMeta(html) {
  const get = (attr, name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = html.match(new RegExp(`<meta[^>]*(?:${attr}=["']${esc}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*${attr}=["']${esc}["'])`, 'i'));
    return (m && (m[1] || m[2])) || '';
  };
  const priceRaw = get('name', 'product:price:amount') || get('property', 'product:price:amount') || get('property', 'og:price:amount') || get('name', 'og:price:amount') || get('itemprop', 'price');
  const priceNum = priceRaw ? parseInt(String(priceRaw).replace(/[^\d]/g, ''), 10) : NaN;
  const av = (get('itemprop', 'availability') || get('property', 'product:availability') || get('name', 'availability')).toLowerCase();
  let stockStatus = 'unknown';
  if (/outofstock|soldout|out of stock|在庫切れ|売り切れ|完売/.test(av)) stockStatus = 'out_of_stock';
  else if (/instock|in stock|在庫あり|販売中|購入可能/.test(av)) stockStatus = 'in_stock';
  return { price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null, stockStatus };
}

async function fetchCurrentInfo(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9',
      },
    });
    if (!r.ok) return null;
    const html = decodeBody(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type'));

    const jsonLdResult = extractFromJsonLd(html);
    const metaResult = extractFromMeta(html);

    let price = jsonLdResult.price ?? metaResult.price ?? null;
    let stockStatus = metaResult.stockStatus;

    if (price === null || stockStatus === 'unknown') {
      const aiInfo = await extractInfoWithAI(html);
      if (price === null) price = aiInfo?.price ?? null;
      if (stockStatus === 'unknown') stockStatus = aiInfo?.stockStatus ?? 'unknown';
    }

    return { price, stockStatus };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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

async function notify(userId, payload) {
  const { pushed } = await sendPushToUser(userId, payload);
  if (!pushed) {
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (email) await sendFallbackEmail(email, payload);
  }
  return pushed;
}

const STOCK_LABEL = {
  low_stock: '残りわずか',
  out_of_stock: '在庫切れ',
};

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, user_id, name, product_url, current_price, stock_status')
    .eq('purchased', false)
    .eq('price_check_enabled', true)
    .not('product_url', 'is', null);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const results = [];

  for (const product of products) {
    const info = await fetchCurrentInfo(product.product_url);

    if (info === null) {
      results.push({ id: product.id, status: 'fetch_failed' });
      continue;
    }

    const { price: newPrice, stockStatus: newStockStatus } = info;
    const prevStockStatus = product.stock_status || 'unknown';
    const notifications = [];

    // --- 価格チェック ---
    if (newPrice !== null && newPrice !== product.current_price) {
      await supabaseAdmin.from('price_history').insert({
        product_id: product.id,
        price: newPrice,
        checked_at: new Date().toISOString(),
        source: 'auto_check',
      });

      if (newPrice < product.current_price) {
        const diff = product.current_price - newPrice;
        notifications.push({
          title: '♡ 値下がりしました',
          body: `${product.name}が安くなりました\n¥${product.current_price.toLocaleString()} → ¥${newPrice.toLocaleString()}（¥${diff.toLocaleString()} OFF）`,
          url: `/products/${product.id}`,
        });
      }
    }

    // --- 在庫チェック ---
    // in_stock/unknown → low_stock/out_of_stock に変わった時だけ通知(毎回は送らない)
    const stockGotWorse =
      (newStockStatus === 'low_stock' || newStockStatus === 'out_of_stock') &&
      prevStockStatus !== newStockStatus &&
      prevStockStatus !== 'out_of_stock';

    if (stockGotWorse) {
      notifications.push({
        title: newStockStatus === 'out_of_stock' ? '△ 在庫切れになりました' : '△ 残りわずかです',
        body: `${product.name}が${STOCK_LABEL[newStockStatus]}になりました。お早めにご確認ください。`,
        url: `/products/${product.id}`,
      });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (newPrice !== null) updates.current_price = newPrice;
    if (newStockStatus && newStockStatus !== 'unknown') updates.stock_status = newStockStatus;

    await supabaseAdmin.from('products').update(updates).eq('id', product.id);

    let pushedAny = false;
    for (const payload of notifications) {
      const pushed = await notify(product.user_id, payload);
      pushedAny = pushedAny || pushed;
    }

    results.push({
      id: product.id,
      status: notifications.length > 0 ? 'notified' : 'unchanged',
      notifiedCount: notifications.length,
      stockStatus: newStockStatus,
      pushed: pushedAny,
    });
  }

  return res.status(200).json({ checked: products.length, results });
}
