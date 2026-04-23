
alter table public.profiles
  add column if not exists notification_level text not null default 'important'
    check (notification_level in ('all', 'important', 'none')),
  add column if not exists notification_preview boolean not null default true;
;
