-- Add description column to categories table (tags)
alter table public.categories add column if not exists description text default '';
