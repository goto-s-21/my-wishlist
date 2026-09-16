// hooks/usePushNotification.js
// フロントエンド側: 通知許可のリクエストと、購読情報のDB保存を行うフック

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient'; // 既存のSupabaseクライアントに合わせてパスを調整してください

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotification() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false); // ホーム画面追加済みか
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window;
    setIsSupported(supported);

    const standalone =
      typeof window !== 'undefined' &&
      (window.navigator.standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches);
    setIsStandalone(standalone);

    if (supported) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          reg.pushManager.getSubscription().then((sub) => {
            setIsSubscribed(!!sub);
          });
        }
      });
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported) return { success: false, reason: 'unsupported' };

    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setLoading(false);
        return { success: false, reason: 'denied' };
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        ),
      });

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error('not logged in');

      const subJson = subscription.toJSON();
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: userId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        { onConflict: 'user_id,endpoint' }
      );

      if (error) throw error;

      setIsSubscribed(true);
      setLoading(false);
      return { success: true };
    } catch (e) {
      setLoading(false);
      return { success: false, reason: 'error', error: e };
    }
  }, [isSupported]);

  return { isSupported, isSubscribed, isStandalone, loading, subscribe };
}
