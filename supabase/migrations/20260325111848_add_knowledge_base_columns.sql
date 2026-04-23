alter table public.knowledge_base
  add column if not exists importance text not null default 'normal'
    check (importance in ('critical', 'high', 'normal', 'low')),
  add column if not exists use_count integer not null default 0,
  add column if not exists last_used_at timestamptz;;
