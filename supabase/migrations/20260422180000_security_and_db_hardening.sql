-- ============================================================
-- Security + data-integrity hardening
--
-- Fixes multiple IDOR vectors where a user could insert a row
-- referencing another user's resource (gmail_account_id, email_id)
-- and have the service-role workers operate on it.
-- Adds user scoping to SECURITY DEFINER RPCs.
-- Adds missing columns (scheduled_emails.body_text) and perf
-- indexes referenced by the app but never created.
-- Caps unbounded growth on read_receipts.opens.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cross-row ownership triggers
-- ------------------------------------------------------------
-- Generic check: if the row references a gmail_account_id, require
-- that gmail_account belongs to the same user_id as the row.
create or replace function public.assert_gmail_account_user_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if new.gmail_account_id is null then
    return new;
  end if;
  select user_id into owner
    from public.gmail_accounts
    where id = new.gmail_account_id;
  if owner is null then
    raise exception 'gmail_account_id % does not exist', new.gmail_account_id
      using errcode = '23503';
  end if;
  if owner <> new.user_id then
    raise exception 'gmail_account_id does not belong to user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_gmail_account_user_match() from public;

drop trigger if exists scheduled_emails_account_owner on public.scheduled_emails;
create trigger scheduled_emails_account_owner
  before insert or update of user_id, gmail_account_id
  on public.scheduled_emails
  for each row
  execute function public.assert_gmail_account_user_match();

-- email_signatures.gmail_account_id is nullable (global signature), but
-- when set must belong to the user.
drop trigger if exists email_signatures_account_owner on public.email_signatures;
create trigger email_signatures_account_owner
  before insert or update of user_id, gmail_account_id
  on public.email_signatures
  for each row
  execute function public.assert_gmail_account_user_match();

-- Generic check: if the row references an email_id, require that email
-- belongs to the same user_id as the row. Protects todos, meetings,
-- read_receipts, email_processed from pointing at another user's email.
create or replace function public.assert_email_user_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if new.email_id is null then
    return new;
  end if;
  select user_id into owner
    from public.emails
    where id = new.email_id;
  if owner is null then
    -- Email row was deleted between select and insert, let FK handle it
    return new;
  end if;
  if owner <> new.user_id then
    raise exception 'email_id does not belong to user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_email_user_match() from public;

do $$
declare
  t text;
begin
  foreach t in array array['todos', 'meetings', 'read_receipts', 'email_processed', 'follow_up_reminders']
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_email_owner', t
    );
    execute format(
      'create trigger %I before insert or update of user_id, email_id on public.%I for each row execute function public.assert_email_user_match()',
      t || '_email_owner', t
    );
  end loop;
end$$;

-- Same-user check when emails.gmail_account_id is set.
drop trigger if exists emails_account_owner on public.emails;
create trigger emails_account_owner
  before insert or update of user_id, gmail_account_id
  on public.emails
  for each row
  execute function public.assert_gmail_account_user_match();

-- ------------------------------------------------------------
-- 2. Restore user guard on increment_knowledge_use_count
--    An earlier migration reverted the guard, so reapply.
-- ------------------------------------------------------------
create or replace function public.increment_knowledge_use_count(row_id uuid, used_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.knowledge_base
    set use_count = coalesce(use_count, 0) + 1,
        last_used_at = used_at
    where id = row_id
      and user_id = auth.uid();
$$;

revoke all on function public.increment_knowledge_use_count(uuid, timestamptz) from public;
grant execute on function public.increment_knowledge_use_count(uuid, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 3. scheduled_emails.body_text (referenced by SentView edit)
-- ------------------------------------------------------------
alter table public.scheduled_emails
  add column if not exists body_text text;

-- ------------------------------------------------------------
-- 4. Cap read_receipts.opens at 200 entries to prevent unbounded row growth.
--    The tracking pixel endpoint is unauthenticated; a malicious actor
--    with a valid tracking_id could otherwise inflate a row forever.
-- ------------------------------------------------------------
create or replace function public.cap_read_receipts_opens()
returns trigger
language plpgsql
as $$
declare
  arr jsonb;
  n int;
begin
  arr := coalesce(new.opens, '[]'::jsonb);
  if jsonb_typeof(arr) <> 'array' then
    new.opens := '[]'::jsonb;
    return new;
  end if;
  n := jsonb_array_length(arr);
  if n > 200 then
    -- Keep the most recent 200 entries
    new.opens := (
      select jsonb_agg(e)
      from (
        select e
        from jsonb_array_elements(arr) with ordinality as t(e, idx)
        order by idx desc
        limit 200
      ) s
    );
  end if;
  return new;
end;
$$;

drop trigger if exists read_receipts_opens_cap on public.read_receipts;
create trigger read_receipts_opens_cap
  before insert or update of opens
  on public.read_receipts
  for each row
  execute function public.cap_read_receipts_opens();

-- ------------------------------------------------------------
-- 5. Inbox hot-path index: we list emails by user_id ordered by
--    received_at desc, usually filtering out archived and sent.
--    Existing indexes don't cover this composite; add a partial.
-- ------------------------------------------------------------
create index if not exists idx_emails_user_received_active
  on public.emails (user_id, received_at desc)
  where is_archived = false and is_snoozed = false;

-- ------------------------------------------------------------
-- 6. Enforce explicit WITH CHECK on policies that previously relied on
--    the implicit USING-as-CHECK behavior. This is more robust across
--    pg versions and makes intent clear.
-- ------------------------------------------------------------
do $$
declare
  t text;
  pol_name text;
begin
  for t, pol_name in
    select * from (values
      ('gmail_accounts',    'Users can manage own gmail accounts'),
      ('emails',            'Users can manage own emails'),
      ('email_processed',   'Users can manage own email processed'),
      ('categories',        'Users can manage own categories'),
      ('todos',             'Users can manage own todos'),
      ('scheduled_emails',  'Users can manage own scheduled emails'),
      ('read_receipts',     'Users can manage own read receipts'),
      ('meetings',          'Users can manage own meetings'),
      ('email_memory',      'Users can manage own email memory')
    ) as t(t, pol_name)
  loop
    begin
      execute format('drop policy if exists %I on public.%I', pol_name, t);
      execute format(
        'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        pol_name, t
      );
    exception when undefined_table then
      -- table missing in some envs; ignore
      null;
    end;
  end loop;
end$$;
