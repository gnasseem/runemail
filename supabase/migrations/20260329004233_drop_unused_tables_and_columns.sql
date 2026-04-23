
-- Drop email_links table (never written to or read anywhere in the codebase)
drop table if exists public.email_links;

-- Drop dead columns on email_processed (added in migration 001 but never queried)
alter table public.email_processed
  drop column if exists thread_context,
  drop column if exists related_context,
  drop column if exists enriched_context,
  drop column if exists delegate_to,
  drop column if exists needs_action;
;
