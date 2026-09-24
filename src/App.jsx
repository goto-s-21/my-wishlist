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
