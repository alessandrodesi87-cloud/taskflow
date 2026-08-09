-- Minute-level Telegram dispatcher. The secret is read from Vault at call time.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.dispatch_taskflow_telegram_notifications()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into dispatch_secret
  from vault.decrypted_secrets
  where name = 'taskflow_telegram_dispatch_secret';

  if dispatch_secret is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://taskflow-zeta-plum.vercel.app/api/notifications/send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    body := jsonb_build_object('source', 'supabase_cron'),
    timeout_milliseconds := 30000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function private.dispatch_taskflow_telegram_notifications()
  from public, anon, authenticated, service_role;

select cron.unschedule('taskflow-telegram-notifications')
where exists (
  select 1 from cron.job where jobname = 'taskflow-telegram-notifications'
);

select cron.schedule(
  'taskflow-telegram-notifications',
  '* * * * *',
  'select private.dispatch_taskflow_telegram_notifications();'
);

drop function public.store_taskflow_telegram_dispatch_secret(text);

