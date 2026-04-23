-- Add structural signal columns to emails table for smarter categorization.
-- These are extracted from email headers at fetch time and used during AI analysis.

alter table public.emails
  add column if not exists has_list_unsubscribe boolean not null default false,
  add column if not exists is_reply boolean not null default false,
  add column if not exists reply_to_email text,
  add column if not exists cc_recipients text,
  add column if not exists precedence_header text;
