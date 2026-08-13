-- Collaboration controls: assignment integrity, urgent priority and safe offboarding.
alter table public.users
  add column if not exists is_active boolean not null default true,
  add column if not exists suspended_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));

create or replace function private.is_project_participant(
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and (
      exists (
        select 1
        from public.projects p
        where p.id = p_project_id
          and p.owner_id = p_user_id
      )
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = p_user_id
      )
    );
$$;

revoke all on function private.is_project_participant(uuid, uuid)
  from public, anon;
grant execute on function private.is_project_participant(uuid, uuid)
  to authenticated, service_role;

drop policy if exists "Project participants create tasks" on public.tasks;
create policy "Project participants create tasks"
  on public.tasks for insert
  to authenticated
  with check (
    private.can_access_project(project_id)
    and owner_id = (select auth.uid())
    and creator_id = (select auth.uid())
    and (
      assignee_id is null
      or private.is_project_participant(project_id, assignee_id)
    )
  );

drop policy if exists "Project participants update tasks" on public.tasks;
create policy "Project participants update tasks"
  on public.tasks for update
  to authenticated
  using (private.can_access_project(project_id))
  with check (
    private.can_access_project(project_id)
    and (
      assignee_id is null
      or private.is_project_participant(project_id, assignee_id)
    )
  );

grant update (project_id) on public.tasks to authenticated;

comment on column public.users.is_active is
  'Application-level status mirrored by the admin offboarding flow.';

create or replace function private.is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and u.is_active = true
  );
$$;

revoke all on function private.is_current_user_active() from public, anon;
grant execute on function private.is_current_user_active()
  to authenticated, service_role;

create or replace function private.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_current_user_active()
    and (
      exists (
        select 1
        from public.projects p
        where p.id = p_project_id
          and p.owner_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = (select auth.uid())
      )
    );
$$;

create or replace function private.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_current_user_active()
    and (
      exists (
        select 1
        from public.projects p
        where p.id = p_project_id
          and p.owner_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = (select auth.uid())
          and pm.role = 'co-owner'
      )
    );
$$;

drop policy if exists "Users can create projects" on public.projects;
drop policy if exists "Authenticated users create projects" on public.projects;
create policy "Active users create projects"
  on public.projects for insert
  to authenticated
  with check (
    private.is_current_user_active()
    and owner_id = (select auth.uid())
  );

drop policy if exists "Owners delete projects" on public.projects;
create policy "Active owners delete projects"
  on public.projects for delete
  to authenticated
  using (
    private.is_current_user_active()
    and owner_id = (select auth.uid())
  );

drop policy if exists "Authenticated users see team directory" on public.users;
create policy "Active users see team directory"
  on public.users for select
  to authenticated
  using (private.is_current_user_active());

drop policy if exists "Users update their own profile" on public.users;
create policy "Active users update their own profile"
  on public.users for update
  to authenticated
  using (
    private.is_current_user_active()
    and id = (select auth.uid())
  )
  with check (
    private.is_current_user_active()
    and id = (select auth.uid())
  );
