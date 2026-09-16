import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
webpush.setVapidDetails(
  'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function extractPrice(html, host) {
  const clean = (s) => (s ? s.replace(/,/g, '') : s);

  if (/amazon\.co\.jp|amazon\.com/i.test(host)) {
    const m =
      html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\d,]+)/i) ||
      html.match(/"priceAmount"\s*:\s*([\d.]+)/i);
    return m ? clean(m[1]) : null;
  }
  if (/rakuten\.co\.jp/i.test(host)) {
    const m =
      html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i) ||
      html.match(/<meta[^>]*property=["']og:price:amount["'][^>]*content=["']([\d.,]+)["']/i);
    return m ? clean(m[1]) : null;
  }
  if (/zozo\.jp/i.test(host)) {
    const m = html.match(/class=["'][^"']*p-goods-price[^"']*["'][^>]*>[^\d]*([\d,]+)/i);
    return m ? clean(m[1]) : null;
  }
  if (/mercari\.com/i.test(host)) {
    const m = html.match(/"price"\s*:\s*"?(\d+)"?/i);
    return m ? m[1] : null;
  }
  if (/qoo10\.jp/i.test(host)) {
    const m =
      html.match(/class=["'][^"']*price_real[^"']*["'][^>]*>[^\d]*([\d,]+)/i) ||
      html.match(/"salePrice"\s*:\s*"?([\d,.]+)"?/i);
    return m ? clean(m[1]) : null;
  }
  const m = html.match(/<meta[^>]*(?:property|name)=["'](?:og:price:amount|product:price:amount|price)["'][^>]*content=["']([\d.,]+)["']/i);
  return m ? clean(m[1]) : null;
}

async function fetchCurrentPrice(url) {
  const host = (() => {
    try { return new URL(url).hostname; } catch { return ''; }
  })();
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  const html = await r.text();
  const price = extractPrice(html, host);
  return price ? Math.round(parseFloat(price)) : null;
}

async function notify(userId, product, previousPrice, newPrice) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  const title = '♡ 値下がりしました';
  const body = `${product.name}が安くなりました\n¥${previousPrice} → ¥${newPrice}（¥${previousPrice - newPrice} OFF）`;
  const pushPayload = JSON.stringify({ title, body, url: `/product/${product.id}` });

  let pushSucceeded = false;
  if (subs && subs.length > 0) {
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          pushPayload
        );
        pushSucceeded = true;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
        }
      }
    }
  }

  // プッシュが1件も送れなかった場合のみ、メールにフォールバックする。
  if (!pushSucceeded && resend) {
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (email) {
      try {
        await resend.emails.send({
          from: 'onboarding@resend.dev',
          to: email,
          subject: `値下がり: ${product.name}`,
          text: `${body}\n\n商品ページ: ${product.product_url}`,
        });
      } catch (e) {
        // メール送信失敗は握りつぶす。次回のチェックで再度通知を試みる。
      }
    }
  }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('purchased', false)
    .eq('price_check_enabled', true)
    .not('product_url', 'is', null);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  let checked = 0;
  let dropped = 0;
  let failed = 0;

  for (const p of products || []) {
    checked++;
    try {
      const newPrice = await fetchCurrentPrice(p.product_url);
      if (newPrice === null) {
        failed++;
        continue; // このサイトは価格を取得できない → 次回のチェックに持ち越し
      }
      if (p.current_price != null && newPrice < p.current_price) {
        const previousPrice = p.current_price;
        await supabase.from('products').update({ current_price: newPrice, updated_at: new Date().toISOString() }).eq('id', p.id);
        await supabase.from('price_history').insert({ product_id: p.id, price: newPrice, source: 'auto' });
        await notify(p.user_id, p, previousPrice, newPrice);
        dropped++;
      } else if (p.current_price == null) {
        // 初回チェックで初めて価格が判明した場合は履歴に追加するが、通知はしない。
        await supabase.from('products').update({ current_price: newPrice, updated_at: new Date().toISOString() }).eq('id', p.id);
        await supabase.from('price_history').insert({ product_id: p.id, price: newPrice, source: 'auto' });
      }
      // 価格が上がった、または変わらない場合は何もしない(通知しない、履歴も増やさない)。
    } catch (e) {
      failed++; // 取得失敗 → 次回のチェックで再試行
    }
  }

  res.status(200).json({ checked, dropped, failed });
}
