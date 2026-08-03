-- Replace the two legacy project policies that still targeted PUBLIC.
-- The predicates are unchanged, but the policies now run only for signed-in
-- users and cache auth.uid() once per statement.
drop policy if exists "Users can create projects" on public.projects;
drop policy if exists "Owners can delete projects" on public.projects;
drop policy if exists "Authenticated users create projects" on public.projects;
drop policy if exists "Owners delete projects" on public.projects;

create policy "Authenticated users create projects"
  on public.projects for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Owners delete projects"
  on public.projects for delete
  to authenticated
  using (owner_id = (select auth.uid()));
