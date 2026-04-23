
-- Add snooze columns to emails table
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS is_snoozed boolean NOT NULL DEFAULT false;
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS snooze_until timestamptz;
CREATE INDEX IF NOT EXISTS idx_emails_snooze ON public.emails (user_id) WHERE is_snoozed = true;

-- Add increment_knowledge_use_count RPC function
CREATE OR REPLACE FUNCTION public.increment_knowledge_use_count(row_id uuid, used_at timestamptz)
RETURNS void AS $$
  UPDATE public.knowledge_base
  SET use_count = COALESCE(use_count, 0) + 1, last_used_at = used_at
  WHERE id = row_id AND user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;
;
