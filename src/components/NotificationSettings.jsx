import { useEffect, useState } from 'react';
import { Heart, Bell, Share, PlusSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  getPushStatus,
  subscribeToPush,
  unsubscribeFromPush,
  isIos,
} from '../lib/pushNotifications';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export default function NotificationSettings({ session }) {
  const [status, setStatus] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    getPushStatus().then(setStatus);
  }, []);

  async function handleEnable() {
    setBusy(true);
    setErrorMsg('');
    try {
      await subscribeToPush(session.user.id, VAPID_PUBLIC_KEY);
      setStatus('subscribed');
    } catch (e) {
      setErrorMsg(e.message);
      const s = await getPushStatus();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      await unsubscribeFromPush(session.user.id);
      setStatus('not_subscribed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fdf6f3] px-5 py-6 pb-24">
      <h1 className="text-lg font-semibold text-neutral-800 mb-1 flex items-center gap-2">
        <Heart size={18} className="text-rose-400" fill="currentColor" />
        通知設定
      </h1>
      <p className="text-sm text-neutral-500 mb-6">
        欲しいものが値下がりしたら、いちばん早くお知らせします。
      </p>

      {status === 'needs_install' && (
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm border border-rose-100">
          <p className="text-sm font-medium text-neutral-800 mb-3">
            プッシュ通知を受け取るには、まずホーム画面に追加してください
          </p>
          <p className="text-xs text-neutral-500 mb-4">
            iPhoneの仕様上、Safariのタブのままでは通知を受け取れません。ホーム画面に追加すると、値下がりをすぐに通知でお知らせできます。
          </p>
          <ol className="space-y-2 text-sm text-neutral-600">
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-500 text-xs flex items-center justify-center shrink-0">1</span>
              下部の共有ボタン <Share size={14} className="inline text-neutral-400" /> をタップ
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-500 text-xs flex items-center justify-center shrink-0">2</span>
              「ホーム画面に追加」<PlusSquare size={14} className="inline text-neutral-400" /> を選択
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-500 text-xs flex items-center justify-center shrink-0">3</span>
              追加したアイコンからアプリを開き直す
            </li>
          </ol>
        </div>
      )}

      {status === 'unsupported' && (
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm border border-neutral-100">
          <p className="text-sm text-neutral-600">
            お使いの環境ではプッシュ通知に対応していません。値下がり時はメールでお知らせします。
          </p>
        </div>
      )}

      {status === 'denied' && (
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm border border-neutral-100">
          <p className="text-sm text-neutral-600">
            通知がブロックされています。端末の設定からこのサイトの通知を許可してください。それまではメールでお知らせします。
          </p>
        </div>
      )}

      {(status === 'not_subscribed' || status === 'subscribed') && (
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm border border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center">
              <Bell size={18} className="text-rose-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-800">値下がり通知</p>
              <p className="text-xs text-neutral-400">
                {status === 'subscribed' ? '通知はONです' : '通知はOFFです'}
              </p>
            </div>
          </div>
          <button
            onClick={status === 'subscribed' ? handleDisable : handleEnable}
            disabled={busy}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              status === 'subscribed'
                ? 'bg-neutral-100 text-neutral-500'
                : 'bg-rose-400 text-white'
            }`}
          >
            {busy ? '処理中…' : status === 'subscribed' ? 'OFFにする' : 'ONにする'}
          </button>
        </div>
      )}

      {errorMsg && (
        <p className="text-xs text-rose-400 mt-2">{errorMsg}</p>
      )}

      <p className="text-xs text-neutral-400 mt-6 leading-relaxed">
        プッシュ通知を受け取れない環境では、Googleログインで使用しているメールアドレス宛に自動で通知を送ります。設定の変更は不要です。
      </p>
    </div>
  );
}