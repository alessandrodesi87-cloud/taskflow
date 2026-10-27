-- Keep assistant origin visible after a pending task is approved.
alter table public.tasks
  add column created_by_assistant boolean not null default false;

update public.tasks
set created_by_assistant = true
where approval_status = 'pending';

alter table public.tasks
  add constraint tasks_pending_must_be_assistant_created
  check (approval_status <> 'pending' or created_by_assistant);

create or replace function private.protect_task_assistant_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.approval_status = 'pending' then
      if new.owner_id is distinct from (select auth.uid()) then
        raise exception 'only_task_owner_can_create_pending_task';
      end if;
      new.created_by_assistant := true;
    else
      new.created_by_assistant := false;
    end if;
  else
    new.created_by_assistant := old.created_by_assistant;
    if new.approval_status = 'pending' then
      new.created_by_assistant := true;
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_assistant_provenance_guard
  before insert or update on public.tasks
  for each row execute function private.protect_task_assistant_provenance();

revoke all on function private.protect_task_assistant_provenance() from public, anon, authenticated;