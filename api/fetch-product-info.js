export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    const html = await r.text();

    const og = (prop) => {
      const m1 = html.match(new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`, 'i'));
      if (m1) return m1[1];
      const m2 = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`, 'i'));
      if (m2) return m2[1];
      return null;
    };

    const cleanUrl = (s) => (s ? s.replace(/\\u0026/g, '&').replace(/\\\//g, '/') : s);

    let image = cleanUrl(og('image'));

    const aiResult = await extractProductInfoWithAI(html);

    const title = aiResult?.name || og('title') || null;
    const price = aiResult?.price ?? null;

    return res.status(200).json({ title, image, price });
  } catch (e) {
    return res.status(200).json({ title: null, image: null, price: null });
  }
}

async function extractProductInfoWithAI(html) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[AI_DEBUG] GEMINI_API_KEY is not set');
    return null;
  }

  try {
    const cleanedHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .slice(0, 20000);

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
                  text: `以下は商品ページのHTMLです。この商品の「商品名」と「現在の販売価格（数値のみ）」を抽出し、次のJSON形式だけで回答してください。他の説明やテキストは一切不要です。\n{"name": 商品名の文字列, "price": 価格の数値}\n見つからない場合は null を入れてください。\n\n${cleanedHtml}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      }
    );

    if (!response.ok) {
      console.log('[AI_DEBUG] gemini http status:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text);
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
    const priceNum = parseInt(String(parsed.price).replace(/[^\d]/g, ''), 10);
    const price = isNaN(priceNum) ? null : priceNum;

    return { name, price };
  } catch (e) {
    console.log('[AI_DEBUG] exception:', e.message);
    return null;
  }
}
