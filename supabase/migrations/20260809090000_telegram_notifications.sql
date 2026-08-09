-- TaskFlow Telegram notifications, secure account linking and webhook idempotency.

alter table public.notification_defaults
  add column telegram_enabled boolean not null default true,
  add column telegram_time time without time zone not null default time '08:15';

alter table public.notification_defaults
  add constraint notification_defaults_telegram_time_check
  check (telegram_time between time '07:00' and time '22:00');

alter table public.user_notification_preferences
  add column telegram_enabled_override boolean,
  add column telegram_time_override time without time zone,
  add column telegram_default_project_id uuid references public.projects(id) on delete set null;

alter table public.user_notification_preferences
  add constraint user_notification_preferences_telegram_time_check
  check (
    telegram_time_override is null
    or telegram_time_override between time '07:00' and time '22:00'
  );

update public.users
set telegram_chat_id = null
where telegram_chat_id is not null
  and btrim(telegram_chat_id) = '';

create unique index users_telegram_chat_id_unique
  on public.users(telegram_chat_id)
  where telegram_chat_id is not null;

create index user_notification_preferences_telegram_project_idx
  on public.user_notification_preferences(telegram_default_project_id)
  where telegram_default_project_id is not null;

create table public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_link_tokens_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create index telegram_link_tokens_expiry_idx
  on public.telegram_link_tokens(expires_at)
  where used_at is null;

create table public.telegram_update_events (
  update_id bigint primary key,
  chat_id text,
  event_type text not null
    check (event_type in ('message', 'callback_query', 'other')),
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index telegram_update_events_status_updated_idx
  on public.telegram_update_events(status, updated_at)
  where status in ('processing', 'failed');

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_notification_kind_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_notification_kind_check
  check (notification_kind in ('daily_digest', 'test', 'telegram_daily', 'telegram_test'));

create unique index notification_deliveries_telegram_daily_once
  on public.notification_deliveries(user_id, delivery_date, notification_kind)
  where notification_kind = 'telegram_daily';

create trigger telegram_link_tokens_touch_updated_at
  before update on public.telegram_link_tokens
  for each row execute function private.touch_updated_at();

create trigger telegram_update_events_touch_updated_at
  before update on public.telegram_update_events
  for each row execute function private.touch_updated_at();

alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_update_events enable row level security;

revoke all on public.telegram_link_tokens from anon, authenticated;
revoke all on public.telegram_update_events from anon, authenticated;
grant all on public.telegram_link_tokens to service_role;
grant all on public.telegram_update_events to service_role;

create or replace function public.consume_telegram_link_token(
  p_token_hash text,
  p_chat_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_user_id uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or btrim(p_chat_id) = '' then
    return null;
  end if;

  select user_id
  into linked_user_id
  from public.telegram_link_tokens
  where token_hash = p_token_hash
    and used_at is null
    and expires_at > now()
  for update;

  if linked_user_id is null then
    return null;
  end if;

  update public.users
  set telegram_chat_id = p_chat_id,
      updated_at = now()
  where id = linked_user_id;

  update public.telegram_link_tokens
  set used_at = now()
  where token_hash = p_token_hash;

  return linked_user_id;
end;
$$;

revoke all on function public.consume_telegram_link_token(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_telegram_link_token(text, text)
  to service_role;

