CREATE INDEX IF NOT EXISTS idx_emails_user_received ON emails(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_processed_email_id ON email_processed(email_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_completed ON todos(user_id, is_completed);
CREATE INDEX IF NOT EXISTS idx_meetings_user_start ON meetings(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_read_receipts_tracking ON read_receipts(tracking_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_user_importance ON knowledge_base(user_id, importance, use_count DESC);;
