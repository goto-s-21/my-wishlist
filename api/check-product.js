// api/check-product.js
// 商品詳細の「今すぐ確認」ボタン用。認証必須・本人の商品のみ・1分に1回まで。
import { createClient } from '@supabase/supabase-js';
import { cleanProductUrl, fetchHtml } from './_lib/http.js';
import { extractProductInfo, buildAiContext, sanePrice } from './_lib/extract.js';
import { callGeminiJson } from './_lib/gemini.js';

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const AVAILABILITY_VALUES = ['in_stock', 'out_of_stock', 'pre_order', 'limited', 'unknown'];

// 決定的抽出で価格・在庫が取れなかったときだけ呼ぶAIフォールバック。
// 登録時(fetch-product-info)・cron と同じ経路で、JSON-LD/metaを出さないサイトの取りこぼしを減らす。
async function aiFallback(html) {
  const prompt = `商品ページの抽出候補から現在価格、在庫状態を抽出してください。JSONのみで返してください。priceは整数またはnull、availabilityはin_stock/out_of_stock/pre_order/limited/unknownのいずれかです。送料、ポイント、クーポン、月額、型番、商品コードは価格にしないでください。\n{"price":5390,"availability":"in_stock"}\n候補:\n${buildAiContext(html)}`;
  const parsed = await callGeminiJson(prompt);
  if (!parsed) return null;
  return {
    price: sanePrice(parsed.price),
    availability: AVAILABILITY_VALUES.includes(parsed.availability) ? parsed.availability : 'unknown',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const url = cleanProductUrl(req.body?.url || req.query?.url);
  if (!url) return res.status(400).json({ error: '有効なURLを指定してください' });

  try {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(req.headers.authorization?.replace(/^Bearer\s+/i, ''));
    if (userError || !user) return res.status(401).json({ error: 'ログインが必要です' });

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('id,user_id,product_url,current_price')
      .eq('user_id', user.id)
      .eq('product_url', url)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) return res.status(404).json({ error: '商品が見つかりません' });

    // 同一商品の連打を抑止（1分に1回）
    const { data: recent } = await supabaseAdmin
      .from('manual_price_checks')
      .select('checked_at')
      .eq('product_id', product.id)
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent && Date.now() - new Date(recent.checked_at).getTime() < 60000) {
      return res.status(429).json({ error: '同じ商品は1分に1回まで確認できます', retryAfter: 60 });
    }

    const { html, finalUrl, blocked } = await fetchHtml(product.product_url);
    if (blocked) return res.status(502).json({ error: '価格・在庫を確認できませんでした', detail: '販売サイトにアクセスをブロックされました' });

    let { price, availability } = extractProductInfo(html);

    // 決定的抽出で価格も在庫も取れなければ、登録時・cronと同じAIフォールバックで補う。
    if (price === null && availability === 'unknown') {
      const ai = await aiFallback(html);
      if (ai) {
        if (ai.price !== null) price = ai.price;
        if (ai.availability !== 'unknown') availability = ai.availability;
      }
    }

    const now = new Date().toISOString();
    const oldPrice = product.current_price;
    const updates = { last_checked_at: now, last_check_status: 'success', availability };
    if (price !== null) updates.current_price = price;
    const { error: updateError } = await supabaseAdmin.from('products').update(updates).eq('id', product.id).eq('user_id', user.id);
    if (updateError) throw updateError;

    if (price !== null && price !== oldPrice) {
      await supabaseAdmin.from('price_history').insert({ product_id: product.id, price, checked_at: now, source: 'manual_check' });
    }
    await supabaseAdmin.from('manual_price_checks').insert({ product_id: product.id, user_id: user.id, checked_at: now, status: 'success', price, availability });

    return res.status(200).json({ productId: product.id, price, availability, checkedAt: now, previousPrice: oldPrice, finalUrl });
  } catch (error) {
    console.error('[MANUAL_CHECK_ERROR]', error.message);
    return res.status(502).json({ error: '価格・在庫を確認できませんでした', detail: error.message });
  }
}
