-- TaskFlow security hardening
-- Keeps privileged helpers out of the exposed public schema, applies least
-- privilege grants, and closes the profile role-escalation path.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
grant usage on schema private to supabase_auth_admin;

-- Replace public SECURITY DEFINER helpers with private equivalents.
create or replace function private.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
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
  select (select auth.uid()) is not null
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

revoke all on function private.can_access_project(uuid) from public, anon;
revoke all on function private.can_manage_project(uuid) from public, anon;
grant execute on function private.can_access_project(uuid) to authenticated, service_role;
grant execute on function private.can_manage_project(uuid) to authenticated, service_role;

-- Recreate the auth trigger function with a fixed search_path and without a
-- public RPC surface.
drop trigger if exists on_auth_user_created on auth.users;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.users.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.handle_new_user() to service_role, supabase_auth_admin;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function private.handle_new_user();

drop function if exists public.handle_new_user();

-- Remove the old exposed helper functions after policies stop depending on
-- them.
drop policy if exists "Users can see projects they own or are members of" on public.projects;
drop policy if exists "Owners and co-owners can update projects" on public.projects;
drop policy if exists "Members see own memberships" on public.project_members;
drop policy if exists "Owners add members" on public.project_members;
drop policy if exists "Owners remove members" on public.project_members;
drop policy if exists "Users can see tasks in their projects" on public.tasks;
drop policy if exists "Users can create tasks in their projects" on public.tasks;
drop policy if exists "Users can update tasks in their projects" on public.tasks;
drop policy if exists "Users can delete tasks in their projects" on public.tasks;

create policy "Authenticated users see accessible projects"
  on public.projects for select
  to authenticated
  using (private.can_access_project(id));

create policy "Owners and co-owners update projects"
  on public.projects for update
  to authenticated
  using (private.can_manage_project(id))
  with check (private.can_manage_project(id));

create policy "Project participants see memberships"
  on public.project_members for select
  to authenticated
  using (private.can_access_project(project_id));

create policy "Owners and co-owners add members"
  on public.project_members for insert
  to authenticated
  with check (private.can_manage_project(project_id));

create policy "Managers or members themselves remove memberships"
  on public.project_members for delete
  to authenticated
  using (
    private.can_manage_project(project_id)
    or user_id = (select auth.uid())
  );

create policy "Project participants see tasks"
  on public.tasks for select
  to authenticated
  using (private.can_access_project(project_id));

create policy "Project participants create tasks"
  on public.tasks for insert
  to authenticated
  with check (
    private.can_access_project(project_id)
    and owner_id = (select auth.uid())
    and creator_id = (select auth.uid())
  );

create policy "Project participants update tasks"
  on public.tasks for update
  to authenticated
  using (private.can_access_project(project_id))
  with check (private.can_access_project(project_id));

create policy "Project participants delete tasks"
  on public.tasks for delete
  to authenticated
  using (private.can_access_project(project_id));

drop function if exists public.is_project_member(uuid, uuid);
drop function if exists public.is_project_owner_or_coowner(uuid, uuid);

-- Directory visibility is required for project sharing, but sensitive profile
-- columns are protected with column-level grants below.
drop policy if exists "Users can view themselves" on public.users;
drop policy if exists "Authenticated can view users" on public.users;
drop policy if exists "Users can insert themselves" on public.users;
drop policy if exists "Users can update themselves" on public.users;

create policy "Authenticated users see team directory"
  on public.users for select
  to authenticated
  using (true);

create policy "Users update their own profile"
  on public.users for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Attachments inherit project access through their task.
drop policy if exists "Project participants see attachments" on public.attachments;
drop policy if exists "Project participants add attachments" on public.attachments;
drop policy if exists "Project participants delete attachments" on public.attachments;

create policy "Project participants see attachments"
  on public.attachments for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and private.can_access_project(t.project_id)
    )
  );

create policy "Project participants add attachments"
  on public.attachments for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and private.can_access_project(t.project_id)
    )
  );

create policy "Project participants delete attachments"
  on public.attachments for delete
  to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and private.can_access_project(t.project_id)
    )
  );

-- Audit rows are written by trusted server-side code. Users may only read
-- their own entries.
drop policy if exists "Users see own audit entries" on public.audit_logs;
create policy "Users see own audit entries"
  on public.audit_logs for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Google credentials remain server-only until the hardened integration ships.
drop policy if exists "Gmail accounts are server only" on public.gmail_accounts;
create policy "Gmail accounts are server only"
  on public.gmail_accounts for all
  to authenticated
  using (false)
  with check (false);

-- Least-privilege Data API grants.
revoke all on all tables in schema public from anon;

revoke insert, update, delete on public.users from authenticated;
revoke select on public.users from authenticated;
grant select (id, email, full_name, created_at) on public.users to authenticated;
grant update (full_name, phone, telegram_chat_id, updated_at) on public.users to authenticated;

revoke update on public.projects from authenticated;
grant update (name, description, start_date, end_date, color, updated_at)
  on public.projects to authenticated;

revoke update on public.tasks from authenticated;
grant update (
  title,
  description,
  assignee_id,
  start_date,
  due_date,
  status,
  priority,
  tags,
  email_origin,
  updated_at
) on public.tasks to authenticated;

revoke all on public.gmail_accounts from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- Missing foreign-key index reported by the database advisor.
create index if not exists idx_gmail_accounts_default_project_id
  on public.gmail_accounts(default_project_id);
