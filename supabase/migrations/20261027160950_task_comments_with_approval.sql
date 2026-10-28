-- Task comments support assistant drafts that are hidden until the task owner approves them.
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by_assistant boolean not null default false,
  approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved')),
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_comments_pending_assistant_only
    check (approval_status <> 'pending' or created_by_assistant)
);

create index task_comments_task_created_idx
  on public.task_comments(task_id, created_at, id);

alter table public.task_comments enable row level security;

create policy "Project participants read visible task comments"
  on public.task_comments for select to authenticated
  using (
    private.can_access_project(project_id)
    and exists (
      select 1
      from public.tasks t
      where t.id = task_comments.task_id
        and t.project_id = task_comments.project_id
        and (
          t.owner_id = (select auth.uid())
          or (t.approval_status = 'approved' and task_comments.approval_status = 'approved')
        )
    )
  );

create policy "Project participants add published task comments"
  on public.task_comments for insert to authenticated
  with check (
    private.can_access_project(project_id)
    and author_id = (select auth.uid())
    and created_by_assistant = false
    and approval_status = 'approved'
    and exists (
      select 1
      from public.tasks t
      where t.id = task_comments.task_id
        and t.project_id = task_comments.project_id
        and (t.approval_status = 'approved' or t.owner_id = (select auth.uid()))
    )
  );

create policy "Task owners approve assistant comments"
  on public.task_comments for update to authenticated
  using (
    private.can_access_project(project_id)
    and created_by_assistant
    and approval_status = 'pending'
    and exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and t.project_id = task_comments.project_id
        and t.owner_id = (select auth.uid())
    )
  )
  with check (
    private.can_access_project(project_id)
    and created_by_assistant
    and approval_status = 'approved'
    and approved_by = (select auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and t.project_id = task_comments.project_id
        and t.owner_id = (select auth.uid())
    )
  );

create or replace function private.guard_task_comment_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  task_owner_id uuid;
  actor_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    select t.owner_id into task_owner_id
    from public.tasks t
    where t.id = new.task_id and t.project_id = new.project_id;
    if task_owner_id is null then
      raise exception 'task_comment_project_mismatch';
    end if;
    if new.created_by_assistant then
      if new.approval_status <> 'pending'
         or new.author_id is distinct from task_owner_id
         or new.approved_at is not null
         or new.approved_by is not null then
        raise exception 'invalid_assistant_comment_state';
      end if;
    elsif new.approval_status <> 'approved'
       or new.approved_at is not null
       or new.approved_by is not null then
      raise exception 'invalid_user_comment_state';
    end if;
    return new;
  end if;

  if old.created_by_assistant is distinct from true
     or old.approval_status is distinct from 'pending'
     or new.approval_status is distinct from 'approved'
     or new.id is distinct from old.id
     or new.task_id is distinct from old.task_id
     or new.project_id is distinct from old.project_id
     or new.author_id is distinct from old.author_id
     or new.body is distinct from old.body
     or new.created_by_assistant is distinct from old.created_by_assistant
     or new.created_at is distinct from old.created_at then
    raise exception 'task_comment_is_immutable_except_approval';
  end if;

  select t.owner_id into task_owner_id
  from public.tasks t
  where t.id = old.task_id and t.project_id = old.project_id;
  if task_owner_id is null or actor_id is distinct from task_owner_id then
    raise exception 'only_task_owner_can_approve_comment';
  end if;

  new.approved_at := now();
  new.approved_by := actor_id;
  return new;
end;
$$;

create trigger task_comments_approval_guard
  before insert or update on public.task_comments
  for each row execute function private.guard_task_comment_approval();

revoke all on function private.guard_task_comment_approval() from public, anon, authenticated;
revoke all on public.task_comments from anon, authenticated;
grant select on public.task_comments to authenticated;
grant insert (task_id, project_id, author_id, body) on public.task_comments to authenticated;
grant update (approval_status) on public.task_comments to authenticated;
grant select, insert, update on public.task_comments to service_role;