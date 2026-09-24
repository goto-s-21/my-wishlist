import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(value) {
  return decodeHtml(String(value || '').replace(/\\u0026/g, '&').trim());
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function mapAvailability(value) {
  const text = String(value || '').toLowerCase();
  if (/outofstock|soldout|out of stock|在庫切れ|売り切れ|完売/.test(text)) return 'out_of_stock';
  if (/preorder|pre-order|予約/.test(text)) return 'pre_order';
  if (/limitedavailability|残りわずか|残り僅か/.test(text)) return 'limited';
  if (/instock|in stock|在庫あり|販売中|購入可能/.test(text)) return 'in_stock';
  return 'unknown';
}

function extractJsonLd(html) {
  const results = [];
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script.replace(/^<[\s\S]*?>|<\/script>$/gi, '').trim();
    try {
      const parsed = JSON.parse(body.replace(/<!--|-->/g, '').trim());
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (value?.['@graph']) results.push(...value['@graph']);
        else results.push(value);
      }
    } catch {
      // Some sites emit invalid JSON-LD; continue with other extractors.
    }
  }
  return results;
}

function findProductData(html) {
  const jsonLd = extractJsonLd(html);
  const product = jsonLd.find((item) => {
    const type = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
    return type.some((entry) => String(entry).toLowerCase() === 'product');
  });
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const price = parseNumber(offer?.price ?? offer?.lowPrice ?? product?.price);
  const availability = mapAvailability(offer?.availability ?? product?.availability);
  const title = cleanText(product?.name);
  if (price !== null || availability !== 'unknown' || title) {
    return { title: title || null, price, availability };
  }
  return null;
}

function getMeta(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<meta[^>]*(?:${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*${attribute}=["']${escaped}["'])`, 'i');
  const match = html.match(regex);
  return cleanText(match?.[1] || match?.[2] || '');
}

function findMetaData(html) {
  const title = getMeta(html, 'property', 'og:title') || getMeta(html, 'name', 'twitter:title');
  const price = parseNumber(
    getMeta(html, 'property', 'product:price:amount') ||
      getMeta(html, 'property', 'og:price:amount')
  );
  const availability = mapAvailability(
    getMeta(html, 'property', 'product:availability') || getMeta(html, 'name', 'availability')
  );
  if (title || price !== null || availability !== 'unknown') {
    return { title: title || null, price, availability };
  }
  return null;
}

function scanVisibleText(html) {
  const text = cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
  const priceMatch = text.match(/(?:¥|￥|価格|税込|販売価格)\s*([\d,]+)\s*円?/i);
  const availability = mapAvailability(text);
  if (priceMatch || availability !== 'unknown') {
    return {
      title: null,
      price: parseNumber(priceMatch?.[1]),
      availability,
    };
  }
  return null;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WishlistPriceChecker/1.0)',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (!response.ok) throw new Error(`販売サイトがHTTP ${response.status}を返しました`);
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error('商品ページが大きすぎます');
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithAi(html) {
  if (!process.env.GEMINI_API_KEY) return null;
  const cleanedHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').slice(0, 20000);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `商品ページHTMLから、商品価格と在庫状態をJSONだけで抽出してください。priceは数値、availabilityはin_stock/out_of_stock/pre_order/limited/unknownのいずれかにしてください。\n{"price":2980,"availability":"in_stock"}\n見つからない値はnullまたはunknownにしてください。\n${cleanedHtml}` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return {
      title: null,
      price: parseNumber(parsed.price),
      availability: ['in_stock', 'out_of_stock', 'pre_order', 'limited', 'unknown'].includes(parsed.availability) ? parsed.availability : 'unknown',
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const productId = req.body?.productId;
  const rawUrl = req.body?.url || req.query?.url;
  const url = rawUrl ? normalizeUrl(rawUrl) : null;
  if (!productId && !url) return res.status(400).json({ error: '商品IDまたは有効なURLを指定してください' });

  try {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(req.headers.authorization?.replace(/^Bearer\s+/i, ''));
    if (userError || !user) return res.status(401).json({ error: 'ログインが必要です' });

    let productQuery = supabaseAdmin
      .from('products')
      .select('id,user_id,product_url,current_price')
      .eq('user_id', user.id);
    productQuery = productId ? productQuery.eq('id', productId) : productQuery.eq('product_url', url);
    const { data: product, error: productError } = await productQuery.maybeSingle();
    if (productError) throw productError;
    if (!product) return res.status(404).json({ error: '商品が見つかりません' });

    const { data: recent } = await supabaseAdmin
      .from('manual_price_checks')
      .select('checked_at')
      .eq('product_id', product.id)
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent && Date.now() - new Date(recent.checked_at).getTime() < 60_000) {
      return res.status(429).json({ error: '同じ商品は1分に1回まで確認できます', retryAfter: 60 });
    }

    const html = await fetchPage(product.product_url);
    let result = findProductData(html) || findMetaData(html) || scanVisibleText(html) || { title: null, price: null, availability: 'unknown' };
    if (result.price === null && result.availability === 'unknown') {
      result = { ...result, ...(await extractWithAi(html) || {}) };
    }

    const now = new Date().toISOString();
    const oldPrice = product.current_price;
    const priceChanged = result.price !== null && result.price !== oldPrice;
    const updates = { last_checked_at: now, last_check_status: 'success', availability: result.availability };
    if (result.price !== null) updates.current_price = result.price;
    const { error: updateError } = await supabaseAdmin.from('products').update(updates).eq('id', product.id).eq('user_id', user.id);
    if (updateError) throw updateError;

    if (priceChanged) {
      await supabaseAdmin.from('price_history').insert({ product_id: product.id, price: result.price, checked_at: now, source: 'manual_check' });
    }
    await supabaseAdmin.from('manual_price_checks').insert({ product_id: product.id, user_id: user.id, checked_at: now, status: 'success', price: result.price, availability: result.availability });

    return res.status(200).json({ productId: product.id, price: result.price, availability: result.availability, checkedAt: now, previousPrice: oldPrice });
  } catch (error) {
    console.error('[MANUAL_CHECK_ERROR]', error.message);
    return res.status(502).json({ error: '価格・在庫を確認できませんでした', detail: error.message });
  }
}
