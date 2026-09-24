import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

const availabilityLabels = {
  in_stock: '在庫あり',
  out_of_stock: '在庫なし',
  pre_order: '予約商品',
  limited: '残りわずか',
  unknown: '判定できません',
};

export default function ManualProductCheck({ product, onUpdated }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  async function checkProduct() {
    if (checking || !product?.product_url) return;
    setChecking(true);
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('ログインが必要です');
      const response = await fetch('/api/check-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: product.product_url }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '確認に失敗しました');
      setMessage(`確認しました：${result.price === null ? '価格不明' : `¥${result.price.toLocaleString()}`}・${availabilityLabels[result.availability] || availabilityLabels.unknown}`);
      onUpdated?.({ ...product, current_price: result.price ?? product.current_price, availability: result.availability, last_checked_at: result.checkedAt });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={checkProduct} disabled={checking || !product?.product_url} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-500 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
        <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
        {checking ? '確認中…' : '価格・在庫を確認'}
      </button>
      {product?.availability && <p className="mt-1 text-xs text-neutral-400">在庫：{availabilityLabels[product.availability] || availabilityLabels.unknown}</p>}
      {message && <p className="mt-1 text-xs text-neutral-500">{message}</p>}
    </div>
  );
}
