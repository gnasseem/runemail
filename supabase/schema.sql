-- ============================================================
-- RuneMail Supabase Schema + Row Level Security
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. USER PROFILES
-- ============================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  display_name text,
  avatar_url text,
  ai_mode text not null default 'cloud' check (ai_mode in ('cloud', 'local', 'hybrid')),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. GMAIL ACCOUNTS (multi-account support)
-- ============================================================
create table public.gmail_accounts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  gmail_address text not null,
  tokens_encrypted text not null,  -- encrypted OAuth tokens
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, gmail_address)
);

alter table public.gmail_accounts enable row level security;

create policy "Users can manage own gmail accounts"
  on public.gmail_accounts for all using (auth.uid() = user_id);

-- ============================================================
-- 3. EMAILS
-- ============================================================
create table public.emails (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  gmail_id text not null,
  thread_id text,
  gmail_account_id uuid references public.gmail_accounts(id) on delete cascade,
  subject text,
  sender text,
  sender_email text,
  recipients text,
  snippet text,
  body_text text,
  body_html text,
  received_at timestamptz,
  is_read boolean not null default false,
  is_starred boolean not null default false,
  is_archived boolean not null default false,
  is_snoozed boolean not null default false,
  snooze_until timestamptz,
  label_ids text[],
  has_attachments boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, gmail_id)
);

alter table public.emails enable row level security;

create policy "Users can manage own emails"
  on public.emails for all using (auth.uid() = user_id);

create index idx_emails_user_received on public.emails(user_id, received_at desc);
create index idx_emails_user_gmail_id on public.emails(user_id, gmail_id);
create index idx_emails_thread on public.emails(user_id, thread_id);

-- ============================================================
-- 4. EMAIL PROCESSING RESULTS
-- ============================================================
create table public.email_processed (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  email_id uuid references public.emails(id) on delete cascade not null unique,
  category text not null default 'informational',
  extra_labels text[],
  summary text,
  is_urgent boolean not null default false,
  urgent_reason text,
  quick_actions jsonb default '[]'::jsonb,
  processed_at timestamptz not null default now()
);

alter table public.email_processed enable row level security;

create policy "Users can manage own processed emails"
  on public.email_processed for all using (auth.uid() = user_id);

-- ============================================================
-- 5. CUSTOM CATEGORIES / LABELS
-- ============================================================
create table public.categories (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  slug text not null,
  display_name text not null,
  color text default '#6b7280',
  rules jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, slug)
);

alter table public.categories enable row level security;

create policy "Users can manage own categories"
  on public.categories for all using (auth.uid() = user_id);

-- ============================================================
-- 6. TODOS
-- ============================================================
create table public.todos (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  email_id uuid references public.emails(id) on delete set null,
  text text not null,
  is_completed boolean not null default false,
  source text default 'manual',
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

create policy "Users can manage own todos"
  on public.todos for all using (auth.uid() = user_id);

-- ============================================================
-- 7. SCHEDULED EMAILS (Koyeb worker processes these)
-- ============================================================
create table public.scheduled_emails (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  gmail_account_id uuid references public.gmail_accounts(id) on delete cascade not null,
  to_addresses text[] not null,
  cc_addresses text[],
  bcc_addresses text[],
  subject text not null,
  body_html text not null,
  in_reply_to text,
  thread_id text,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  error_message text,
  tracking_id uuid,
  created_at timestamptz not null default now()
);

alter table public.scheduled_emails enable row level security;

create policy "Users can manage own scheduled emails"
  on public.scheduled_emails for all using (auth.uid() = user_id);

create index idx_scheduled_pending on public.scheduled_emails(status, send_at)
  where status = 'pending';

-- ============================================================
-- 8. READ RECEIPTS / TRACKING
-- ============================================================
create table public.read_receipts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  email_id uuid references public.emails(id) on delete set null,
  tracking_id uuid not null unique default uuid_generate_v4(),
  recipient_email text,
  subject text,
  open_count integer not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  opens jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.read_receipts enable row level security;

create policy "Users can manage own read receipts"
  on public.read_receipts for all using (auth.uid() = user_id);

-- ============================================================
-- 9. MEETINGS
-- ============================================================
create table public.meetings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  email_id uuid references public.emails(id) on delete set null,
  title text not null,
  description text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  attendees text[],
  location text,
  calendar_event_id text,
  zoom_link text,
  status text default 'proposed' check (status in ('proposed', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.meetings enable row level security;

create policy "Users can manage own meetings"
  on public.meetings for all using (auth.uid() = user_id);

-- ============================================================
-- 10. EMAIL MEMORY (sender history, relationships)
-- ============================================================
create table public.email_memory (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  sender_email text not null,
  sender_name text,
  interaction_count integer not null default 1,
  last_subject text,
  last_interaction_at timestamptz not null default now(),
  relationship_notes text,
  created_at timestamptz not null default now(),
  unique(user_id, sender_email)
);

alter table public.email_memory enable row level security;

create policy "Users can manage own email memory"
  on public.email_memory for all using (auth.uid() = user_id);

-- ============================================================
-- 11. STORAGE BUCKET FOR RAW EMAIL FILES
-- ============================================================
insert into storage.buckets (id, name, public)
values ('email-files', 'email-files', false);

create policy "Users can upload own email files"
  on storage.objects for insert
  with check (bucket_id = 'email-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can read own email files"
  on storage.objects for select
  using (bucket_id = 'email-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own email files"
  on storage.objects for delete
  using (bucket_id = 'email-files' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- 12. UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();
