alter table public.knowledge_base
  add column if not exists use_count integer not null default 0,
  add column if not exists last_used_at timestamptz;

create or replace function public.increment_knowledge_use_count(row_id uuid, used_at timestamptz)
returns void language sql security definer as $$
  update public.knowledge_base
  set use_count = use_count + 1, last_used_at = used_at
  where id = row_id;
$$;;
