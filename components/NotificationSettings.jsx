// components/NotificationSettings.jsx
// 「その他・設定」画面に配置する通知許可セクション

import { usePushNotification } from '../hooks/usePushNotification';

export default function NotificationSettings() {
  const { isSupported, isSubscribed, isStandalone, loading, subscribe } =
    usePushNotification();

  const handleEnable = async () => {
    const result = await subscribe();
    if (!result.success) {
      if (result.reason === 'denied') {
        alert('通知が許可されませんでした。iPhoneの設定 > Safari > 通知 から許可できます。');
      } else if (result.reason === 'unsupported') {
        alert('お使いのブラウザは通知に対応していません。');
      } else {
        alert('通知の設定に失敗しました。もう一度お試しください。');
      }
    }
  };

  return (
    <section
      style={{
        background: '#FFF8F6',
        borderRadius: '20px',
        padding: '20px',
        margin: '12px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <h3
        style={{
          fontSize: '15px',
          fontWeight: 600,
          color: '#4A4A4A',
          marginBottom: '8px',
        }}
      >
        値下がり通知
      </h3>

      {!isStandalone && (
        <p style={{ fontSize: '13px', color: '#8A8A8A', lineHeight: 1.6, marginBottom: '14px' }}>
          通知を受け取るには、まずこのアプリをホーム画面に追加してください。
          Safariの共有ボタン →「ホーム画面に追加」から設定できます。
        </p>
      )}

      {isStandalone && !isSubscribed && (
        <p style={{ fontSize: '13px', color: '#8A8A8A', lineHeight: 1.6, marginBottom: '14px' }}>
          欲しいものが値下がりしたら、すぐにお知らせします。
        </p>
      )}

      {isSubscribed ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            color: '#C77B8C',
            fontWeight: 500,
          }}
        >
          <span>♡</span>
          <span>通知はオンになっています</span>
        </div>
      ) : (
        <button
          onClick={handleEnable}
          disabled={!isSupported || !isStandalone || loading}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '14px',
            border: 'none',
            background: isStandalone ? '#D98A9C' : '#E8D5D8',
            color: '#FFFFFF',
            fontSize: '15px',
            fontWeight: 600,
            opacity: loading ? 0.6 : 1,
            cursor: isStandalone ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? '設定中...' : '通知を受け取る'}
        </button>
      )}
    </section>
  );
}
