alter table public.profiles
  add column if not exists last_briefing jsonb,
  add column if not exists last_briefing_at timestamptz;;
