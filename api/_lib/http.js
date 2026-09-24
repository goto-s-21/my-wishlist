// api/_lib/http.js
// 販売ページの取得まわりの正本。UA・タイムアウト・サイズ上限・文字コード判定・
// SSRF対策（内部アドレス遮断）・ボット判定ページ検出を一元化する。副作用なし。

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
};

export const FETCH_TIMEOUT_MS = 15000;
export const MAX_HTML_BYTES = 6_000_000;

const AD_PARAMS = /^(utm_[^=]*|gclid|gbraid|dclid|scid|sc2id|iasid|icm_[^=]*|ifd)$/i;

// localhost / プライベート・ループバック・リンクローカルIP（SSRF遮断用）
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i;
const PRIVATE_IPV4 = /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./;

/** http/https かつ内部アドレスでない公開URLか。 */
export function isPublicHttpUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.replace(/^\[|\]$/g, ''); // IPv6の角括弧を外す
  if (PRIVATE_HOST.test(host)) return false;
  if (PRIVATE_IPV4.test(host)) return false;
  if (host === '::1' || /^f[cde]/i.test(host)) return false; // IPv6ループバック/ULA/リンクローカル
  return true;
}

/** 広告・計測パラメータを落として正規化。無効・内部URLは null。 */
export function cleanProductUrl(raw) {
  if (!isPublicHttpUrl(raw)) return null;
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (AD_PARAMS.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** HTTPヘッダまたは<meta>のcharsetを見て正しくデコード（EUC-JP/Shift_JIS対応）。 */
export function decodeBody(buffer, contentType) {
  const headerCs = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  const metaCs = /charset=["']?([\w-]+)/i.exec(buffer.slice(0, 4096).toString('latin1'))?.[1];
  let label = (headerCs || metaCs || 'utf-8').toLowerCase();
  if (/^(shift[-_]?jis|sjis|x-sjis|ms932|windows-31j)$/.test(label)) label = 'shift_jis';
  else if (/^euc[-_]?jp$/.test(label)) label = 'euc-jp';
  try { return new TextDecoder(label).decode(buffer); } catch { return new TextDecoder('utf-8').decode(buffer); }
}

/** CAPTCHA・ロボットチェックのページか（Amazon等のIPブロック検出用）。 */
export function looksBlocked(html) {
  return /api-services-support@amazon|to discuss automated access|画像に表示されている文字|自動化されたアクセス|ロボットではないこと|enter the characters you see below/i.test(html);
}

/**
 * URLを取得しHTMLを返す。タイムアウト・サイズ上限・文字コード・SSRF・ブロック検出込み。
 * 返り値: { html, finalUrl, status, blocked }
 * 失敗時は code 付き Error を throw（INVALID_URL / HTTP_xxx / HTML_TOO_LARGE / FETCH_FAILED）。
 */
export async function fetchHtml(url) {
  if (!isPublicHttpUrl(url)) throw Object.assign(new Error('無効なURLです'), { code: 'INVALID_URL' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: FETCH_HEADERS });
    const finalUrl = response.url || url;
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: `HTTP_${response.status}`, finalUrl });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_HTML_BYTES) throw Object.assign(new Error('ページが大きすぎます'), { code: 'HTML_TOO_LARGE', finalUrl });
    const html = decodeBody(buffer, response.headers.get('content-type'));
    return { html, finalUrl, status: response.status, blocked: looksBlocked(html) };
  } finally {
    clearTimeout(timer);
  }
}
