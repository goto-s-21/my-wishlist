-- 手動チェック機能用の追加テーブル・カラム
alter table public.products add column if not exists availability text default 'unknown';
alter table public.products add column if not exists last_checked_at timestamptz;
alter table public.products add column if not exists last_check_status text;

create table if not exists public.manual_price_checks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null default 'success',
  price integer,
  availability text default 'unknown'
);

create index if not exists manual_price_checks_product_checked_idx on public.manual_price_checks(product_id, checked_at desc);
create index if not exists manual_price_checks_user_checked_idx on public.manual_price_checks(user_id, checked_at desc);

alter table public.manual_price_checks enable row level security;
create policy "Users can read own manual checks" on public.manual_price_checks for select using (auth.uid() = user_id);
create policy "Users can insert own manual checks" on public.manual_price_checks for insert with check (auth.uid() = user_id);

-- productsの既存RLSがある前提。未設定の場合は既存のポリシー方針に合わせて設定してください。
