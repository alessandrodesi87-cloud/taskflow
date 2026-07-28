-- Fix RLS: mancavano policy per INSERT su users e UPDATE/DELETE su tasks

-- Users: permetti a un utente di creare/aggiornare il proprio profilo
CREATE POLICY "Users can insert themselves" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update themselves" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Tasks: permetti update e delete a chi partecipa al progetto
CREATE POLICY "Users can update tasks in their projects" ON public.tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND (
        p.owner_id = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete tasks in their projects" ON public.tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND (
        p.owner_id = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = auth.uid())
      )
    )
  );

-- Projects: owner può cancellare
CREATE POLICY "Owners can delete projects" ON public.projects
  FOR DELETE USING (owner_id = auth.uid());
