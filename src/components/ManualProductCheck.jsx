import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

const availabilityLabels = {
  in_stock: '在庫あり',
  out_of_stock: '在庫なし',
  pre_order: '予約商品',
  limited: '残りわずか',
  unknown: '未確認',
};

export default function ManualProductCheck({ product, onUpdated }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  async function checkProduct() {
    if (checking || !product?.url) return;
    setChecking(true);
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('ログインが必要です');
      const response = await fetch('/api/check-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ productId: product.id, url: product.url }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '確認に失敗しました');
      const updated = { ...product, price: result.price ?? product.price, availability: result.availability || 'unknown', lastCheckedAt: result.checkedAt };
      onUpdated?.(updated);
      setMessage(`確認しました：${result.price === null ? '価格不明' : `¥${result.price.toLocaleString()}`}・${availabilityLabels[result.availability] || availabilityLabels.unknown}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: '#FFFFFF', border: '1px solid #F6DEE5' }} onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between mb-2.5 gap-3">
        <div>
          <p className="text-[13px] font-medium" style={{ color: '#4A3B40' }}>最新の価格・在庫</p>
          {product?.lastCheckedAt && <p className="text-[11px] mt-0.5" style={{ color: '#A98D95' }}>最終確認：{new Date(product.lastCheckedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
        </div>
        <button type="button" onClick={checkProduct} disabled={checking || !product?.url} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-medium whitespace-nowrap" style={{ background: '#FCEEF2', color: '#D46485', opacity: checking || !product?.url ? 0.5 : 1 }}>
          <RefreshCw size={14} style={{ animation: checking ? 'spin 0.9s linear infinite' : 'none' }} />
          {checking ? '確認中…' : '今すぐ確認'}
        </button>
      </div>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: '#A98D95' }}>
        <span>在庫：</span>
        <span style={{ color: '#4A3B40' }}>{availabilityLabels[product?.availability] || availabilityLabels.unknown}</span>
      </div>
      {message && <p className="text-[11px] mt-2" style={{ color: '#A98D95' }}>{message}</p>}
    </div>
  );
}
