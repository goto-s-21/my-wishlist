// api/cron/check-prices.js
// 定期的に呼び出される価格・在庫チェック。値下がり/在庫悪化をプッシュ通知する。
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { fetchHtml } from '../_lib/http.js';
import { extractProductInfo, htmlToText } from '../_lib/extract.js';
import { callGeminiJson } from '../_lib/gemini.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  'mailto:you@example.com', // 適宜自分の連絡先メールに変更してください
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// 共有の availability 語彙を、このcronが使う stock_status 語彙へ寄せる。
// （low_stock はテキストからのみ判定できるため、決定的抽出では limited→low_stock とする）
function toStockStatus(availability) {
  if (availability === 'out_of_stock') return 'out_of_stock';
  if (availability === 'limited') return 'low_stock';
  if (availability === 'in_stock') return 'in_stock';
  return 'unknown'; // pre_order / unknown
}

// 決定的抽出で埋まらないときだけ、在庫の細かい状態(low_stock)まで含めてAIに尋ねる。
async function aiStock(html) {
  const prompt = `以下は商品ページの本文です。price（現在の販売価格・整数またはnull）と stockStatus を JSON だけで返してください。stockStatus は次のいずれか: "in_stock"（在庫あり・言及なしもこれ） / "low_stock"（残りわずか・残り○点など） / "out_of_stock"（売り切れ・在庫切れ・入荷待ち等） / "unknown"。\n{"price":12800,"stockStatus":"in_stock"}\n${htmlToText(html).slice(0, 15000)}`;
  const parsed = await callGeminiJson(prompt);
  if (!parsed) return null;
  let price = null;
  if (parsed.price !== null && parsed.price !== undefined) {
    const n = parseInt(String(parsed.price).replace(/[^\d]/g, ''), 10);
    price = Number.isFinite(n) && n > 0 ? n : null;
  }
  const valid = ['in_stock', 'low_stock', 'out_of_stock', 'unknown'];
  return { price, stockStatus: valid.includes(parsed.stockStatus) ? parsed.stockStatus : 'unknown' };
}

async function fetchCurrentInfo(url) {
  try {
    const { html, blocked } = await fetchHtml(url);
    if (blocked) return null;

    const info = extractProductInfo(html);
    let price = info.price;
    let stockStatus = toStockStatus(info.availability);

    if (price === null || stockStatus === 'unknown') {
      const ai = await aiStock(html);
      if (price === null) price = ai?.price ?? null;
      if (stockStatus === 'unknown') stockStatus = ai?.stockStatus ?? 'unknown';
    }

    return { price, stockStatus };
  } catch {
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
