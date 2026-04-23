-- Agent sessions: conversational Solve-Everything agent state.
--
-- Each session represents one "clear my briefing" run. The agent loop writes
-- turns (assistant messages, tool calls, tool results, user answers) and
-- progressively builds a draft action plan. When the agent finalizes, the user
-- reviews and executes approved actions.

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  briefing_at timestamptz,
  status text not null default 'planning'
    check (status in ('planning', 'asking', 'ready', 'executing', 'done', 'error', 'cancelled')),
  -- Staged actions the agent is building up. Each action:
  --   { id, type: 'reply'|'todo'|'meeting'|'archive', payload: {...}, reasoning, selected, edited }
  draft_actions jsonb not null default '[]'::jsonb,
  -- If status = 'asking', this is the current QuestionCard payload:
  --   { id, eyebrow, brief, question, options: [{id,label,rationale,preview?}], allowCustom, multi? }
  pending_question jsonb,
  -- Final plan set when status becomes 'ready'
  plan jsonb,
  -- Execution results keyed by action id: { [actionId]: { status: 'success'|'error', info?, error? } }
  results jsonb not null default '{}'::jsonb,
  summary text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_sessions_user_id_idx on agent_sessions(user_id);
create index if not exists agent_sessions_status_idx on agent_sessions(user_id, status);

-- Full conversation history: system/user/assistant/tool turns. Content is a JSON
-- payload whose shape depends on the role. Ordered by idx within a session.
create table if not exists agent_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references agent_sessions(id) on delete cascade,
  idx integer not null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool', 'status')),
  content jsonb not null,
  tool_name text,
  tool_call_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_turns_session_idx_uniq on agent_turns(session_id, idx);
create index if not exists agent_turns_session_id_idx on agent_turns(session_id);

-- RLS: users can only see their own sessions.
alter table agent_sessions enable row level security;
alter table agent_turns enable row level security;

drop policy if exists "agent_sessions own" on agent_sessions;
create policy "agent_sessions own" on agent_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "agent_turns own" on agent_turns;
create policy "agent_turns own" on agent_turns
  for all
  using (exists (
    select 1 from agent_sessions s where s.id = session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from agent_sessions s where s.id = session_id and s.user_id = auth.uid()
  ));

-- Auto-update updated_at on mutations.
create or replace function set_agent_sessions_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_sessions_updated_at on agent_sessions;
create trigger agent_sessions_updated_at
  before update on agent_sessions
  for each row execute function set_agent_sessions_updated_at();

-- Enable realtime broadcast so the frontend can subscribe to session + turn changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agent_sessions'
  ) then
    alter publication supabase_realtime add table agent_sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agent_turns'
  ) then
    alter publication supabase_realtime add table agent_turns;
  end if;
end $$;
