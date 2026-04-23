
CREATE TABLE IF NOT EXISTS public.email_signatures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  gmail_account_id uuid REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  html text NOT NULL DEFAULT '',
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.email_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own signatures" ON public.email_signatures
  FOR ALL USING (user_id = auth.uid());

-- Ensure only one default per user per account (or globally when account is null)
CREATE UNIQUE INDEX IF NOT EXISTS email_signatures_default_per_user
  ON public.email_signatures (user_id, COALESCE(gmail_account_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default = true;
;
