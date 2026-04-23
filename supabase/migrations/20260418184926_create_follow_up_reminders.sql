
CREATE TABLE IF NOT EXISTS public.follow_up_reminders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  email_id uuid REFERENCES public.emails(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  remind_at timestamptz NOT NULL,
  status text DEFAULT 'waiting' NOT NULL CHECK (status IN ('waiting', 'replied', 'dismissed', 'snoozed')),
  snooze_until timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, thread_id)
);

ALTER TABLE public.follow_up_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own follow-up reminders" ON public.follow_up_reminders
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS follow_up_reminders_user_status_idx
  ON public.follow_up_reminders (user_id, status, remind_at);
;
