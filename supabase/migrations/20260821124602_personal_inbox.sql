-- Personal inbox: a private, non-shareable system project for unclassified tasks.
alter table public.projects
  add column if not exists is_personal boolean not null default false;

comment on column public.projects.is_personal is
  'True only for the owner personal inbox used by remote task creation fallbacks.';

create unique index if not exists projects_one_personal_inbox_per_owner_idx
  on public.projects(owner_id)
  where is_personal;

create or replace function private.ensure_personal_inbox(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inbox_id uuid;
begin
  if p_user_id is null then
    raise exception 'A user is required to create a personal inbox';
  end if;

  insert into public.projects (
    name,
    description,
    owner_id,
    start_date,
    end_date,
    color,
    is_personal
  )
  values (
    'Inbox personale',
    'Task ancora da classificare in un progetto.',
    p_user_id,
    current_date,
    current_date,
    '#64748b',
    true
  )
  on conflict (owner_id) where is_personal
  do update set owner_id = excluded.owner_id
  returning id into inbox_id;

  return inbox_id;
end;
$$;

revoke all on function private.ensure_personal_inbox(uuid)
  from public, anon, authenticated;
grant execute on function private.ensure_personal_inbox(uuid)
  to service_role, supabase_auth_admin;

-- Backfill an inbox for every existing profile without touching existing tasks.
select private.ensure_personal_inbox(u.id)
from public.users u;

-- Existing remote connections with no destination start using the inbox.
update public.gmail_accounts ga
set default_project_id = p.id
from public.projects p
where ga.default_project_id is null
  and p.owner_id = ga.user_id
  and p.is_personal;

update public.user_notification_preferences pref
set telegram_default_project_id = p.id,
    updated_at = now()
from public.projects p
where pref.telegram_default_project_id is null
  and p.owner_id = pref.user_id
  and p.is_personal;

-- Keep profile creation and inbox creation in the same transaction.
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

  perform private.ensure_personal_inbox(new.id);
  return new;
end;
$$;

revoke all on function private.handle_new_user()
  from public, anon, authenticated;
grant execute on function private.handle_new_user()
  to service_role, supabase_auth_admin;

-- Authenticated clients may create normal projects, never system inboxes.
revoke insert on public.projects from authenticated;
grant insert (name, description, owner_id, start_date, end_date, color)
  on public.projects to authenticated;

drop policy if exists "Active users create projects" on public.projects;
create policy "Active users create projects"
  on public.projects for insert
  to authenticated
  with check (
    private.is_current_user_active()
    and owner_id = (select auth.uid())
    and is_personal = false
  );

drop policy if exists "Active owners delete projects" on public.projects;
create policy "Active owners delete projects"
  on public.projects for delete
  to authenticated
  using (
    private.is_current_user_active()
    and owner_id = (select auth.uid())
    and is_personal = false
  );

drop policy if exists "Owners and co-owners add members" on public.project_members;
create policy "Owners and co-owners add members"
  on public.project_members for insert
  to authenticated
  with check (
    private.can_manage_project(project_id)
    and not exists (
      select 1
      from public.projects p
      where p.id = project_members.project_id
        and p.is_personal
    )
  );

-- Defense in depth for trusted server code and future admin flows.
create or replace function private.protect_personal_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.is_personal then
    raise exception 'The personal inbox cannot be deleted';
  end if;

  if tg_op = 'UPDATE'
    and old.is_personal
    and (
      new.owner_id is distinct from old.owner_id
      or new.is_personal is distinct from old.is_personal
    )
  then
    raise exception 'The personal inbox cannot be transferred or converted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.protect_personal_project()
  from public, anon, authenticated;

drop trigger if exists protect_personal_project on public.projects;
create trigger protect_personal_project
  before update or delete on public.projects
  for each row execute function private.protect_personal_project();

create or replace function private.prevent_personal_project_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.is_personal
  ) then
    raise exception 'The personal inbox cannot be shared';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_personal_project_membership()
  from public, anon, authenticated;

drop trigger if exists prevent_personal_project_membership on public.project_members;
create trigger prevent_personal_project_membership
  before insert or update on public.project_members
  for each row execute function private.prevent_personal_project_membership();
