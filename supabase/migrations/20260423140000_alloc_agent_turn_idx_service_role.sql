-- alloc_agent_turn_idx previously required user_id = auth.uid() in an EXISTS
-- check. Edge functions call this RPC with the service role, where auth.uid()
-- is null, so every allocation failed with "session not found".

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

  if auth.uid() is not null then
    update public.agent_sessions
    set next_turn_idx = next_turn_idx + v_count
    where id = p_session_id
      and user_id = auth.uid()
    returning next_turn_idx - v_count into v_start;
  else
    update public.agent_sessions
    set next_turn_idx = next_turn_idx + v_count
    where id = p_session_id
    returning next_turn_idx - v_count into v_start;
  end if;

  if v_start is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  return v_start;
end;
$$;
