-- Add a same-project parent relationship for task hierarchies.
alter table public.tasks
  add column parent_task_id uuid references public.tasks(id) on delete cascade;

create index tasks_parent_task_id_idx on public.tasks(parent_task_id)
  where parent_task_id is not null;

create or replace function private.validate_task_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_project_id uuid;
begin
  if new.parent_task_id is null then
    return new;
  end if;
  if new.parent_task_id = new.id then
    raise exception 'task_cannot_be_its_own_parent';
  end if;
  select t.project_id into parent_project_id from public.tasks t where t.id = new.parent_task_id;
  if parent_project_id is null or parent_project_id is distinct from new.project_id then
    raise exception 'task_parent_must_be_in_same_project';
  end if;
  if tg_op = 'UPDATE' and exists (
    with recursive descendants(id) as (
      select t.id from public.tasks t where t.parent_task_id = new.id
      union all
      select child.id from public.tasks child join descendants d on child.parent_task_id = d.id
    ) select 1 from descendants where id = new.parent_task_id
  ) then
    raise exception 'task_parent_cycle_not_allowed';
  end if;
  return new;
end;
$$;

create trigger tasks_validate_parent
  before insert or update of parent_task_id, project_id on public.tasks
  for each row execute function private.validate_task_parent();

grant select (parent_task_id), insert (parent_task_id), update (parent_task_id)
  on public.tasks to authenticated;

create or replace function public.create_task_with_subtasks(p_task jsonb, p_subtask_titles jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  parent_row public.tasks%rowtype;
  child_title text;
  child_id uuid;
  child_ids uuid[] := '{}'::uuid[];
begin
  if actor_id is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_task) is distinct from 'object'
    or jsonb_typeof(p_subtask_titles) is distinct from 'array'
    or jsonb_array_length(p_subtask_titles) > 20 then
    raise exception 'invalid_task_batch';
  end if;

  insert into public.tasks (
    project_id, title, description, owner_id, creator_id, assignee_id,
    start_date, due_date, status, priority
  ) values (
    (p_task->>'project_id')::uuid,
    pg_catalog.btrim(p_task->>'title'),
    nullif(p_task->>'description', ''),
    actor_id,
    actor_id,
    nullif(p_task->>'assignee_id', '')::uuid,
    (p_task->>'start_date')::date,
    nullif(p_task->>'due_date', '')::date,
    coalesce(nullif(p_task->>'status', ''), 'todo'),
    coalesce(nullif(p_task->>'priority', ''), 'medium')
  ) returning * into parent_row;

  for child_title in select jsonb_array_elements_text(p_subtask_titles)
  loop
    child_title := pg_catalog.btrim(child_title);
    if child_title = '' or pg_catalog.length(child_title) > 200 then
      raise exception 'invalid_subtask_title';
    end if;
    insert into public.tasks (
      project_id, parent_task_id, title, owner_id, creator_id, assignee_id,
      start_date, due_date, status, priority
    ) values (
      parent_row.project_id, parent_row.id, child_title, actor_id, actor_id,
      parent_row.assignee_id, parent_row.start_date, parent_row.due_date,
      'todo', parent_row.priority
    ) returning id into child_id;
    child_ids := pg_catalog.array_append(child_ids, child_id);
  end loop;

  return pg_catalog.jsonb_build_object('parent_id', parent_row.id, 'subtask_ids', child_ids);
end;
$$;

revoke all on function public.create_task_with_subtasks(jsonb, jsonb) from public;
grant execute on function public.create_task_with_subtasks(jsonb, jsonb) to authenticated;
