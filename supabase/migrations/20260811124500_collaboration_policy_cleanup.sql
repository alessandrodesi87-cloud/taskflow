-- Follow-up for environments where the hardened project insert policy uses
-- the newer name. Keep a single permissive policy and include suspension.
drop policy if exists "Authenticated users create projects" on public.projects;

drop policy if exists "Owners delete projects" on public.projects;
create policy "Active owners delete projects"
  on public.projects for delete
  to authenticated
  using (
    private.is_current_user_active()
    and owner_id = (select auth.uid())
  );
