-- Monotonic per-session turn indices for agent_turns, safe under parallel
-- bucket workers (single UPDATE row lock per allocation).

alter table public.agent_sessions
  add column if not exists next_turn_idx integer not null default 0;

-- Align with existing turns so the first alloc matches max(idx)+1.
update public.agent_sessions s
set next_turn_idx = coalesce(
  (select max(t.idx) + 1 from public.agent_turns t where t.session_id = s.id),
  0
);

create or replace function public.alloc_agent_turn_idx(
  p_session_id uuid,
  p_count integer default 1
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start int;
  v_count int;
begin
  v_count := greatest(coalesce(p_count, 1), 1);
  if not exists (
    select 1
    from public.agent_sessions
    where id = p_session_id and user_id = auth.uid()
  ) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  update public.agent_sessions
  set next_turn_idx = next_turn_idx + v_count
  where id = p_session_id and user_id = auth.uid()
  returning next_turn_idx - v_count into v_start;

  return v_start;
end;
$$;

revoke all on function public.alloc_agent_turn_idx(uuid, integer) from public;
grant execute on function public.alloc_agent_turn_idx(uuid, integer) to authenticated;
