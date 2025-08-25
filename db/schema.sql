-- Enable required extensions
create extension if not exists pgcrypto;

-- Invoices table
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric not null,
  currency text not null check (char_length(currency) between 3 and 6),
  customer text not null,
  status text not null check (status in ('pending','paid','void')) default 'pending',
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_invoices_created_at on public.invoices (created_at desc);
create index if not exists idx_invoices_status on public.invoices (status);
create index if not exists idx_invoices_user on public.invoices (user_id);

-- RLS: enable and restrict access to owner
alter table public.invoices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices select own'
  ) then
    create policy "Invoices select own" on public.invoices for select using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices insert own'
  ) then
    create policy "Invoices insert own" on public.invoices for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices update own'
  ) then
    create policy "Invoices update own" on public.invoices for update using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices delete own'
  ) then
    create policy "Invoices delete own" on public.invoices for delete using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Wallets: USD-based internal ledger per user
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  currency text not null default 'USD' check (currency = 'USD'),
  balance_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Ensure one wallet per user per currency
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public' and indexname = 'wallets_user_currency_unique'
  ) then
    create unique index wallets_user_currency_unique on public.wallets (user_id, currency);
  end if;
end $$;

create index if not exists idx_wallets_user on public.wallets (user_id);

alter table public.wallets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'wallets' and policyname = 'Wallets select own'
  ) then
    create policy "Wallets select own" on public.wallets for select using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'wallets' and policyname = 'Wallets insert own'
  ) then
    create policy "Wallets insert own" on public.wallets for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'wallets' and policyname = 'Wallets update own'
  ) then
    create policy "Wallets update own" on public.wallets for update using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Helper: atomic increment of wallet balance
create or replace function public.increment_wallet_balance(p_wallet_id uuid, p_amount bigint)
returns void
language sql
security definer
as $$
  update public.wallets
  set balance_cents = balance_cents + p_amount
  where id = p_wallet_id;
$$;

-- Wallet transactions (credits/debits)
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  type text not null check (type in ('credit','debit')),
  amount_cents bigint not null check (amount_cents > 0),
  reference text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_tx_user on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'wallet_transactions' and policyname = 'WalletTx select own'
  ) then
    create policy "WalletTx select own" on public.wallet_transactions for select using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'wallet_transactions' and policyname = 'WalletTx insert own'
  ) then
    create policy "WalletTx insert own" on public.wallet_transactions for insert with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- Payment intents (mock provider-backed)
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','expired')),
  provider text not null default 'mock',
  provider_ref text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists idx_payment_intents_user on public.payment_intents (user_id, created_at desc);

alter table public.payment_intents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_intents' and policyname = 'Intents select own'
  ) then
    create policy "Intents select own" on public.payment_intents for select using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_intents' and policyname = 'Intents insert own'
  ) then
    create policy "Intents insert own" on public.payment_intents for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_intents' and policyname = 'Intents update own'
  ) then
    create policy "Intents update own" on public.payment_intents for update using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Enhance invoices with itemization and metadata
alter table if exists public.invoices
  add column if not exists company_name text,
  add column if not exists company_address text,
  add column if not exists client_email text,
  add column if not exists client_address text,
  add column if not exists issue_date date,
  add column if not exists due_date date,
  add column if not exists notes text,
  add column if not exists tax_rate numeric,
  add column if not exists items jsonb,
  add column if not exists template_kind text not null default 'simple' check (template_kind in ('simple','detailed','proforma'));

-- Invoice Templates table
create table if not exists public.invoice_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  items jsonb not null,
  tax_rate numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.invoice_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates select own'
  ) then
    create policy "Templates select own" on public.invoice_templates for select using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates insert own'
  ) then
    create policy "Templates insert own" on public.invoice_templates for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates update own'
  ) then
    create policy "Templates update own" on public.invoice_templates for update using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates delete own'
  ) then
    create policy "Templates delete own" on public.invoice_templates for delete using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Profiles table to store user metadata
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  plan text not null default 'free',
  settings jsonb,
  created_at timestamptz not null default now()
);

-- Add avatar_id for preset avatar selections
alter table if exists public.profiles
  add column if not exists avatar_id integer;

-- Company profile fields and logo reference
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'company_name'
  ) then
    alter table public.profiles drop column company_name;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'company_address'
  ) then
    alter table public.profiles drop column company_address;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'logo_path'
  ) then
    alter table public.profiles drop column logo_path;
  end if;
end $$;

alter table public.profiles enable row level security;

-- Replace overlapping policies to avoid multiple permissive SELECT policies
do $$
begin
  -- Drop old policies if they exist (to allow redefinition)
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles upsert own'
  ) then
    drop policy "Profiles upsert own" on public.profiles;
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles select own'
  ) then
    drop policy "Profiles select own" on public.profiles;
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles insert own'
  ) then
    drop policy "Profiles insert own" on public.profiles;
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles update own'
  ) then
    drop policy "Profiles update own" on public.profiles;
  end if;

  -- Recreate non-overlapping policies with optimized auth calls
  create policy "Profiles select own" on public.profiles for select using ((select auth.uid()) = id);
  create policy "Profiles insert own" on public.profiles for insert with check ((select auth.uid()) = id);
  create policy "Profiles update own" on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
end $$;
