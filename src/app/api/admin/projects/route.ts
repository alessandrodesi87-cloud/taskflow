import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/serverAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [projectsResult, usersResult, tasksResult] = await Promise.all([
    context.admin
      .from('projects')
      .select('id, name, owner_id, start_date, end_date, created_at')
      .order('name', { ascending: true }),
    context.admin
      .from('users')
      .select('id, email, full_name, is_active'),
    context.admin
      .from('tasks')
      .select('id, project_id, status'),
  ])

  if (projectsResult.error || usersResult.error || tasksResult.error) {
    return NextResponse.json({ error: 'Impossibile caricare i progetti' }, { status: 500 })
  }

  const users = usersResult.data || []
  const tasks = tasksResult.data || []
  return NextResponse.json({
    projects: (projectsResult.data || []).map((project) => {
      const owner = users.find((user) => user.id === project.owner_id)
      const projectTasks = tasks.filter((task) => task.project_id === project.id)
      return {
        ...project,
        owner,
        task_count: projectTasks.length,
        open_task_count: projectTasks.filter((task) => task.status !== 'done').length,
      }
    }),
  })
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    projectId?: string
    ownerId?: string
  } | null
  if (!body?.projectId || !body.ownerId) {
    return NextResponse.json({ error: 'Progetto o nuovo owner non valido' }, { status: 400 })
  }

  const { data: replacement, error: replacementError } = await context.admin
    .from('users')
    .select('id, is_active')
    .eq('id', body.ownerId)
    .maybeSingle()
  if (replacementError || !replacement?.is_active) {
    return NextResponse.json({ error: 'Il nuovo owner deve essere un utente attivo.' }, { status: 400 })
  }

  const { data: currentProject, error: readError } = await context.admin
    .from('projects')
    .select('id, owner_id')
    .eq('id', body.projectId)
    .maybeSingle()
  if (readError || !currentProject) {
    return NextResponse.json({ error: 'Progetto non trovato' }, { status: 404 })
  }

  const { error: updateError } = await context.admin
    .from('projects')
    .update({ owner_id: body.ownerId, updated_at: new Date().toISOString() })
    .eq('id', body.projectId)
  if (updateError) {
    return NextResponse.json({ error: 'Trasferimento non riuscito' }, { status: 500 })
  }

  await context.admin.from('audit_logs').insert({
    user_id: context.user.id,
    action: 'project_owner_transferred',
    entity_type: 'project',
    entity_id: body.projectId,
    changes: {
      previous_owner_id: currentProject.owner_id,
      new_owner_id: body.ownerId,
    },
  })

  return NextResponse.json({ success: true })
}
