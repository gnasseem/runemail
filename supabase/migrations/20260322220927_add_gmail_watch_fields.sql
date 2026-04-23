ALTER TABLE public.gmail_accounts
  ADD COLUMN IF NOT EXISTS history_id TEXT,
  ADD COLUMN IF NOT EXISTS watch_expiry TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gmail_accounts_address
  ON public.gmail_accounts (gmail_address);;
