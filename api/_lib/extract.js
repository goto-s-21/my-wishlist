// api/_lib/extract.js
// 商品ページHTMLから「商品名・画像・価格・在庫」を取り出す純粋関数群。
// 副作用なし。fetch-product-info / check-product / cron から共有する正本。

export const PRICE_MIN = 1;
export const PRICE_MAX = 10_000_000;

const PRICE_CONTEXT_RE = /(?:¥|￥|円|価格|販売価格|税込|price|amount|salePrice|currentPrice|regularPrice|在庫|stock)/i;
const PRICE_RE = /(?:¥|￥)\s*[\d,]+|[\d,]+\s*円|(?:price|amount|salePrice|currentPrice|regularPrice)\s*[:=]\s*["']?[\d,]+/gi;

// --- 基本ユーティリティ -----------------------------------------------------

export function forceHttps(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return value;
  }
}

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function cleanText(value) {
  return decodeHtml(String(value || '').replace(/\\u0026/g, '&').replace(/\s+/g, ' ').trim());
}

/** 文字列/数値から整数を取り出す（カンマ・通貨記号を無視）。 */
export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 価格として妥当な範囲(PRICE_MIN..PRICE_MAX)に収まる整数のみ返し、外れ値はnullにする。 */
export function sanePrice(value) {
  const n = parseNumber(value);
  return n !== null && n >= PRICE_MIN && n <= PRICE_MAX ? n : null;
}

/** schema.org等の在庫表記を in_stock/out_of_stock/pre_order/limited/unknown に正規化。 */
export function mapAvailability(value) {
  const text = String(value || '').toLowerCase();
  if (/outofstock|soldout|out of stock|在庫切れ|売り切れ|完売/.test(text)) return 'out_of_stock';
  if (/preorder|pre-order|予約/.test(text)) return 'pre_order';
  if (/limitedavailability|残りわずか|残り僅か/.test(text)) return 'limited';
  if (/instock|in stock|在庫あり|販売中|購入可能/.test(text)) return 'in_stock';
  return 'unknown';
}

// --- <meta> / マイクロデータ -------------------------------------------------

/** <meta {attr}="{name}" content="..."> を属性順を問わず取り出す。 */
export function getMeta(html, attr, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]*(?:${attr}=["']${escaped}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*${attr}=["']${escaped}["'])`, 'i');
  const match = html.match(re);
  return cleanText(match?.[1] || match?.[2] || '');
}

/** og / product / itemprop の各流儀を横断して価格metaを引く（生文字列）。 */
export function metaPriceRaw(html) {
  return (
    getMeta(html, 'property', 'product:price:amount') ||
    getMeta(html, 'name', 'product:price:amount') ||
    getMeta(html, 'property', 'og:price:amount') ||
    getMeta(html, 'name', 'og:price:amount') ||
    getMeta(html, 'itemprop', 'price')
  );
}

/** 在庫metaを横断して引く（生文字列）。 */
export function metaAvailabilityRaw(html) {
  return (
    getMeta(html, 'property', 'product:availability') ||
    getMeta(html, 'name', 'availability') ||
    getMeta(html, 'itemprop', 'availability')
  );
}

export function findMetaData(html) {
  const title = getMeta(html, 'property', 'og:title') || getMeta(html, 'name', 'twitter:title');
  const image = forceHttps(getMeta(html, 'property', 'og:image') || getMeta(html, 'name', 'twitter:image')) || null;
  const price = sanePrice(metaPriceRaw(html));
  const availability = mapAvailability(metaAvailabilityRaw(html));
  return title || image || price !== null || availability !== 'unknown'
    ? { title: title || null, image, price, availability }
    : null;
}

// --- JSON-LD ----------------------------------------------------------------

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
    } catch {
      // 壊れたJSON-LDは無視して他の抽出器に任せる
    }
  }
  return values;
}

export function findJsonLdData(html) {
  const entries = extractJsonLd(html);
  const product = entries.find((item) => {
    const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
    return types.some((type) => ['product', 'productgroup'].includes(String(type).toLowerCase()));
  });
  if (!product) return null;
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  const offer = offers.find(Boolean) || {};
  const specification = Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification;
  const price = sanePrice(offer.price ?? offer.lowPrice ?? specification?.price ?? product.price);
  const availability = mapAvailability(offer.availability ?? product.availability);
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const result = { title: cleanText(product.name) || null, image: forceHttps(image) || null, price, availability };
  return result.title || result.image || result.price !== null || result.availability !== 'unknown' ? result : null;
}

// --- 埋め込みJSON / 可視テキスト / <title> ----------------------------------

/** Amazon等が埋め込む "priceAmount":14990 / "displayPrice":"￥14,990" から価格を取る。 */
export function findEmbeddedPrice(html) {
  const m = html.match(/"priceAmount"\s*:\s*([\d.]+)/) || html.match(/"displayPrice"\s*:\s*"[^"\d]*([\d,]+)/);
  return m ? sanePrice(m[1]) : null;
}

/** ページ内で一意に定まる価格候補だけを返す（複数候補なら諦める）。 */
export function findTextPrice(html) {
  const text = cleanText(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const prices = new Set();
  let match;
  while ((match = PRICE_RE.exec(text)) !== null && prices.size < 41) {
    const raw = match[0];
    const before = text.slice(Math.max(0, match.index - 100), match.index).toLowerCase();
    const after = text.slice(match.index + raw.length, match.index + raw.length + 100).toLowerCase();
    if (/送料|ポイント|月額|分割|coupon|クーポン|商品コード|型番/.test(before + after)) continue;
    const price = sanePrice(raw);
    if (price !== null) prices.add(price);
  }
  return prices.size === 1 ? [...prices][0] : null;
}

/** og:titleが無いサイト向けに<title>から商品名を推定（Amazonの接頭辞・接尾辞を除去）。 */
export function findFallbackTitle(html) {
  const raw = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (!raw) return null;
  const t = cleanText(raw.replace(/^Amazon\.co\.jp[:：]\s*/i, '').split(/\s*[|｜]\s*/)[0]);
  return t ? t.slice(0, 200) : null;
}

/** og:imageが無いサイト向けに埋め込み画像URLを推定。 */
export function findFallbackImage(html) {
  const m =
    html.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/) ||
    html.match(/"large"\s*:\s*"(https?:[^"]+)"/) ||
    html.match(/id=["']landingImage["'][^>]*src=["'](https?:[^"']+)/i);
  return m ? forceHttps(m[1].replace(/\\u002[fF]/g, '/')) : null;
}

/** タグを除いた可視テキスト全体（cronのAI入力など、広く読ませたい用途向け）。 */
export function htmlToText(html) {
  return cleanText(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

/** AIに渡す、価格・在庫の周辺だけを集めた圧縮コンテキスト。 */
export function buildAiContext(html) {
  const text = cleanText(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const contexts = [];
  let match;
  while ((match = PRICE_CONTEXT_RE.exec(text)) !== null && contexts.length < 30) {
    contexts.push(text.slice(Math.max(0, match.index - 220), match.index + 420));
  }
  return contexts.join('\n---\n').slice(0, 24000) || text.slice(0, 24000);
}

// --- 合成パイプライン（AIなし・決定的） -------------------------------------

/**
 * 決定的な手段だけで {title, image, price, availability, source} を返す。
 * 優先順位: JSON-LD > og/meta/itemprop > 埋め込みJSON/一意テキスト価格 > <title>/埋め込み画像。
 * AIは呼ばない（呼び出し側が必要に応じて上書きする）。
 */
export function extractProductInfo(html) {
  const jsonLd = findJsonLdData(html);
  const meta = findMetaData(html);
  const base = jsonLd || meta || { title: null, image: null, price: null, availability: 'unknown' };
  let source = jsonLd ? 'json_ld' : meta ? 'meta' : 'none';

  const data = {
    title: base.title || null,
    image: base.image || null,
    price: base.price ?? null,
    availability: base.availability || 'unknown',
  };

  if (data.price === null) {
    const price = findEmbeddedPrice(html) ?? findTextPrice(html);
    if (price !== null) { data.price = price; if (source === 'none') source = 'html'; }
  }
  if (!data.title) {
    const title = findFallbackTitle(html);
    if (title) { data.title = title; if (source === 'none') source = 'html'; }
  }
  if (!data.image) {
    const image = findFallbackImage(html);
    if (image) data.image = image;
  }

  return { ...data, source };
}
