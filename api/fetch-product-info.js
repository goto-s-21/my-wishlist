import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICE_CONTEXT_RE = /(?:¥|￥|円|価格|販売価格|税込|price|amount|salePrice|currentPrice|regularPrice|在庫|stock)/i;
const PRICE_RE = /(?:¥|￥)\s*[\d,]+|[\d,]+\s*円|(?:price|amount|salePrice|currentPrice|regularPrice)\s*[:=]\s*["']?[\d,]+/gi;
const AD_PARAMS = /^(utm_[^=]+|gclid|gbraid|dclid|scid|sc2id|iasid|icm_[^=]+|ifd)$/i;

function forceHttps(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return value;
  }
}

function cleanProductUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (AD_PARAMS.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function cleanText(value) {
  return decodeHtml(String(value || '').replace(/\\u0026/g, '&').replace(/\s+/g, ' ').trim());
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
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
  const values = [];
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script.replace(/^<[\s\S]*?>|<\/script>$/gi, '').trim();
    try {
      const parsed = JSON.parse(body.replace(/<!--|-->/g, '').trim());
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        if (root?.['@graph']) values.push(...root['@graph']);
        else values.push(root);
      }
    } catch {}
  }
  return values;
}

function findJsonLdData(html) {
  const entries = extractJsonLd(html);
  const product = entries.find((item) => {
    const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
    return types.some((type) => ['product', 'productgroup'].includes(String(type).toLowerCase()));
  });
  if (!product) return null;
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  const offer = offers.find(Boolean) || {};
  const specification = Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification;
  const price = parseNumber(offer.price ?? offer.lowPrice ?? specification?.price ?? product.price);
  const availability = mapAvailability(offer.availability ?? product.availability);
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const result = { title: cleanText(product.name) || null, image: forceHttps(image) || null, price, availability };
  return result.title || result.image || result.price !== null || result.availability !== 'unknown' ? result : null;
}

function getMeta(html, attr, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]*(?:${attr}=["']${escaped}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*${attr}=["']${escaped}["'])`, 'i');
  const match = html.match(re);
  return cleanText(match?.[1] || match?.[2] || '');
}

function findMetaData(html) {
  const title = getMeta(html, 'property', 'og:title') || getMeta(html, 'name', 'twitter:title');
  const image = forceHttps(getMeta(html, 'property', 'og:image') || getMeta(html, 'name', 'twitter:image')) || null;
  const price = parseNumber(
    getMeta(html, 'property', 'product:price:amount') ||
    getMeta(html, 'name', 'product:price:amount') ||
    getMeta(html, 'property', 'og:price:amount') ||
    getMeta(html, 'name', 'og:price:amount') ||
    getMeta(html, 'itemprop', 'price')
  );
  const availability = mapAvailability(
    getMeta(html, 'property', 'product:availability') ||
    getMeta(html, 'name', 'availability') ||
    getMeta(html, 'itemprop', 'availability')
  );
  return title || image || price !== null || availability !== 'unknown' ? { title: title || null, image, price, availability } : null;
}

function extractPriceCandidates(html) {
  const text = cleanText(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const candidates = [];
  let match;
  while ((match = PRICE_RE.exec(text)) !== null && candidates.length < 40) {
    const raw = match[0];
    const before = text.slice(Math.max(0, match.index - 100), match.index).toLowerCase();
    const after = text.slice(match.index + raw.length, match.index + raw.length + 100).toLowerCase();
    if (/送料|ポイント|月額|分割|coupon|クーポン|商品コード|型番/.test(before + after)) continue;
    const price = parseNumber(raw);
    if (price !== null && price >= 1 && price <= 10000000) candidates.push({ price, context: text.slice(Math.max(0, match.index - 140), match.index + raw.length + 140) });
  }
  return candidates;
}

function findHtmlData(html) {
  const text = cleanText(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const candidates = extractPriceCandidates(html);
  const availability = mapAvailability(text);
  const title = cleanText(getMeta(html, 'property', 'og:title') || '').slice(0, 300) || null;
  const unique = [...new Map(candidates.map((item) => [item.price, item])).values()];
  if (!title && unique.length === 0 && availability === 'unknown') return null;
  return { title, image: null, price: unique.length === 1 ? unique[0].price : null, availability, candidates: unique.slice(0, 10) };
}

function buildAiContext(html) {
  const text = cleanText(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const contexts = [];
  let match;
  while ((match = PRICE_CONTEXT_RE.exec(text)) !== null && contexts.length < 30) {
    contexts.push(text.slice(Math.max(0, match.index - 220), match.index + 420));
  }
  return contexts.join('\n---\n').slice(0, 24000) || text.slice(0, 24000);
}

async function extractWithAi(html) {
  if (!process.env.GEMINI_API_KEY) return null;
  const context = buildAiContext(html);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `商品ページの抽出候補から商品名、現在価格、在庫状態を抽出してください。JSONのみで返してください。priceは整数またはnull、availabilityはin_stock/out_of_stock/pre_order/limited/unknownのいずれかです。送料、ポイント、クーポン、月額、型番、商品コードは価格にしないでください。\n{"name":"商品名","price":5390,"availability":"in_stock"}\n候補:\n${context}` }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { title: typeof parsed.name === 'string' ? cleanText(parsed.name) : null, image: null, price: parseNumber(parsed.price), availability: ['in_stock', 'out_of_stock', 'pre_order', 'limited', 'unknown'].includes(parsed.availability) ? parsed.availability : 'unknown' };
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

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7' } });
    const finalUrl = response.url || url;
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: `HTTP_${response.status}`, finalUrl });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 3000000) throw Object.assign(new Error('商品ページが大きすぎます'), { code: 'HTML_TOO_LARGE', finalUrl });
    const html = decodeBody(buffer, response.headers.get('content-type'));
    return { html, finalUrl, status: response.status };
  } finally { clearTimeout(timeout); }
}

function findEmbeddedPrice(html) {
  const m = html.match(/"priceAmount"\s*:\s*([\d.]+)/) || html.match(/"displayPrice"\s*:\s*"[^"\d]*([\d,]+)/);
  return m ? parseNumber(m[1]) : null;
}

function findFallbackTitle(html) {
  const raw = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (!raw) return null;
  const t = cleanText(raw.replace(/^Amazon\.co\.jp[:：]\s*/i, '').split(/\s*[|｜]\s*/)[0]);
  return t ? t.slice(0, 200) : null;
}

function findFallbackImage(html) {
  const m = html.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/) || html.match(/"large"\s*:\s*"(https?:[^"]+)"/) || html.match(/id=["']landingImage["'][^>]*src=["'](https?:[^"']+)/i);
  return m ? forceHttps(m[1].replace(/\\u002[fF]/g, '/')) : null;
}

function looksBlocked(html) {
  return /api-services-support@amazon|to discuss automated access|画像に表示されている文字|自動化されたアクセス|ロボットではないこと|enter the characters you see below/i.test(html);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const rawUrl = req.query?.url;
  const url = cleanProductUrl(rawUrl);
  if (!url) return res.status(400).json({ error: '有効なURLを指定してください' });
  try {
    const { html, finalUrl, status } = await fetchHtml(url);
    if (looksBlocked(html)) {
      return res.status(200).json({ title: null, image: null, price: null, availability: 'unknown', source: 'none', confidence: 'none', checkedAt: new Date().toISOString(), finalUrl, status, errorCode: 'BLOCKED', error: '販売サイトにボット判定されアクセスをブロックされました' });
    }
    const jsonLd = findJsonLdData(html);
    const meta = findMetaData(html);
    const htmlData = findHtmlData(html);
    let data = jsonLd || meta || htmlData || { title: null, image: null, price: null, availability: 'unknown' };
    let source = jsonLd ? 'json_ld' : meta ? 'meta' : htmlData ? 'html' : 'none';
    // Deterministic fallbacks for sites without og/meta/JSON-LD (e.g. Amazon)
    if (data.price == null) { const ep = findEmbeddedPrice(html); if (ep != null) { data.price = ep; if (source === 'none') source = 'html'; } }
    if (!data.title) { const ft = findFallbackTitle(html); if (ft) { data.title = ft; if (source === 'none') source = 'html'; } }
    if (!data.image) { const fi = findFallbackImage(html); if (fi) data.image = fi; }
    if (data.price === null && data.availability === 'unknown') {
      const ai = await extractWithAi(html);
      if (ai) {
        if (ai.price !== null) data.price = ai.price;
        if (ai.availability && ai.availability !== 'unknown') data.availability = ai.availability;
        if (!data.title && ai.title) data.title = ai.title;
        if (ai.price !== null || ai.availability !== 'unknown' || ai.title) source = 'gemini';
      }
    }
    const result = { title: data?.title || null, image: forceHttps(data?.image) || null, price: data?.price ?? null, availability: data?.availability || 'unknown', source, confidence: source === 'json_ld' || source === 'meta' ? 'high' : source === 'gemini' ? 'medium' : source === 'html' ? 'low' : 'none', checkedAt: new Date().toISOString(), finalUrl, status, errorCode: source === 'none' ? 'NO_PRODUCT_DATA' : null };
    return res.status(200).json(result);
  } catch (error) {
    return res.status(200).json({ title: null, image: null, price: null, availability: 'unknown', source: 'none', confidence: 'none', checkedAt: new Date().toISOString(), errorCode: error.code || 'FETCH_FAILED', error: error.message });
  }
}
