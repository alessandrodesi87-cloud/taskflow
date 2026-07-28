-- Funzioni helper (SECURITY DEFINER = evitano ricorsione nelle policy RLS)
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_project_id AND user_id = p_user_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_project_owner_or_coowner(p_project_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND owner_id = p_user_id)
      OR EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_project_id AND user_id = p_user_id AND role = 'co-owner');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Ricrea la policy dei progetti usando la funzione (niente ricorsione)
DROP POLICY IF EXISTS "Users can see projects they own or are members of" ON public.projects;
CREATE POLICY "Users can see projects they own or are members of" ON public.projects
  FOR SELECT USING (owner_id = auth.uid() OR public.is_project_member(id, auth.uid()));

-- Co-owner può modificare il progetto
DROP POLICY IF EXISTS "Owners can update projects" ON public.projects;
CREATE POLICY "Owners and co-owners can update projects" ON public.projects
  FOR UPDATE USING (owner_id = auth.uid() OR public.is_project_owner_or_coowner(id, auth.uid()));

-- Policy per project_members
DROP POLICY IF EXISTS "Members see own memberships" ON public.project_members;
CREATE POLICY "Members see own memberships" ON public.project_members
  FOR SELECT USING (user_id = auth.uid() OR public.is_project_owner_or_coowner(project_id, auth.uid()));

DROP POLICY IF EXISTS "Owners add members" ON public.project_members;
CREATE POLICY "Owners add members" ON public.project_members
  FOR INSERT WITH CHECK (public.is_project_owner_or_coowner(project_id, auth.uid()));

DROP POLICY IF EXISTS "Owners remove members" ON public.project_members;
CREATE POLICY "Owners remove members" ON public.project_members
  FOR DELETE USING (public.is_project_owner_or_coowner(project_id, auth.uid()) OR user_id = auth.uid());

-- Gli utenti autenticati possono vedersi tra loro (serve per invitare via email)
DROP POLICY IF EXISTS "Authenticated can view users" ON public.users;
CREATE POLICY "Authenticated can view users" ON public.users
  FOR SELECT USING (auth.role() = 'authenticated');
