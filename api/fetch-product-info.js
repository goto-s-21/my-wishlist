// api/fetch-product-info.js
// URL登録時に商品名・画像・価格・在庫を推定して返す（認証不要のGET）。
import { cleanProductUrl, fetchHtml } from './_lib/http.js';
import { extractProductInfo, buildAiContext, cleanText, sanePrice } from './_lib/extract.js';
import { callGeminiJson } from './_lib/gemini.js';

const AVAILABILITY_VALUES = ['in_stock', 'out_of_stock', 'pre_order', 'limited', 'unknown'];

// 決定的抽出で価格・在庫が取れなかったときだけ呼ぶAIフォールバック。
async function aiFallback(html) {
  const prompt = `商品ページの抽出候補から商品名、現在価格、在庫状態を抽出してください。JSONのみで返してください。priceは整数またはnull、availabilityはin_stock/out_of_stock/pre_order/limited/unknownのいずれかです。送料、ポイント、クーポン、月額、型番、商品コードは価格にしないでください。\n{"name":"商品名","price":5390,"availability":"in_stock"}\n候補:\n${buildAiContext(html)}`;
  const parsed = await callGeminiJson(prompt);
  if (!parsed) return null;
  return {
    title: typeof parsed.name === 'string' ? cleanText(parsed.name) : null,
    price: sanePrice(parsed.price),
    availability: AVAILABILITY_VALUES.includes(parsed.availability) ? parsed.availability : 'unknown',
  };
}

function confidenceOf(source) {
  if (source === 'json_ld' || source === 'meta') return 'high';
  if (source === 'gemini') return 'medium';
  if (source === 'html') return 'low';
  return 'none';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const url = cleanProductUrl(req.query?.url);
  if (!url) return res.status(400).json({ error: '有効なURLを指定してください' });

  try {
    const { html, finalUrl, status, blocked } = await fetchHtml(url);
    if (blocked) {
      return res.status(200).json({ title: null, image: null, price: null, availability: 'unknown', source: 'none', confidence: 'none', checkedAt: new Date().toISOString(), finalUrl, status, errorCode: 'BLOCKED', error: '販売サイトにボット判定されアクセスをブロックされました' });
    }

    const data = extractProductInfo(html);
    let source = data.source;

    if (data.price === null && data.availability === 'unknown') {
      const ai = await aiFallback(html);
      if (ai) {
        if (ai.price !== null) data.price = ai.price;
        if (ai.availability !== 'unknown') data.availability = ai.availability;
        if (!data.title && ai.title) data.title = ai.title;
        if (ai.price !== null || ai.availability !== 'unknown' || ai.title) source = 'gemini';
      }
    }

    return res.status(200).json({
      title: data.title || null,
      image: data.image || null,
      price: data.price ?? null,
      availability: data.availability || 'unknown',
      source,
      confidence: confidenceOf(source),
      checkedAt: new Date().toISOString(),
      finalUrl,
      status,
      errorCode: source === 'none' ? 'NO_PRODUCT_DATA' : null,
    });
  } catch (error) {
    return res.status(200).json({ title: null, image: null, price: null, availability: 'unknown', source: 'none', confidence: 'none', checkedAt: new Date().toISOString(), errorCode: error.code || 'FETCH_FAILED', error: error.message });
  }
}
