-- Ensure UUID extension is available
create extension if not exists "uuid-ossp";
-- ============================================================
-- 13. EMAIL TEMPLATES (reusable compose templates)
-- ============================================================
create table if not exists public.email_templates (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  subject text,
  body_html text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
create policy "Users can manage own email templates"
  on public.email_templates for all using (auth.uid() = user_id);
-- ============================================================
-- 14. EMAIL LINKS (cross-email relationships)
-- ============================================================
create table if not exists public.email_links (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  email_id_a uuid references public.emails(id) on delete cascade not null,
  email_id_b uuid references public.emails(id) on delete cascade not null,
  link_type text not null,
  strength real default 1.0,
  created_at timestamptz not null default now(),
  unique(email_id_a, email_id_b, link_type)
);
alter table public.email_links enable row level security;
create policy "Users can manage own email links"
  on public.email_links for all using (auth.uid() = user_id);
-- ============================================================
-- 15. KNOWLEDGE BASE (entity/fact store for AI context)
-- ============================================================
create table if not exists public.knowledge_base (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  entity text not null,
  entity_type text not null,
  info text not null,
  source text,
  confidence real default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, entity, entity_type)
);
alter table public.knowledge_base enable row level security;
create policy "Users can manage own knowledge base"
  on public.knowledge_base for all using (auth.uid() = user_id);
-- ============================================================
-- 16. DELEGATION RULES
-- ============================================================
create table if not exists public.delegation_rules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  pattern text not null,
  target_email text not null,
  is_enabled boolean not null default true,
  weight integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.delegation_rules enable row level security;
create policy "Users can manage own delegation rules"
  on public.delegation_rules for all using (auth.uid() = user_id);
-- ============================================================
-- 17. CATEGORY RULES (learned content-based categorization)
-- ============================================================
create table if not exists public.category_rules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  match_type text not null,
  match_value text not null,
  category_slug text not null,
  hits integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, match_type, match_value)
);
alter table public.category_rules enable row level security;
create policy "Users can manage own category rules"
  on public.category_rules for all using (auth.uid() = user_id);
-- ============================================================
-- 18. STYLE PROFILES (learned writing style from sent mail)
-- ============================================================
create table if not exists public.style_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  greeting_style text,
  closing_style text,
  tone text,
  avg_length text,
  patterns jsonb default '[]'::jsonb,
  sample_count integer not null default 0,
  last_learned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.style_profiles enable row level security;
create policy "Users can manage own style profile"
  on public.style_profiles for all using (auth.uid() = user_id);
-- ============================================================
-- Add columns to email_processed for richer AI data
-- ============================================================
alter table public.email_processed
  add column if not exists thread_context text,
  add column if not exists related_context text,
  add column if not exists enriched_context text,
  add column if not exists delegate_to text,
  add column if not exists needs_action boolean not null default false;
-- ============================================================
-- Add style_notes to profiles for quick style reference
-- ============================================================
alter table public.profiles
  add column if not exists style_notes text,
  add column if not exists working_hours jsonb;
