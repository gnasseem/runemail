
CREATE TABLE IF NOT EXISTS draft_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  body_html text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE draft_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own drafts"
  ON draft_emails
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
;
