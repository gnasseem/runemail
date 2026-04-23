-- Auto-Resolve overhaul: parallel bucket sub-agents, batched questions,
-- reasoning trace.
--
-- The parent_id column is reserved for future nested-session use; the active
-- implementation keeps a single session and tags each turn / action with a
-- `bucket` so sub-agents running in parallel on distinct message threads all
-- share the same draft_actions and pending_questions array.
--
-- pending_questions[] holds batched questions (single or multi). The legacy
-- pending_question column is kept for back-compat during rollout.

alter table agent_sessions
  add column if not exists parent_id uuid references agent_sessions(id) on delete cascade,
  add column if not exists pending_questions jsonb not null default '[]'::jsonb,
  add column if not exists bucket text;

create index if not exists agent_sessions_parent_id_idx on agent_sessions(parent_id);

alter table agent_turns
  add column if not exists reasoning text,
  add column if not exists bucket text;

create index if not exists agent_turns_session_bucket_idx on agent_turns(session_id, bucket, idx);
