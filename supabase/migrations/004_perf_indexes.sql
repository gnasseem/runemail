-- Performance indexes for multi-user scale
-- These cover the most common per-user queries that would otherwise do full table scans.

-- email_memory: looked up on every /fetch-emails call to update sender interaction counts
create index if not exists idx_email_memory_user_sender
  on public.email_memory(user_id, sender_email);

-- todos: filtered by user_id in TodosView
create index if not exists idx_todos_user_id
  on public.todos(user_id);

-- meetings: filtered by user_id + start_time in MeetingsView
create index if not exists idx_meetings_user_start
  on public.meetings(user_id, start_time);

-- read_receipts: filtered by user_id in ReceiptsView
create index if not exists idx_read_receipts_user_id
  on public.read_receipts(user_id);

-- knowledge_base: filtered by user_id in KnowledgeView and entity extraction
create index if not exists idx_knowledge_base_user_id
  on public.knowledge_base(user_id);
