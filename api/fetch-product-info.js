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
    const metaByName = (name) => {
      const m = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'));
      return m ? m[1] : null;
    };
    const cleanUrl = (s) => s ? s.replace(/\\u0026/g, '&').replace(/\\\//g, '/') : s;

    let title = og('title');
    let image = og('image');
    let price = og('price:amount') || og('price') || metaByName('product:price:amount');

    const host = (() => {
      try { return new URL(url).hostname; } catch { return ''; }
    })();

    if (/amazon\.co\.jp|amazon\.com/i.test(host)) {
      const titleMatch =
        html.match(/id=["']productTitle["'][^>]*>\s*([^<]+?)\s*</i);
      if (titleMatch) title = titleMatch[1].trim();

      const priceMatch =
        html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\d,]+)/i) ||
        html.match(/"priceAmount"\s*:\s*([\d.]+)/i);
      if (priceMatch) price = priceMatch[1].replace(/,/g, '');

      const imgMatch =
        html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i) ||
        html.match(/"hiRes"\s*:\s*"([^"]+)"/i) ||
        html.match(/"large"\s*:\s*"([^"]+)"/i);
      if (imgMatch) image = cleanUrl(imgMatch[1]);

      if (title === 'Amazon' || title === 'Amazon.co.jp') title = null;
    } else if (/rakuten\.co\.jp/i.test(host)) {
      // Rakuten Ichiba generally exposes decent OGP + price meta tags already.
      if (!price) {
        const priceMatch = html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i);
        if (priceMatch) price = priceMatch[1].replace(/,/g, '');
      }
    } else if (/zozo\.jp/i.test(host)) {
      if (!title) {
        const t = html.match(/<h1[^>]*class=["'][^"']*p-goods-name[^"']*["'][^>]*>([^<]+)</i);
        if (t) title = t[1].trim();
      }
      if (!price) {
        const p = html.match(/class=["'][^"']*p-goods-price[^"']*["'][^>]*>[^\d]*([\d,]+)/i);
        if (p) price = p[1].replace(/,/g, '');
      }
    } else if (/mercari\.com/i.test(host)) {
      // Mercari renders via client-side JS; rely on OGP + any embedded JSON price.
      if (!price) {
        const p = html.match(/"price"\s*:\s*"?(\d+)"?/i);
        if (p) price = p[1];
      }
    } else if (/qoo10\.jp/i.test(host)) {
      if (!price) {
        const p = html.match(/class=["'][^"']*price_real[^"']*["'][^>]*>[^\d]*([\d,]+)/i) ||
                   html.match(/"salePrice"\s*:\s*"?([\d,.]+)"?/i);
        if (p) price = p[1].replace(/,/g, '');
      }
    }

    if (!title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();
    }
    if (!price) {
      const priceMatch = html.match(/<meta[^>]*(?:property|name)=["'](?:product:price:amount|priceCurrency|price)["'][^>]*content=["']([\d.,]+)["']/i);
      if (priceMatch) price = priceMatch[1].replace(/,/g, '');
    }
    image = cleanUrl(image);

    res.status(200).json({ title, image, price });
  } catch (e) {
    res.status(200).json({ title: null, image: null, price: null });
  }
}