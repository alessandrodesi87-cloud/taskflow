-- Personal project filters shared by email and Telegram reminders.
-- An empty array means that every accessible project is included.
alter table public.user_notification_preferences
  add column notification_project_ids uuid[] not null default '{}'::uuid[];

alter table public.user_notification_preferences
  add constraint user_notification_preferences_project_filter_check
  check (
    cardinality(notification_project_ids) <= 50
    and array_position(notification_project_ids, null) is null
  );

comment on column public.user_notification_preferences.notification_project_ids is
  'Project IDs included in personal reminders. Empty means all accessible projects.';
