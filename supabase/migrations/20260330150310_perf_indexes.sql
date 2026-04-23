-- Missing indexes on email_processed for category filter queries
CREATE INDEX IF NOT EXISTS idx_email_processed_user_id
  ON public.email_processed(user_id);

CREATE INDEX IF NOT EXISTS idx_email_processed_user_category
  ON public.email_processed(user_id, category);

-- Full-text search: generated tsvector column replaces 5x ilike scans
-- Weights: subject=A, sender/sender_email=B, snippet=C, body_text=D
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(sender, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(sender_email, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(snippet, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(body_text, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_emails_search_vector
  ON public.emails USING GIN(search_vector);

-- pg_cron: reset watch_expiry daily so /fetch-emails renews Gmail push watches
-- before they expire (Gmail watches expire after 7 days).
SELECT cron.schedule(
  'renew-gmail-watches',
  '0 3 * * *',
  $$
  UPDATE public.gmail_accounts
  SET watch_expiry = NULL
  WHERE is_active = true
    AND (watch_expiry IS NULL OR watch_expiry < now() + interval '2 days');
  $$
);;
