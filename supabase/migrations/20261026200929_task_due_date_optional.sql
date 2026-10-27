-- A task may be intentionally unscheduled and have no due date.
alter table public.tasks
  alter column due_date drop not null;