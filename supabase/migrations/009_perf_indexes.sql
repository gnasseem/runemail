-- Additional performance indexes identified from query patterns

-- gmail_accounts: frequently filtered by is_active (active account lookups in
-- both frontend and edge function use eq("user_id").eq("is_active", true))
CREATE INDEX IF NOT EXISTS idx_gmail_accounts_user_active
  ON public.gmail_accounts(user_id, is_active);

-- emails: GIN index on label_ids array for array-containment queries
-- (contains("label_ids", ["SENT"]) in SentView, BriefingView, InboxView)
CREATE INDEX IF NOT EXISTS idx_emails_label_ids
  ON public.emails USING GIN(label_ids);

-- follow_up_reminders: no indexes exist; listed and updated per user
CREATE INDEX IF NOT EXISTS idx_follow_up_reminders_user_id
  ON public.follow_up_reminders(user_id);

-- follow_up_reminders: upsert conflict key and lookup in EmailDetail
CREATE INDEX IF NOT EXISTS idx_follow_up_reminders_user_thread
  ON public.follow_up_reminders(user_id, thread_id);

-- todos: TodosView joins back to emails by email_id for preview;
-- existing idx_todos_user_id only covers user_id scans
CREATE INDEX IF NOT EXISTS idx_todos_user_email_id
  ON public.todos(user_id, email_id);

-- scheduled_emails: ScheduledView lists all statuses ordered by send_at;
-- the existing partial index only covers status = 'pending'
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_user_send_at
  ON public.scheduled_emails(user_id, send_at);
