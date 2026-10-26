// api/_lib/auth.js
// APIの認証の正本。SupabaseのアクセストークンをAuthorizationヘッダーで受け取り、ログイン済みユーザーを返す。
// 未認証のAPIは外部ページ取得の踏み台・Geminiの利用枠の流用に使われうるため、利用者を限定する。
import { createClient } from '@supabase/supabase-js';

export async function getUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : data.user;
}
