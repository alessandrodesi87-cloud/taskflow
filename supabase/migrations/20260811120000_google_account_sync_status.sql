-- Persist a safe, user-visible health summary for every Google Tasks account.
alter table public.gmail_accounts
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists last_sync_error text;

alter table public.gmail_accounts
  drop constraint if exists gmail_accounts_last_sync_status_check;

alter table public.gmail_accounts
  add constraint gmail_accounts_last_sync_status_check
  check (last_sync_status is null or last_sync_status in ('success', 'error'));

comment on column public.gmail_accounts.last_sync_error is
  'Short sanitized status message. OAuth credentials remain server-only.';
