export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

    let title = og('title');
    let image = og('image');
    let price = og('price:amount') || og('price');

    const isAmazon = /amazon\.co\.jp|amazon\.com/i.test(url);
    if (isAmazon) {
      const titleMatch =
        html.match(/id=["']productTitle["'][^>]*>\s*([^<]+?)\s*</i) ||
        html.match(/<span[^>]*id=["']productTitle["'][^>]*>([^<]+)</i);
      if (titleMatch) title = titleMatch[1].trim();

      const priceMatch =
        html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\d,]+)/i) ||
        html.match(/"priceAmount"\s*:\s*([\d.]+)/i);
      if (priceMatch) price = priceMatch[1].replace(/,/g, '');

      const imgMatch =
        html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i) ||
        html.match(/"hiRes"\s*:\s*"([^"]+)"/i) ||
        html.match(/"large"\s*:\s*"([^"]+)"/i);
      if (imgMatch) image = imgMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');

      if (title === 'Amazon' || title === 'Amazon.co.jp') title = null;
    }

    if (!title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();
    }

    if (!price) {
      const priceMatch = html.match(/<meta[^>]*(?:property|name)=["'](?:product:price:amount|priceCurrency|price)["'][^>]*content=["']([\d.,]+)["']/i);
      if (priceMatch) price = priceMatch[1].replace(/,/g, '');
    }

    res.status(200).json({ title, image, price });
  } catch (e) {
    res.status(200).json({ title: null, image: null, price: null });
  }
}