-- Assistant-created tasks remain outside the normal pipeline until the owner acts.
alter table public.tasks
  add column approval_status text not null default 'approved',
  add column approved_at timestamptz,
  add column approved_by uuid references public.users(id) on delete set null,
  add constraint tasks_approval_status_check check (approval_status in ('pending', 'approved'));

-- Pending proposals are visible only to their owner; approved tasks remain visible to project participants.
drop policy if exists "Project participants see tasks" on public.tasks;
create policy "Project participants see approved or owned pending tasks"
  on public.tasks for select
  to authenticated
  using (
    private.can_access_project(project_id)
    and (approval_status = 'approved' or owner_id = (select auth.uid()))
  );

create or replace function private.approve_pending_task_on_owner_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if old.approval_status = 'pending' then
      if new.approval_status = 'approved' then
        if actor_id is distinct from old.owner_id then
          raise exception 'only_task_owner_can_approve';
        end if;
        new.approved_at := now();
        new.approved_by := actor_id;
      elsif new.approval_status <> 'pending' then
        raise exception 'invalid_task_approval_status';
      elsif actor_id = old.owner_id and (
        new.project_id is distinct from old.project_id
        or new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.owner_id is distinct from old.owner_id
        or new.creator_id is distinct from old.creator_id
        or new.assignee_id is distinct from old.assignee_id
        or new.start_date is distinct from old.start_date
        or new.due_date is distinct from old.due_date
        or new.status is distinct from old.status
        or new.priority is distinct from old.priority
        or new.tags is distinct from old.tags
        or new.google_task_id is distinct from old.google_task_id
        or new.email_origin is distinct from old.email_origin
      ) then
        new.approval_status := 'approved';
        new.approved_at := now();
        new.approved_by := actor_id;
      else
        new.approved_at := null;
        new.approved_by := null;
      end if;
    else
      if new.approval_status = 'pending' then
        raise exception 'approved_task_cannot_return_to_pending';
      end if;
      new.approved_at := old.approved_at;
      new.approved_by := old.approved_by;
    end if;
  elsif new.approval_status = 'pending' then
    new.approved_at := null;
    new.approved_by := null;
  else
    new.approved_at := null;
    new.approved_by := null;
  end if;

  return new;
end;
$$;

create trigger tasks_approval_owner_mutation
  before insert or update on public.tasks
  for each row execute function private.approve_pending_task_on_owner_mutation();