import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'

export const dynamic = 'force-dynamic'

// Return only names and identities after checking access to this specific task.
export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request)
    if (!context) return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
    const taskId = request.nextUrl.searchParams.get('taskId')
    if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) return NextResponse.json({ error: 'Task non valido' }, { status: 400 })
    const { admin, user } = context
    const { data: task, error: taskError } = await admin.from('tasks').select('project_id, owner_id, approval_status').eq('id', taskId).maybeSingle()
    if (taskError) throw taskError
    if (!task || (task.approval_status === 'pending' && task.owner_id !== user.id)) return NextResponse.json({ error: 'Task non disponibile' }, { status: 404 })
    const { data: project, error: projectError } = await admin.from('projects').select('owner_id, is_personal').eq('id', task.project_id).single()
    if (projectError) throw projectError
    const { data: members, error: membersError } = await admin.from('project_members').select('user_id').eq('project_id', task.project_id)
    if (membersError) throw membersError
    if (project.owner_id !== user.id && (project.is_personal || !members?.some((member) => member.user_id === user.id))) {
      return NextResponse.json({ error: 'Task non disponibile' }, { status: 404 })
    }
    if (project.is_personal) return NextResponse.json({ members: [] })
    const ids = Array.from(new Set([project.owner_id, ...(members || []).map((member) => member.user_id)])).filter((id) => id !== user.id)
    if (!ids.length) return NextResponse.json({ members: [] })
    const { data, error } = await admin.from('users').select('id, full_name').in('id', ids).eq('is_active', true).order('full_name')
    if (error) throw error
    return NextResponse.json({ members: (data || []).filter((person) => person.full_name?.trim()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Menzioni non disponibili' }, { status: 500 })
  }
}

