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
    create policy "Invoices select own" on public.invoices for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices insert own'
  ) then
    create policy "Invoices insert own" on public.invoices for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices update own'
  ) then
    create policy "Invoices update own" on public.invoices for update using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'Invoices delete own'
  ) then
    create policy "Invoices delete own" on public.invoices for delete using (auth.uid() = user_id);
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
  add column if not exists items jsonb;

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
    create policy "Templates select own" on public.invoice_templates for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates insert own'
  ) then
    create policy "Templates insert own" on public.invoice_templates for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates update own'
  ) then
    create policy "Templates update own" on public.invoice_templates for update using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_templates' and policyname = 'Templates delete own'
  ) then
    create policy "Templates delete own" on public.invoice_templates for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Profiles table to store user metadata
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles select own'
  ) then
    create policy "Profiles select own" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles upsert own'
  ) then
    create policy "Profiles upsert own" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
  end if;
end $$;
