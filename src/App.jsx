import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search, Heart, Plus, Home as HomeIcon, Settings as SettingsIcon,
  ChevronLeft, Pencil, Trash2, ImagePlus, Link2, ExternalLink,
  Bell, Tag, LogOut, RotateCcw, X, Check, ArrowDownRight,
  ShoppingBag, ChevronRight, Loader2
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { uploadProductImage } from "./lib/uploadImage";
import NotificationSettings from "./components/NotificationSettings";
import ManualProductCheck from "./components/ManualProductCheck";

const C = {
  bg: "#FDE6EC", card: "#FFFFFF", pink: "#FFD9E3", pinkSoft: "#FCEEF2",
  pinkDeep: "#E8879F", pinkStrong: "#D46485", beige: "#FBEAEE",
  beigeDeep: "#E3B6C4", ink: "#4A3B40", inkSoft: "#A98D95",
  line: "#F6DEE5", danger: "#D97A88",
};
const NAV_HEIGHT = 76;
const FORM_BAR_HEIGHT = 84;
const SONOTA_NAME = "その他";
const DEFAULT_CATEGORY_NAMES = [
  "服", "コスメ", "美容", "家電", "PC・スマホ", "本", "食品", "生活用品", SONOTA_NAME,
];

function formatPrice(n) {
  if (n === null || n === undefined || n === "") return null;
  return "¥" + Number(n).toLocaleString("ja-JP");
}
function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function isDropped(p) {
  return p.initialPrice != null && p.price != null && Number(p.price) < Number(p.initialPrice);
}
function dropAmount(p) {
  return Number(p.initialPrice) - Number(p.price);
}
function StockBadge({ product, style }) {
  const status = product.availability || product.stockStatus;
  if (status !== "low_stock" && status !== "out_of_stock") return null;
  const isOut = status === "out_of_stock";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full text-[11px] font-medium px-2 py-[2px]"
      style={{
        background: isOut ? "#EDE3E5" : C.pink,
        color: isOut ? C.ink : C.pinkStrong,
        ...style,
      }}
    >
      {isOut ? "在庫切れ" : "残りわずか"}
    </span>
  );
}

function resizeImage(file, maxSize = 900, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   Supabase data helpers
--------------------------------------------------------- */
function rowToProduct(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image_url || "",
    price: row.current_price,
    initialPrice: row.initial_price,
    url: row.product_url || "",
    categoryId: row.category_id,
    priority: row.priority,
    memo: row.memo || "",
    purchased: row.purchased,
    priceCheckEnabled: row.price_check_enabled,
    stockStatus: row.stock_status || "unknown",
    createdAt: new Date(row.created_at).getTime(),
    availability: row.availability || "unknown",
    lastCheckedAt: row.last_checked_at || null,
    history: (row.price_history || [])
      .slice()
      .sort((a, b) => new Date(a.checked_at) - new Date(b.checked_at))
      .map((h) => ({ date: new Date(h.checked_at).getTime(), price: h.price, source: h.source })),
  };
}

async function ensureDefaultCategories(userId) {
  const { data: existing, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  if (existing && existing.length > 0) return existing;

  const rows = DEFAULT_CATEGORY_NAMES.map((name) => ({ user_id: userId, name }));
  const { data: inserted, error: insertError } = await supabase
    .from("categories")
    .insert(rows)
    .select();
  if (insertError) throw insertError;
  return inserted;
}

async function fetchProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*, price_history(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToProduct);
}

/* ---------------------------------------------------------
   Small shared components
--------------------------------------------------------- */
function HeartRating({ value = 0, size = 15, editable = false, onChange }) {
  const Item = editable ? "button" : "span";
  return (
    <div className="flex items-center gap-[2px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <Item
          key={i}
          type={editable ? "button" : undefined}
          disabled={editable ? false : undefined}
          onClick={editable ? (e) => { e.stopPropagation(); onChange && onChange(i); } : undefined}
          style={{ lineHeight: 0, cursor: editable ? "pointer" : "default", padding: editable ? 4 : 0, display: "inline-flex" }}
        >
          <Heart
            size={size}
            fill={i <= value ? C.pinkStrong : "none"}
            color={i <= value ? C.pinkStrong : C.beigeDeep}
            strokeWidth={1.6}
          />
        </Item>
      ))}
    </div>
  );
}

function PriceDropBadge({ product, style }) {
  if (!isDropped(product)) return null;
  return (
    <span
      className="inline-flex items-center gap-[2px] rounded-full text-[11px] font-medium px-2 py-[2px]"
      style={{ background: C.pink, color: C.pinkStrong, ...style }}
    >
      <ArrowDownRight size={11} strokeWidth={2.4} />
      {formatPrice(dropAmount(product))} OFF
    </span>
  );
}

function ProductCard({ product, onClick})  {
  return (
    <button
      onClick={onClick}
      className="text-left w-full rounded-[20px] overflow-hidden flex flex-col"
      style={{ background: C.card, boxShadow: "0 2px 12px rgba(212,100,133,0.14)" }}
    >
      <div className="w-full aspect-square relative" style={{ background: C.beige }}>
        {product.image ? (
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ color: C.beigeDeep }}>
            <ShoppingBag size={28} strokeWidth={1.5} />
          </div>
        )}
        {product.purchased && (
          <div
            className="absolute top-2 left-2 rounded-full text-[10px] px-2 py-[3px] font-medium"
            style={{ background: "rgba(74,59,64,0.72)", color: "#fff" }}
          >
            購入済み
          </div>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-1">
        <div className="text-[13px] leading-snug" style={{ color: C.ink }}>
          {product.name.length > 22 ? product.name.slice(0, 22) + "…" : product.name}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-semibold" style={{ color: C.ink }}>
            {formatPrice(product.price) ?? "価格未登録"}
          </span>
        </div>
        <PriceDropBadge product={product} style={{ alignSelf: "flex-start" }} />
              <StockBadge product={product} style={{ alignSelf: "flex-start" }} />
        <HeartRating value={product.priority} size={12} />
      </div>
    </button>
  );
}

function EmptyGridSlot() {
  return (
    <div
      className="w-full rounded-[20px]"
      style={{
        aspectRatio: "0.78",
        background: `repeating-linear-gradient(135deg, ${C.pinkSoft} 0px, ${C.pinkSoft} 10px, transparent 10px, transparent 20px)`,
        border: `1.5px dashed ${C.beigeDeep}`,
        opacity: 0.6,
      }}
    />
  );
}

function ProductGrid({ items, onOpen, minSlots = 0 }) {
  const placeholders = Math.max(0, minSlots - items.length);
  return (
    <div className="grid grid-cols-2 gap-3 px-4">
      {items.map((p) => (
        <ProductCard key={p.id} product={p} onClick={() => onOpen(p.id)} />
      ))}
      {Array.from({ length: placeholders }).map((_, i) => (
        <EmptyGridSlot key={`ph-${i}`} />
      ))}
    </div>
  );
}

function HScrollCard({ product, onClick, wide }) {
  return (
    <button
      onClick={onClick}
      className="text-left flex-shrink-0 rounded-[18px] overflow-hidden"
      style={{ width: wide ? 210 : 128, background: C.card, boxShadow: "0 2px 12px rgba(212,100,133,0.14)" }}
    >
      {wide ? (
        <div className="flex items-stretch">
          <div className="w-[86px] h-[86px] flex-shrink-0" style={{ background: C.beige }}>
            {product.image && <img src={product.image} alt="" className="w-full h-full object-cover" />}
          </div>
          <div className="p-2.5 flex flex-col justify-center gap-1 min-w-0">
            <div className="text-[12.5px] truncate" style={{ color: C.ink }}>{product.name}</div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[14px] font-semibold" style={{ color: C.ink }}>{formatPrice(product.price)}</span>
            </div>
            <PriceDropBadge product={product} />
          </div>
        </div>
      ) : (
        <>
          <div className="w-full aspect-square" style={{ background: C.beige }}>
            {product.image && <img src={product.image} alt="" className="w-full h-full object-cover" />}
          </div>
          <div className="px-2 py-2">
            <div className="text-[11.5px] truncate mb-0.5" style={{ color: C.ink }}>{product.name}</div>
            <div className="text-[13px] font-semibold" style={{ color: C.ink }}>{formatPrice(product.price) ?? "—"}</div>
          </div>
        </>
      )}
    </button>
  );
}

function SectionHeader({ title, onMore }) {
  return (
    <div className="flex items-center justify-between px-4 mb-2.5">
      <h2 className="text-[13px] font-semibold tracking-wide" style={{ color: C.pinkStrong }}>{title}</h2>
      {onMore && (
        <button onClick={onMore} className="text-[11.5px] flex items-center" style={{ color: C.inkSoft }}>
          More <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}

function TopBar({ title, onBack, right }) {
  return (
    <div className="flex items-center justify-between px-3 py-3" style={{ minHeight: 52 }}>
      <div className="w-9">
        {onBack && (
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full">
            <ChevronLeft size={22} color={C.ink} />
          </button>
        )}
      </div>
      <div className="text-[15px] font-semibold" style={{ color: C.ink }}>{title}</div>
      <div className="w-9 flex justify-end">{right}</div>
    </div>
  );
}

function BottomNav({ screen, go }) {
  const items = [
    { key: "home", icon: HomeIcon, label: "Home" },
    { key: "list", icon: Heart, label: "Wishlist" },
    { key: "add", icon: Plus, label: "Add", accent: true },
    { key: "settings", icon: SettingsIcon, label: "More" },
  ];
  const active = ["home", "list", "add", "settings"].includes(screen) ? screen : null;
  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full flex justify-around items-center z-40"
      style={{
        maxWidth: 430, height: NAV_HEIGHT, background: "rgba(253,230,236,0.96)", backdropFilter: "blur(6px)",
        borderTop: `1px solid ${C.line}`, paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxSizing: "border-box",
      }}
    >
      {items.map((it) => {
        const isActive = active === it.key;
        const Icon = it.icon;
        if (it.accent) {
          return (
            <button key={it.key} onClick={() => go(it.key)} className="flex flex-col items-center gap-1">
              <div className="rounded-full flex items-center justify-center" style={{ width: 44, height: 44, background: C.pinkStrong }}>
                <Icon size={21} color="#fff" strokeWidth={2} />
              </div>
            </button>
          );
        }
        return (
          <button key={it.key} onClick={() => go(it.key)} className="flex flex-col items-center gap-1 px-3">
            <Icon size={21} strokeWidth={1.8} color={isActive ? C.pinkStrong : C.inkSoft} fill={it.key === "list" && isActive ? C.pinkStrong : "none"} />
            <span className="text-[10px]" style={{ color: isActive ? C.pinkStrong : C.inkSoft }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toast({ toast, onOpen, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 4200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full flex justify-center z-50" style={{ maxWidth: 430, paddingTop: "env(safe-area-inset-top, 10px)" }}>
      <button
        onClick={onOpen}
        className="mx-3 mt-2 w-full rounded-2xl px-4 py-3 text-left toast-anim"
        style={{ background: C.pinkStrong, color: "#fff", boxShadow: "0 8px 24px rgba(212,100,133,0.35)" }}
      >
        <div className="flex items-center gap-1.5 text-[12px] mb-1" style={{ color: "#FFE3EA" }}>
          <Heart size={12} fill="#FFE3EA" /> 値下がりしました
        </div>
        <div className="text-[13.5px] font-medium">{toast.body}</div>
        <div className="text-[12.5px] mt-0.5" style={{ color: "rgba(255,255,255,0.8)" }}>{toast.priceLine} ・ {toast.offLine}</div>
      </button>
    </div>
  );
}

function ConfirmModal({ dialog, onCancel }) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(74,59,64,0.4)" }} onClick={onCancel}>
      <div
        className="w-full mx-auto rounded-t-[26px] p-5 pb-8"
        style={{ maxWidth: 430, background: C.card }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 16px" }} />
        <div className="text-[15px] font-semibold mb-1.5" style={{ color: C.ink }}>{dialog.title}</div>
        {dialog.message && <div className="text-[13px] mb-5" style={{ color: C.inkSoft }}>{dialog.message}</div>}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-3 rounded-2xl text-[14px]" style={{ background: C.bg, color: C.ink }}>
            キャンセル
          </button>
          <button
            onClick={dialog.onConfirm}
            className="flex-1 py-3 rounded-2xl text-[14px] font-medium"
            style={{ background: dialog.danger ? C.danger : C.pinkStrong, color: "#fff" }}
          >
            {dialog.confirmLabel || "実行する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Product form (add / edit)
--------------------------------------------------------- */
function ProductForm({ initial, categories, isNew, onCancel, onSave, onManageCategories, userId }) {
  const [mode, setMode] = useState("manual");
  const [urlDraft, setUrlDraft] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [showFields, setShowFields] = useState(!isNew);

  const [name, setName] = useState(initial?.name || "");
  const [image, setImage] = useState(initial?.image || "");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [price, setPrice] = useState(initial?.price ?? "");
  const [url, setUrl] = useState(initial?.url || "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId || categories[0]?.id);
  const [priority, setPriority] = useState(initial?.priority ?? 3);
  const [memo, setMemo] = useState(initial?.memo || "");
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  async function handleFetchUrl() {
    if (!urlDraft.trim()) return;
    setFetching(true);
    setFetchMsg("");
    try {
      const res = await fetch(`/api/fetch-product-info?url=${encodeURIComponent(urlDraft.trim())}`);
      const info = await res.json();

      const nextName = info.title || name;
      const nextImage = info.image || image;
      const nextPrice = info.price ? String(Math.round(Number(info.price))) : price;
      const nextMsg = info.title || info.image
        ? "取得できた情報を反映しました。残りは入力してください。"
        : "自動取得できませんでした。情報を入力してください。";

      setFetching(false);
      setName(nextName);
      setImage(nextImage);
      setPrice(nextPrice);
      setUrl(urlDraft.trim());
      setFetchMsg(nextMsg);
      setShowFields(true);
    } catch (e) {
      setFetching(false);
      setUrl(urlDraft.trim());
      setFetchMsg("自動取得できませんでした（サイトの仕様により取得できない場合があります）。情報を入力してください。");
      setShowFields(true);
    }
  }

  async function handleImagePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setFetchMsg("");
    try {
      const resizedDataUrl = await resizeImage(file);
      const blob = await (await fetch(resizedDataUrl)).blob();
      const uploadFile = new File([blob], file.name || "image.jpg", { type: "image/jpeg" });
      const publicUrl = await uploadProductImage(uploadFile, userId);
      setImage(publicUrl);
    } catch (err) {
      setFetchMsg("画像のアップロードに失敗しました。もう一度お試しください。");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setSaving(true);
    const priceNum = price === "" || price === null ? null : Number(price);
    try {
      await onSave({ name: name.trim(), image, price: priceNum, url: url.trim(), categoryId, priority, memo: memo.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ paddingBottom: showFields ? FORM_BAR_HEIGHT + 24 : 24 }}>
      <TopBar title={isNew ? "商品を登録" : "商品を編集"} onBack={onCancel} />

      {isNew && !showFields && (
        <div className="px-4">
          <div className="flex rounded-full p-1 mb-5" style={{ background: C.beige }}>
            {[["url", "URLから登録"], ["manual", "手動で登録"]].map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setMode(k); if (k === "manual") setShowFields(true); }}
                className="flex-1 py-2 rounded-full text-[13px] font-medium"
                style={mode === k ? { background: C.pinkStrong, color: "#fff" } : { color: C.ink }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "url" && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[12.5px]" style={{ color: C.inkSoft }}>
                商品ページのURLを入力してください。取得できる範囲で商品名・画像・価格を自動で読み込みます。
              </div>
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none"
                style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink }}
              />
              <button
                onClick={handleFetchUrl}
                disabled={fetching || !urlDraft.trim()}
                className="w-full py-3 rounded-2xl text-[14px] font-medium flex items-center justify-center gap-2"
                style={{ background: C.pinkStrong, color: "#fff", opacity: fetching || !urlDraft.trim() ? 0.5 : 1 }}
              >
                {fetching ? <Loader2 size={16} className="spin" /> : <Link2 size={15} />}
                {fetching ? "取得中…" : "情報を取得する"}
              </button>
              <button onClick={() => setShowFields(true)} className="text-[12.5px] underline self-center mt-1" style={{ color: C.inkSoft }}>
                自動取得せずに手入力する
              </button>
            </div>
          )}
        </div>
      )}

      {showFields && (
        <div className="px-4 flex flex-col gap-5">
          {fetchMsg && (
            <div className="text-[12.5px] rounded-xl px-3 py-2.5" style={{ background: C.pink, color: C.pinkStrong }}>
              {fetchMsg}
            </div>
          )}

          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingImage}
              className="w-full aspect-square rounded-[22px] flex flex-col items-center justify-center gap-2 overflow-hidden"
              style={{ background: C.beige, border: `1px dashed ${C.beigeDeep}`, opacity: uploadingImage ? 0.7 : 1 }}
            >
              {uploadingImage ? (
                <>
                  <Loader2 size={26} className="spin" color={C.inkSoft} />
                  <span className="text-[12.5px]" style={{ color: C.inkSoft }}>アップロード中…</span>
                </>
              ) : image ? (
                <img src={image} alt="" className="w-full h-full object-cover" />
              ) : (
                <>
                  <ImagePlus size={26} color={C.inkSoft} strokeWidth={1.6} />
                  <span className="text-[12.5px]" style={{ color: C.inkSoft }}>画像を選択（任意）</span>
                </>
              )}
            </button>
          </div>

          <Field label="商品名" required error={nameError && "商品名を入力してください"}>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(false); }}
              placeholder="例）ニットカーディガン"
              className="w-full bg-transparent outline-none text-[14.5px]"
              style={{ color: C.ink }}
            />
          </Field>

          <Field label="価格（任意）">
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="未定なら空欄でOK"
              inputMode="numeric"
              className="w-full bg-transparent outline-none text-[14.5px]"
              style={{ color: C.ink }}
            />
          </Field>

          <Field label="URL（任意）">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-transparent outline-none text-[14.5px]"
              style={{ color: C.ink }}
            />
          </Field>

          <Field label="カテゴリー">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full bg-transparent outline-none text-[14.5px] py-0.5 pr-5"
                  style={{ color: C.ink }}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} color={C.inkSoft} className="absolute right-0 pointer-events-none" />
              </div>
              <button onClick={onManageCategories} className="text-[12px] flex-shrink-0" style={{ color: C.inkSoft }}>
                管理
              </button>
            </div>
          </Field>

          <div>
            <div className="text-[12px] mb-2" style={{ color: C.inkSoft }}>優先度</div>
            <HeartRating value={priority} editable size={24} onChange={setPriority} />
          </div>

          <Field label="メモ（任意）" area>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="サイズ、色違い、気になる点など"
              rows={3}
              className="w-full bg-transparent outline-none text-[14px] resize-none"
              style={{ color: C.ink }}
            />
          </Field>
        </div>
      )}

      {showFields && (
        <div
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full px-4 flex items-center z-40"
          style={{
            maxWidth: 430, height: FORM_BAR_HEIGHT,
            background: `linear-gradient(180deg, rgba(253,230,236,0), ${C.bg} 40%)`,
            boxSizing: "border-box", paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <button
            onClick={handleSave}
            disabled={saving || uploadingImage}
            className="w-full py-3.5 rounded-2xl text-[15px] font-medium flex items-center justify-center gap-2"
            style={{ background: C.pinkStrong, color: "#fff", opacity: saving || uploadingImage ? 0.6 : 1 }}
          >
            {saving && <Loader2 size={16} className="spin" />}
            保存する
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, required, error, area }) {
  return (
    <div>
      <div className="text-[12px] mb-1.5 flex items-center gap-1" style={{ color: error ? C.danger : C.inkSoft }}>
        {label}
        {required && <span style={{ color: C.pinkStrong }}>*</span>}
      </div>
      <div
        className={area ? "rounded-2xl px-4 py-3" : "rounded-2xl px-4 py-3.5"}
        style={{ background: C.card, border: `1px solid ${error ? C.danger : C.line}` }}
      >
        {children}
      </div>
      {error && <div className="text-[11.5px] mt-1" style={{ color: C.danger }}>{error}</div>}
    </div>
  );
}

/* ---------------------------------------------------------
   Main App
--------------------------------------------------------- */
export default function WishlistApp() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadError, setLoadError] = useState("");
  const initializedRef = useRef(false);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [notifSettings, setNotifSettings] = useState({ priceDropEnabled: true });

  const [screen, setScreen] = useState("login");
  const [selectedId, setSelectedId] = useState(null);
  const [listFilter, setListFilter] = useState("all");
  const [listSort, setListSort] = useState("priority");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [checkMsg, setCheckMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setScreen("login");
      setProducts([]);
      setCategories([]);
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    (async () => {
      try {
        setLoadError("");
        const cats = await ensureDefaultCategories(session.user.id);
        setCategories(cats);
        const prods = await fetchProducts();
        setProducts(prods);
        setScreen("home");
      } catch (e) {
        setLoadError("データの読み込みに失敗しました。読み込み直してください。");
      }
    })();
  }, [session]);

  function go(key) {
    setScreen(key);
    setCheckMsg("");
  }

  function openProduct(id) {
    setSelectedId(id);
    setCheckMsg("");
    setScreen("detail");
  }

  /* ---- auth ---- */
  async function handleLogin() {
    setLoggingIn(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }
  function handleLogout() {
    setDialog({
      title: "ログアウトしますか？",
      message: "データはこのアカウントに保存されたままです。",
      confirmLabel: "ログアウト",
      onConfirm: async () => {
        await supabase.auth.signOut();
        setDialog(null);
      },
    });
  }
  function handleResetData() {
    setDialog({
      title: "データをリセットしますか？",
      message: "登録した商品がすべて削除されます。この操作は取り消せません。",
      confirmLabel: "リセットする",
      danger: true,
      onConfirm: async () => {
        const ids = products.map((p) => p.id);
        if (ids.length > 0) {
          await supabase.from("products").delete().in("id", ids);
        }
        setProducts([]);
        setDialog(null);
        setScreen("home");
      },
    });
  }

  /* ---- products ---- */
  async function addProduct(fields) {
    const now = new Date().toISOString();
    const insertRow = {
      user_id: session.user.id,
      name: fields.name,
      image_url: fields.image || null,
      current_price: fields.price,
      initial_price: fields.price,
      product_url: fields.url || null,
      category_id: fields.categoryId,
      priority: fields.priority,
      memo: fields.memo || null,
      purchased: false,
      price_check_enabled: Boolean(fields.url) && fields.price != null,
    };
    const { data: inserted, error } = await supabase
      .from("products")
      .insert(insertRow)
      .select()
      .single();
    if (error) { setCheckMsg("保存に失敗しました。"); return; }

    if (fields.price != null) {
      await supabase.from("price_history").insert({
        product_id: inserted.id,
        price: fields.price,
        checked_at: now,
        source: "initial",
      });
    }
    const prods = await fetchProducts();
    setProducts(prods);
    openProduct(inserted.id);
  }

  async function saveEdit(id, fields) {
    const existing = products.find((p) => p.id === id);
    const priceChanged = fields.price !== existing.price;

    const { error } = await supabase
      .from("products")
      .update({
        name: fields.name,
        image_url: fields.image || null,
        current_price: fields.price,
        product_url: fields.url || null,
        category_id: fields.categoryId,
        priority: fields.priority,
        memo: fields.memo || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) { setCheckMsg("更新に失敗しました。"); return; }

    if (priceChanged && fields.price != null) {
      await supabase.from("price_history").insert({
        product_id: id,
        price: fields.price,
        checked_at: new Date().toISOString(),
        source: "manual_edit",
      });
    }
    const prods = await fetchProducts();
    setProducts(prods);
    openProduct(id);
  }

  function deleteProduct(id) {
    setDialog({
      title: "この商品を削除しますか？",
      message: "削除すると元に戻せません。",
      confirmLabel: "削除する",
      danger: true,
      onConfirm: async () => {
        await supabase.from("products").delete().eq("id", id);
        setProducts((prev) => prev.filter((p) => p.id !== id));
        setDialog(null);
        setScreen("list");
      },
    });
  }

  async function togglePurchased(id) {
    const target = products.find((p) => p.id === id);
    const next = !target.purchased;
    await supabase.from("products").update({ purchased: next }).eq("id", id);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, purchased: next } : p)));
  }

  async function togglePriceCheck(id) {
    const target = products.find((p) => p.id === id);
    const next = !target.priceCheckEnabled;
    await supabase.from("products").update({ price_check_enabled: next }).eq("id", id);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, priceCheckEnabled: next } : p)));
  }

  function simulateCheck(product) {
    const eligible = !product.purchased && product.priceCheckEnabled && product.url && product.price != null;
    if (!eligible) {
      setCheckMsg("この商品は自動チェックの対象外です（URL・価格・チェックONが必要）。");
      return;
    }
    setCheckMsg("自動チェックは1日1回、サーバー側で実行されます。今すぐの手動確認はこのプレビューではサポートしていません。");
  }

  /* ---- categories ---- */
  async function addCategory(name) {
    if (!name.trim() || !session) return;
    const { data: inserted, error } = await supabase
      .from("categories")
      .insert({ user_id: session.user.id, name: name.trim() })
      .select()
      .single();
    if (!error) setCategories((prev) => [...prev, inserted]);
  }
  async function renameCategory(id, name) {
    if (!name.trim()) return;
    const { error } = await supabase.from("categories").update({ name: name.trim() }).eq("id", id);
    if (!error) setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
  }
  function deleteCategory(id) {
    const target = categories.find((c) => c.id === id);
    if (target?.name === SONOTA_NAME) return;
    setDialog({
      title: "このカテゴリーを削除しますか？",
      message: "このカテゴリーの商品は「その他」に移動します。",
      confirmLabel: "削除する",
      danger: true,
      onConfirm: async () => {
        const sonota = categories.find((c) => c.name === SONOTA_NAME);
        const affected = products.filter((p) => p.categoryId === id);
        if (sonota && affected.length > 0) {
          await supabase.from("products").update({ category_id: sonota.id }).in("id", affected.map((p) => p.id));
        }
        await supabase.from("categories").delete().eq("id", id);
        setCategories((prev) => prev.filter((c) => c.id !== id));
        setProducts((prev) => prev.map((p) => (p.categoryId === id && sonota ? { ...p, categoryId: sonota.id } : p)));
        setDialog(null);
      },
    });
  }

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || SONOTA_NAME;

  const myWishlist = useMemo(
    () => products.filter((p) => !p.purchased).sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt),
    [products]
  );
  const priceDrops = useMemo(() => products.filter((p) => !p.purchased && isDropped(p)), [products]);
  const recentlyAdded = useMemo(() => [...products].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10), [products]);

  const filteredList = useMemo(() => {
    let list = [...products];
    if (listFilter === "unpurchased") list = list.filter((p) => !p.purchased);
    else if (listFilter === "purchased") list = list.filter((p) => p.purchased);
    else if (listFilter === "pricedrop") list = list.filter((p) => isDropped(p));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.memo || "").toLowerCase().includes(q) ||
          categoryName(p.categoryId).toLowerCase().includes(q)
      );
    }
    if (listSort === "priority") list.sort((a, b) => b.priority - a.priority);
    else if (listSort === "new") list.sort((a, b) => b.createdAt - a.createdAt);
    else if (listSort === "cheap") list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (listSort === "drop") list.sort((a, b) => (isDropped(b) ? dropAmount(b) : -1) - (isDropped(a) ? dropAmount(a) : -1));
    return list;
  }, [products, listFilter, listSort, searchQuery, categories]);

  const selected = products.find((p) => p.id === selectedId);

  if (!booted) {
    return (
      <div className="w-full h-full min-h-[600px] flex items-center justify-center" style={{ background: C.bg }}>
        <Loader2 className="spin" size={22} color={C.inkSoft} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.beigeDeep, display: "flex", justifyContent: "center" }}>
      <style>{`
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif; }
        button { -webkit-tap-highlight-color: transparent; }
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .toast-anim { animation: slideDown 0.28s ease-out; }
        @keyframes slideDown { from { transform: translateY(-16px); opacity:0; } to { transform: translateY(0); opacity:1; } }
        ::-webkit-scrollbar { display: none; }
        select { -webkit-appearance: none; appearance: none; }
        @media (prefers-reduced-motion: reduce) { .spin, .toast-anim { animation: none !important; } }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${C.pinkStrong}; outline-offset: 2px; }
      `}</style>

      <div className="w-full relative" style={{ maxWidth: 430, background: C.bg, minHeight: "100vh" }}>
        <Toast toast={toast} onClose={() => setToast(null)} onOpen={() => { openProduct(toast.productId); setToast(null); }} />
        <ConfirmModal dialog={dialog} onCancel={() => setDialog(null)} />

        {screen === "login" && (
          <div className="flex flex-col items-center justify-center px-8" style={{ minHeight: 640 }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Heart size={20} fill={C.pinkStrong} color={C.pinkStrong} />
              <span className="text-[20px] font-semibold tracking-wide" style={{ color: C.ink }}>my wishlist</span>
            </div>
            <p className="text-[13px] text-center mb-14" style={{ color: C.inkSoft }}>
              Wishing is half the fun.
            </p>
            {loadError && (
              <div className="text-[12px] mb-4" style={{ color: C.danger }}>{loadError}</div>
            )}
            <button
              onClick={handleLogin}
              disabled={loggingIn}
              className="w-full max-w-[280px] flex items-center justify-center gap-2.5 rounded-full py-3.5"
              style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 2px 10px rgba(212,100,133,0.1)" }}
            >
              {loggingIn ? (
                <Loader2 size={16} className="spin" color={C.inkSoft} />
              ) : (
                <svg width="17" height="17" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.86 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.03l2.99-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>
              )}
              <span className="text-[14px] font-medium" style={{ color: C.ink }}>
                {loggingIn ? "ログイン中…" : "Googleでログイン"}
              </span>
            </button>
          </div>
        )}

        {screen === "home" && (
          <div style={{ paddingTop: 8, paddingBottom: NAV_HEIGHT + 16 }}>
            <div className="px-4 mb-4">
              <div className="flex items-center gap-1.5 mb-4">
                <Heart size={16} fill={C.pinkStrong} color={C.pinkStrong} />
                <span className="text-[16px] font-semibold" style={{ color: C.ink }}>my wishlist</span>
              </div>
              <button
                onClick={() => { setSearchQuery(""); go("list"); }}
                className="w-full flex items-center gap-2 rounded-full px-4 py-3"
                style={{ background: C.card, border: `1px solid ${C.line}` }}
              >
                <Search size={16} color={C.inkSoft} />
                <span className="text-[13.5px]" style={{ color: C.inkSoft }}>Search your wishlist</span>
              </button>
            </div>

            <SectionHeader title="MY WISHLIST" onMore={myWishlist.length > 4 ? () => { setListFilter("unpurchased"); setListSort("priority"); go("list"); } : null} />
            {myWishlist.length === 0 ? (
              <EmptyState onAdd={() => go("add")} />
            ) : (
              <div className="mb-7">
                <ProductGrid
                  items={myWishlist.slice(0, 4)}
                  onOpen={openProduct}
                  onUpdated={(updated) => {
                    setProducts((current) =>
                      current.map((item) =>
                        item.id === updated.id ? updated : item
                      )
                    );
                  }}
                  minSlots={myWishlist.length < 2 ? 2 : 0}
                />
              </div>
            )}

            {priceDrops.length > 0 && (
              <>
                <SectionHeader title="PRICE DROP" />
                <div className="flex gap-3 px-4 mb-7 overflow-x-auto pb-1">
                  {priceDrops.map((p) => (
                    <HScrollCard key={p.id} product={p} wide onClick={() => openProduct(p.id)} />
                  ))}
                </div>
              </>
            )}

            {recentlyAdded.length > 0 && (
              <>
                <SectionHeader title="RECENTLY ADDED" />
                <div className="flex gap-3 px-4 overflow-x-auto pb-1">
                  {recentlyAdded.map((p) => (
                    <HScrollCard key={p.id} product={p} onClick={() => openProduct(p.id)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {screen === "list" && (
          <div style={{ paddingTop: 4, paddingBottom: NAV_HEIGHT + 16 }}>
            <div className="px-4">
              <div className="text-[16px] font-semibold mb-3" style={{ color: C.ink }}>Wishlist</div>
              <div className="w-full flex items-center gap-2 rounded-full px-4 py-3 mb-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <Search size={16} color={C.inkSoft} />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="商品名・メモ・カテゴリーで検索"
                  className="flex-1 bg-transparent outline-none text-[13.5px]"
                  style={{ color: C.ink }}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")}><X size={15} color={C.inkSoft} /></button>
                )}
              </div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-1.5 overflow-x-auto">
                  {[["all", "すべて"], ["unpurchased", "未購入"], ["purchased", "購入済み"], ["pricedrop", "値下がり"]].map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setListFilter(k)}
                      className="rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap flex-shrink-0"
                      style={listFilter === k ? { background: C.pinkStrong, color: "#fff" } : { background: C.card, color: C.inkSoft, border: `1px solid ${C.line}` }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end mb-3">
                <div className="relative flex items-center">
                  <select
                    value={listSort}
                    onChange={(e) => setListSort(e.target.value)}
                    className="text-[12px] rounded-full pl-3 pr-7 py-1.5"
                    style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink }}
                  >
                    <option value="priority">優先度が高い順</option>
                    <option value="new">新しく追加した順</option>
                    <option value="cheap">価格が安い順</option>
                    <option value="drop">値下がりした順</option>
                  </select>
                  <ChevronDown size={13} color={C.inkSoft} className="absolute right-2.5 pointer-events-none" />
                </div>
              </div>
            </div>

            {filteredList.length === 0 ? (
              <div className="text-center text-[13px] py-16" style={{ color: C.inkSoft }}>見つかりませんでした</div>
            ) : (
              <ProductGrid
                items={myWishlist.slice(0, 4)}
                onOpen={openProduct}
                onUpdated={(updated) => {
                  setProducts((current) =>
                    current.map((item) =>
                      item.id === updated.id ? updated : item
                    )
                  );
                }}
                minSlots={myWishlist.length < 2 ? 2 : 0}
              />
            )}
          </div>
        )}

        {screen === "detail" && selected && (
          <div style={{ paddingBottom: 32 }}>
            <TopBar
              title=""
              onBack={() => go("list")}
              right={
                <div className="flex items-center gap-3">
                  <button onClick={() => go("edit")}><Pencil size={18} color={C.ink} /></button>
                  <button onClick={() => deleteProduct(selected.id)}><Trash2 size={18} color={C.danger} /></button>
                </div>
              }
            />
            <div className="px-4">
              <div className="w-full aspect-square rounded-[22px] overflow-hidden mb-4" style={{ background: C.beige }}>
                {selected.image ? (
                  <img src={selected.image} alt={selected.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><ShoppingBag size={36} color={C.beigeDeep} /></div>
                )}
              </div>

              <span className="inline-block rounded-full text-[11px] px-2.5 py-1 mb-2" style={{ background: C.beige, color: C.pinkStrong }}>
                {categoryName(selected.categoryId)}
              </span>
              <div className="text-[19px] font-semibold mb-2" style={{ color: C.ink }}>{selected.name}</div>

              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[22px] font-semibold" style={{ color: C.ink }}>
                  {formatPrice(selected.price) ?? "価格未登録"}
                </span>
                {isDropped(selected) && (
                  <span className="text-[13px] line-through" style={{ color: C.inkSoft }}>{formatPrice(selected.initialPrice)}</span>
                )}
              </div>
              <PriceDropBadge product={selected} style={{ marginBottom: 12 }} />
          <StockBadge product={selected} style={{ marginBottom: 12 }} />

              <div className="mb-5"><HeartRating value={selected.priority} size={18} /></div>
              <ManualProductCheck
                product={selected}
                onUpdated={(updated) => {
                  setProducts((current) =>
                      current.map((item) =>
                          item.id === updated.id
                                  ? {
                                      ...item,
                                      ...updated,
                                    }
                                  : item
                              )
                            );
                          }}
                        />

              {selected.memo && (
                <div className="rounded-2xl px-4 py-3 mb-5 text-[13.5px] leading-relaxed" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink }}>
                  {selected.memo}
                </div>
              )}

              {selected.url && (
                <a href={selected.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-2xl px-4 py-3.5 mb-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                  <span className="text-[13.5px]" style={{ color: C.ink }}>購入ページを見る</span>
                  <ExternalLink size={15} color={C.inkSoft} />
                </a>
              )}

              <button
                onClick={() => togglePurchased(selected.id)}
                className="w-full py-3.5 rounded-2xl text-[14.5px] font-medium mb-6"
                style={selected.purchased ? { background: C.bg, color: C.ink, border: `1px solid ${C.line}` } : { background: C.pinkStrong, color: "#fff" }}
              >
                {selected.purchased ? "未購入に戻す" : "購入済みにする"}
              </button>

              <div className="rounded-2xl p-4 mb-6" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-medium" style={{ color: C.ink }}>価格を自動チェック</span>
                  <Toggle
                    checked={selected.priceCheckEnabled}
                    disabled={!selected.url || selected.price == null || selected.purchased}
                    onChange={() => togglePriceCheck(selected.id)}
                  />
                </div>
                {(!selected.url || selected.price == null) && (
                  <div className="text-[11.5px] mb-2" style={{ color: C.inkSoft }}>URLと価格がある商品のみ設定できます</div>
                )}
                <button
                  onClick={() => simulateCheck(selected)}
                  className="w-full mt-2 py-2.5 rounded-xl text-[12.5px]"
                  style={{ background: C.bg, color: C.ink }}
                >
                  価格チェックについて
                </button>
                {checkMsg && <div className="text-[11.5px] mt-2" style={{ color: C.inkSoft }}>{checkMsg}</div>}
              </div>

              {selected.history.length > 0 && (
                <div>
                  <div className="text-[13px] font-semibold mb-2.5" style={{ color: C.ink }}>価格履歴</div>
                  <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                    {selected.history.map((h, i) => {
                      const min = Math.min(...selected.history.map((x) => x.price));
                      return (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: i > 0 ? `1px solid ${C.line}` : "none" }}>
                          <span className="text-[12.5px]" style={{ color: C.inkSoft }}>{formatDate(h.date)}</span>
                          <div className="flex items-center gap-2">
                            {h.price === min && (
                              <span className="text-[10px] rounded-full px-2 py-[2px]" style={{ background: C.pink, color: C.pinkStrong }}>最安</span>
                            )}
                            <span className="text-[13.5px] font-medium" style={{ color: C.ink }}>{formatPrice(h.price)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {(screen === "add" || screen === "edit") && (
          <ProductForm
            key={screen === "edit" ? selected?.id : "new"}
            isNew={screen === "add"}
            initial={screen === "edit" ? selected : null}
            categories={categories}
            userId={session?.user?.id}
            onCancel={() => go(screen === "edit" ? "detail" : "home")}
            onManageCategories={() => go("categories")}
            onSave={(fields) => (screen === "add" ? addProduct(fields) : saveEdit(selected.id, fields))}
          />
        )}

        {screen === "categories" && (
          <CategoriesScreen
            categories={categories}
            products={products}
            onBack={() => go("settings")}
            onAdd={addCategory}
            onRename={renameCategory}
            onDelete={deleteCategory}
          />
        )}

        {screen === "notifications" && (
          <div style={{ paddingBottom: 16 }}>
            <TopBar title="通知設定" onBack={() => go("settings")} />
            <div className="px-4">
              <NotificationSettings session={session} />
            </div>
          </div>
        )}

        {screen === "settings" && (
          <div style={{ paddingBottom: NAV_HEIGHT + 16 }}>
            <TopBar title="その他" />
            <div className="px-4">
              <div className="flex items-center gap-3 rounded-2xl p-4 mb-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44, background: C.pink, color: C.pinkStrong, fontWeight: 600 }}>
                  {(session?.user?.user_metadata?.full_name || session?.user?.email || "?")[0]}
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate" style={{ color: C.ink }}>
                    {session?.user?.user_metadata?.full_name || "ユーザー"}
                  </div>
                  <div className="text-[12px] truncate" style={{ color: C.inkSoft }}>{session?.user?.email}</div>
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden mb-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <SettingsRow icon={Tag} label="カテゴリー管理" onClick={() => go("categories")} />
                <SettingsRow icon={Bell} label="通知設定" onClick={() => go("notifications")} border />
              </div>

              <div className="rounded-2xl overflow-hidden mb-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <SettingsRow icon={RotateCcw} label="データをリセット" onClick={handleResetData} danger />
                <SettingsRow icon={LogOut} label="ログアウト" onClick={handleLogout} border danger />
              </div>

              <p className="text-[11px] leading-relaxed px-1" style={{ color: C.inkSoft }}>
                商品データはSupabase（あなたのGoogleアカウント）に安全に保存されます。
              </p>
            </div>
          </div>
        )}

        {["home", "list", "settings"].includes(screen) && <BottomNav screen={screen} go={go} />}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className="rounded-full relative flex-shrink-0"
      style={{ width: 42, height: 24, background: checked ? C.pinkStrong : C.beige, opacity: disabled ? 0.4 : 1, transition: "background 0.15s" }}
    >
      <span
        className="absolute rounded-full"
        style={{ width: 18, height: 18, top: 3, left: checked ? 21 : 3, background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
      />
    </button>
  );
}

function SettingsRow({ icon: Icon, label, onClick, border, danger }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between px-4 py-3.5" style={{ borderTop: border ? `1px solid ${C.line}` : "none" }}>
      <div className="flex items-center gap-2.5">
        <Icon size={16} color={danger ? C.danger : C.ink} />
        <span className="text-[13.5px]" style={{ color: danger ? C.danger : C.ink }}>{label}</span>
      </div>
      <ChevronRight size={15} color={C.inkSoft} />
    </button>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="mx-4 rounded-2xl flex flex-col items-center justify-center py-12 mb-7" style={{ background: C.card, border: `1px dashed ${C.beigeDeep}` }}>
      <Heart size={22} color={C.beigeDeep} strokeWidth={1.5} />
      <p className="text-[12.5px] mt-3 mb-4" style={{ color: C.inkSoft }}>まだ何も登録されていません</p>
      <button onClick={onAdd} className="rounded-full px-4 py-2 text-[12.5px] font-medium" style={{ background: C.pinkStrong, color: "#fff" }}>
        + 欲しいものを追加
      </button>
    </div>
  );
}

function CategoriesScreen({ categories, products, onBack, onAdd, onRename, onDelete }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const countFor = (id) => products.filter((p) => p.categoryId === id).length;

  return (
    <div style={{ paddingBottom: 32 }}>
      <TopBar title="カテゴリー管理" onBack={onBack} />
      <div className="px-4">
        <div className="flex gap-2 mb-5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新しいカテゴリー名"
            className="flex-1 rounded-2xl px-4 py-3 text-[13.5px] outline-none"
            style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink }}
          />
          <button
            onClick={() => { onAdd(newName); setNewName(""); }}
            disabled={!newName.trim()}
            className="rounded-2xl px-4 flex items-center justify-center"
            style={{ background: C.pinkStrong, opacity: newName.trim() ? 1 : 0.4 }}
          >
            <Plus size={17} color="#fff" />
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          {categories.map((c, i) => {
            const protected_ = c.name === SONOTA_NAME;
            const editing = editingId === c.id;
            return (
              <div key={c.id} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i > 0 ? `1px solid ${C.line}` : "none" }}>
                {editing ? (
                  <input
                    autoFocus
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-[13.5px] mr-2"
                    style={{ color: C.ink, borderBottom: `1px solid ${C.line}` }}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px]" style={{ color: C.ink }}>{c.name}</span>
                    <span className="text-[11px]" style={{ color: C.inkSoft }}>{countFor(c.id)}件</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {editing ? (
                    <>
                      <button onClick={() => { onRename(c.id, editVal); setEditingId(null); }}><Check size={16} color={C.ink} /></button>
                      <button onClick={() => setEditingId(null)}><X size={16} color={C.inkSoft} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(c.id); setEditVal(c.name); }}><Pencil size={14} color={C.inkSoft} /></button>
                      {!protected_ && <button onClick={() => onDelete(c.id)}><Trash2 size={14} color={C.danger} /></button>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
=======
const DEFAULT_CATEGORY_NAMES = ["服", "コスメ", "美容", "家電", "PC・スマホ", "本", "食品", "生活用品", SONOTA_NAME];
function formatPrice(n) { if (n === null || n === undefined || n === "") return null; return "¥" + Number(n).toLocaleString("ja-JP"); }
function formatDate(ts) { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; }
function isDropped(p) { return p.initialPrice != null && p.price != null && Number(p.price) < Number(p.initialPrice); }
function dropAmount(p) { return Number(p.initialPrice) - Number(p.price); }
function rowToProduct(row) { return { id: row.id, name: row.name, image: row.image_url || "", price: row.current_price, initialPrice: row.initial_price, url: row.product_url || "", categoryId: row.category_id, priority: row.priority, memo: row.memo || "", purchased: row.purchased, priceCheckEnabled: row.price_check_enabled, stockStatus: row.stock_status || "unknown", availability: row.availability || "unknown", lastCheckedAt: row.last_checked_at || null, createdAt: new Date(row.created_at).getTime(), history: (row.price_history || []).slice().sort((a, b) => new Date(a.checked_at) - new Date(b.checked_at)).map((h) => ({ date: new Date(h.checked_at).getTime(), price: h.price, source: h.source })) }; }
function StockBadge({ product, style }) { const status = product.availability || product.stockStatus; if (!status || status === "unknown") return null; const labels = { in_stock: "在庫あり", out_of_stock: "在庫なし", pre_order: "予約", limited: "残りわずか", low_stock: "残りわずか" }; return <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, fontSize: 11, padding: "2px 8px", background: status === "out_of_stock" ? "#EDE3E5" : C.pink, color: status === "out_of_stock" ? C.ink : C.pinkStrong, ...style }}>{labels[status] || status}</span>; }
function HeartRating({ value = 0, size = 15, editable = false, onChange }) { const Item = editable ? "button" : "span"; return <div className="flex items-center gap-[2px]">{[1, 2, 3, 4, 5].map((i) => <Item key={i} type={editable ? "button" : undefined} disabled={editable ? false : undefined} onClick={editable ? (e) => { e.stopPropagation(); onChange && onChange(i); } : undefined} style={{ lineHeight: 0, cursor: editable ? "pointer" : "default", padding: editable ? 4 : 0, display: "inline-flex" }}><Heart size={size} fill={i <= value ? C.pinkStrong : "none"} color={i <= value ? C.pinkStrong : C.beigeDeep} strokeWidth={1.6} /></Item>)}</div>; }
function PriceDropBadge({ product, style }) { if (!isDropped(product)) return null; return <span className="inline-flex items-center gap-[2px] rounded-full text-[11px] font-medium px-2 py-[2px]" style={{ background: C.pink, color: C.pinkStrong, ...style }}><ArrowDownRight size={11} strokeWidth={2.4} />{formatPrice(dropAmount(product))} OFF</span>; }
function ProductCard({ product, onClick }) { return <button onClick={onClick} className="text-left w-full rounded-20px overflow-hidden flex flex-col" style={{ background: C.card, boxShadow: "0 2px 12px rgba(212,100,133,0.14)" }}><div className="w-full aspect-square relative" style={{ background: C.beige }}>{product.image ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center" style={{ color: C.beigeDeep }}><ShoppingBag size={28} strokeWidth={1.5} /></div>}{product.purchased && <div className="absolute top-2 left-2 rounded-full text-[10px] px-2 py-[3px] font-medium" style={{ background: "rgba(74,59,64,0.72)", color: "#fff" }}>購入済み</div>}</div><div className="px-3 pt-2.5 pb-3 flex flex-col gap-1"><div className="text-[13px] leading-snug" style={{ color: C.ink }}>{product.name.length > 22 ? product.name.slice(0, 22) + "…" : product.name}</div><div className="flex items-center gap-1.5"><span className="text-[15px] font-semibold" style={{ color: C.ink }}>{formatPrice(product.price) ?? "価格未設定"}</span></div><div className="flex flex-wrap gap-1"><PriceDropBadge product={product} /><StockBadge product={product} /></div><HeartRating value={product.priority} size={12} /></div></button>; }
function EmptyGridSlot() { return <div className="w-full rounded-20px" style={{ aspectRatio: "0.78", background: `repeating-linear-gradient(135deg, ${C.pinkSoft} 0px, ${C.pinkSoft} 10px, transparent 10px, transparent 20px)`, border: `1.5px dashed ${C.beigeDeep}`, opacity: 0.6 }} />; }
function ProductGrid({ items, onOpen, minSlots = 0 }) { const placeholders = Math.max(0, minSlots - items.length); return <div className="grid grid-cols-2 gap-3 px-4">{items.map((p) => <ProductCard key={p.id} product={p} onClick={() => onOpen(p.id)} />)}{Array.from({ length: placeholders }).map((_, i) => <EmptyGridSlot key={`ph-${i}`} />)}</div>; }
// detail view includes ManualProductCheck immediately after the priority rating
>>>>>>> f1ad7d90bb98fc210d59de933e1d216648124c2c
