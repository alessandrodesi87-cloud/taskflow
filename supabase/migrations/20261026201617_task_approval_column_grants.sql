-- The dashboard may explicitly approve a pending task; approval metadata stays trigger-controlled.
grant update (approval_status) on public.tasks to authenticated;