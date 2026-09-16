export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WishlistBot/1.0)' },
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
    if (!title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();
    }

    const image = og('image');
    let price = og('price:amount') || og('price');
    if (!price) {
      const priceMatch = html.match(/<meta[^>]*(?:property|name)=["'](?:product:price:amount|priceCurrency|price)["'][^>]*content=["']([\d.,]+)["']/i);
      if (priceMatch) price = priceMatch[1].replace(/,/g, '');
    }

    res.status(200).json({ title, image, price });
  } catch (e) {
    res.status(200).json({ title: null, image: null, price: null });
  }
}