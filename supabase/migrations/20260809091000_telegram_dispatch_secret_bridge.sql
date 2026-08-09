-- Short-lived service-only bridge used once to store the derived dispatcher secret in Vault.

create or replace function public.store_taskflow_telegram_dispatch_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
begin
  if p_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid dispatcher secret';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'taskflow_telegram_dispatch_secret';

  if existing_secret_id is null then
    perform vault.create_secret(
      p_secret,
      'taskflow_telegram_dispatch_secret',
      'Derived secret for the TaskFlow Telegram scheduler'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      p_secret,
      'taskflow_telegram_dispatch_secret',
      'Derived secret for the TaskFlow Telegram scheduler'
    );
  end if;
end;
$$;

revoke all on function public.store_taskflow_telegram_dispatch_secret(text)
  from public, anon, authenticated;
grant execute on function public.store_taskflow_telegram_dispatch_secret(text)
  to service_role;

