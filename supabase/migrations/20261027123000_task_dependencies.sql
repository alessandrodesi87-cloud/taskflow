-- Explicit dependency edges: task_id is blocked by depends_on_task_id.
create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_unique_pair unique (task_id, depends_on_task_id)
);

create index task_dependencies_project_task_idx on public.task_dependencies(project_id, task_id);
create index task_dependencies_predecessor_idx on public.task_dependencies(depends_on_task_id);

alter table public.task_dependencies enable row level security;

create policy "Project participants read task dependencies"
  on public.task_dependencies for select to authenticated
  using (private.can_access_project(project_id));
create policy "Project participants add task dependencies"
  on public.task_dependencies for insert to authenticated
  with check (private.can_access_project(project_id) and created_by = (select auth.uid()));
create policy "Project participants remove task dependencies"
  on public.task_dependencies for delete to authenticated
  using (private.can_access_project(project_id));

revoke all on public.task_dependencies from anon, authenticated;
grant select on public.task_dependencies to authenticated;
grant insert (project_id, task_id, depends_on_task_id, created_by) on public.task_dependencies to authenticated;
grant delete on public.task_dependencies to authenticated;

create or replace function private.validate_task_dependency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  dependent_project_id uuid;
  predecessor_project_id uuid;
begin
  select t.project_id into dependent_project_id from public.tasks t where t.id = new.task_id;
  select t.project_id into predecessor_project_id from public.tasks t where t.id = new.depends_on_task_id;
  if dependent_project_id is null or predecessor_project_id is null
     or dependent_project_id is distinct from predecessor_project_id
     or new.project_id is distinct from dependent_project_id then
    raise exception 'task_dependency_must_be_in_same_project';
  end if;

  if exists (
    with recursive predecessor_path(task_id) as (
      select new.depends_on_task_id
      union
      select edge.depends_on_task_id
      from public.task_dependencies edge
      join predecessor_path path on edge.task_id = path.task_id
      where tg_op = 'INSERT' or edge.id <> new.id
    )
    select 1 from predecessor_path where task_id = new.task_id
  ) then
    raise exception 'task_dependency_cycle_not_allowed';
  end if;
  return new;
end;
$$;

create trigger task_dependencies_validate
  before insert or update of project_id, task_id, depends_on_task_id on public.task_dependencies
  for each row execute function private.validate_task_dependency();
revoke all on function private.validate_task_dependency() from public, anon, authenticated;
