import { supabase } from './supabase';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// iOSでは「ホーム画面に追加」した状態(スタンドアロン表示)でないとPush自体が使えない。
// この判定に基づいて、UI側で案内バナーを出し分ける。
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

// iOSの場合は「ホーム画面に追加済み」であることが必須条件。
// それ以外(Android/PCのブラウザ)はブラウザのまま購読可能。
export function canUsePush() {
  if (!isPushSupported()) return false;
  if (isIos()) return isStandalone();
  return true;
}

export async function subscribeToPush(userId, vapidPublicKey) {
  if (!canUsePush()) {
    throw new Error('この環境ではプッシュ通知を利用できません');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('通知が許可されませんでした');
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
  return true;
}

export async function unsubscribeFromPush(userId) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
  }
}

export async function getPushStatus() {
  if (!isPushSupported()) return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs_install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) return 'subscribed';
  }
  return 'not_subscribed';
}