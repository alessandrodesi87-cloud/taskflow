-- TaskFlow email notifications
-- Admin defaults, per-user overrides, delivery idempotency and inbound audit.

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

create table public.notification_defaults (
  id smallint primary key default 1 check (id = 1),
  email_enabled boolean not null default true,
  email_time time without time zone not null default time '08:00',
  timezone text not null default 'Europe/Rome',
  include_overdue boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint notification_defaults_email_time_check
    check (email_time between time '07:00' and time '22:00')
);

insert into public.notification_defaults (id)
values (1)
on conflict (id) do nothing;

create table public.user_notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  email_enabled_override boolean,
  email_time_override time without time zone,
  include_overdue_override boolean,
  updated_at timestamptz not null default now(),
  constraint user_notification_preferences_email_time_check
    check (
      email_time_override is null
      or email_time_override between time '07:00' and time '22:00'
    )
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  notification_kind text not null default 'daily_digest'
    check (notification_kind in ('daily_digest', 'test')),
  delivery_date date not null,
  scheduled_for timestamptz,
  sent_at timestamptz,
  status text not null default 'preparing'
    check (status in ('preparing', 'scheduled', 'sent', 'skipped', 'failed', 'cancelled')),
  provider_message_id text,
  task_count integer not null default 0 check (task_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notification_deliveries_daily_once
  on public.notification_deliveries(user_id, delivery_date, notification_kind)
  where notification_kind = 'daily_digest';

create index notification_deliveries_user_created_idx
  on public.notification_deliveries(user_id, created_at desc);

create index notification_deliveries_status_scheduled_idx
  on public.notification_deliveries(status, scheduled_for)
  where status in ('preparing', 'scheduled');

create table public.inbound_email_events (
  id text primary key,
  email_id text not null unique,
  sender_email text,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index tasks_active_assignee_due_idx
  on public.tasks(assignee_id, due_date)
  where status <> 'done';

create index tasks_active_unassigned_owner_due_idx
  on public.tasks(owner_id, due_date)
  where status <> 'done' and assignee_id is null;

create trigger notification_defaults_touch_updated_at
  before update on public.notification_defaults
  for each row execute function private.touch_updated_at();

create trigger user_notification_preferences_touch_updated_at
  before update on public.user_notification_preferences
  for each row execute function private.touch_updated_at();

create trigger notification_deliveries_touch_updated_at
  before update on public.notification_deliveries
  for each row execute function private.touch_updated_at();

alter table public.notification_defaults enable row level security;
alter table public.user_notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.inbound_email_events enable row level security;

create policy "Authenticated users read notification defaults"
  on public.notification_defaults for select
  to authenticated
  using (true);

create policy "Admins update notification defaults"
  on public.notification_defaults for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "Users read own notification preferences"
  on public.user_notification_preferences for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users create own notification preferences"
  on public.user_notification_preferences for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users update own notification preferences"
  on public.user_notification_preferences for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users delete own notification preferences"
  on public.user_notification_preferences for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read own email deliveries"
  on public.notification_deliveries for select
  to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

create policy "Admins read inbound email events"
  on public.inbound_email_events for select
  to authenticated
  using (private.is_admin());

revoke all on public.notification_defaults from anon, authenticated;
revoke all on public.user_notification_preferences from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;
revoke all on public.inbound_email_events from anon, authenticated;

grant select, update on public.notification_defaults to authenticated;
grant select, insert, update, delete on public.user_notification_preferences to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.inbound_email_events to authenticated;

grant all on public.notification_defaults to service_role;
grant all on public.user_notification_preferences to service_role;
grant all on public.notification_deliveries to service_role;
grant all on public.inbound_email_events to service_role;

