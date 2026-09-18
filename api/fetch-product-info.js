export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    const html = await r.text();
    console.log('[AI_DEBUG] html length:', html.length);

    const og = (prop) => {
      const m1 = html.match(new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`, 'i'));
      if (m1) return m1[1];
      const m2 = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`, 'i'));
      if (m2) return m2[1];
      return null;
    };

    const cleanUrl = (s) => (s ? s.replace(/\\u0026/g, '&').replace(/\\\//g, '/') : s);

    const image = cleanUrl(og('image'));

    // JSON-LD 構造化データから商品情報を取得（最も信頼性が高い）
    const jsonLdResult = extractFromJsonLd(html);
    console.log('[AI_DEBUG] jsonLdResult:', JSON.stringify(jsonLdResult));

    // 在庫状況はJSON-LDだけでは判断が不十分なことが多いため、常にAIでも抽出する
    const aiResult = await extractProductInfoWithAI(html);
    console.log('[AI_DEBUG] final aiResult:', JSON.stringify(aiResult));

    // JSON-LD で name と price の両方が取れた場合はAIの name/price をスキップ（在庫状況はAI側を採用）
    const title = jsonLdResult.name && jsonLdResult.price != null
      ? jsonLdResult.name
      : (aiResult?.name || jsonLdResult.name || og('title') || null);
    const price = jsonLdResult.name && jsonLdResult.price != null
      ? jsonLdResult.price
      : (aiResult?.price ?? jsonLdResult.price ?? null);
    const stockStatus = aiResult?.stockStatus ?? 'unknown';

    return res.status(200).json({ title, image, price, stockStatus });
  } catch (e) {
    console.log('[AI_DEBUG] top-level exception:', e.message);
    return res.status(200).json({ title: null, image: null, price: null, stockStatus: 'unknown' });
  }
}

function extractFromJsonLd(html) {
  const result = { name: null, price: null };
  const scriptMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scriptMatches) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const product = item['@type'] === 'Product' ? item : item['@graph']?.find?.((n) => n['@type'] === 'Product');
        if (!product) continue;
        if (!result.name && typeof product.name === 'string') result.name = product.name.trim();
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (offer?.price != null && result.price == null) {
          const num = parseInt(String(offer.price).replace(/[^\d]/g, ''), 10);
          if (!isNaN(num)) result.price = num;
        }
      }
    } catch {
      // 不正なJSON-LDは無視
    }
    if (result.name && result.price != null) break;
  }
  return result;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function extractProductInfoWithAI(html) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[AI_DEBUG] GEMINI_API_KEY is not set');
    return null;
  }

  try {
    // HTMLタグを除去したプレーンテキストをAIに渡す（在庫の文言も含めて認識させる）
    const pageText = htmlToText(html).slice(0, 15000);
    console.log('[AI_DEBUG] pageText length sent to gemini:', pageText.length);

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
                  text: `以下は商品ページのテキストです。この商品について次の3点を抽出し、次のJSON形式だけで回答してください。他の説明やテキストは一切不要です。

1. name: 商品名の文字列。見つからない場合はnull。
2. price: 現在の販売価格（数値のみ、カンマや円記号を含めない半角数字）。見つからない場合はnull。
3. stockStatus: 在庫状況を必ず次の4つのいずれか1つの文字列で答えてください。
   - "in_stock" （在庫あり、特に在庫に関する言及がない場合もこれ）
   - "low_stock" （「残りわずか」「残り○点」「あと○個」「残り1点」など、在庫が少ないことを示す表記がある場合）
   - "out_of_stock" （「売り切れ」「在庫切れ」「販売終了」「入荷待ち」など、購入できない状態を示す表記がある場合）
   - "unknown" （ページから在庫状況が全く判断できない場合）

{"name": "商品名の文字列", "price": 12800, "stockStatus": "in_stock"}

${pageText}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      }
    );

    console.log('[AI_DEBUG] gemini http status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.log('[AI_DEBUG] gemini error body:', errText.slice(0, 500));
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log('[AI_DEBUG] raw text from gemini:', text);

    if (!text) return null;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log('[AI_DEBUG] JSON.parse failed for text:', text?.slice(0, 200));
      return null;
    }

    console.log('[AI_DEBUG] parsed object:', JSON.stringify(parsed));

    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;

    let price = null;
    if (parsed.price !== null && parsed.price !== undefined) {
      const priceNum = parseInt(String(parsed.price).replace(/[^\d]/g, ''), 10);
      price = isNaN(priceNum) ? null : priceNum;
    }

    const validStatuses = ['in_stock', 'low_stock', 'out_of_stock', 'unknown'];
    const stockStatus = validStatuses.includes(parsed.stockStatus) ? parsed.stockStatus : 'unknown';

    console.log('[AI_DEBUG] final name:', name, 'final price:', price, 'final stockStatus:', stockStatus);

    return { name, price, stockStatus };
  } catch (e) {
    console.log('[AI_DEBUG] exception in extractProductInfoWithAI:', e.message);
    return null;
  }
}
