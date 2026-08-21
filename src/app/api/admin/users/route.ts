import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/serverAuth'
import { ensurePersonalInbox } from '@/lib/personalInbox'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data, error }, authUsersResult] = await Promise.all([
    context.admin
    .from('users')
      .select('id, email, full_name, role, phone, telegram_chat_id, is_active, suspended_at')
      .order('created_at', { ascending: true }),
    context.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  if (error || authUsersResult.error) {
    return NextResponse.json({ error: 'Unable to load users' }, { status: 500 })
  }

  const lastSignInByUser = new Map(
    authUsersResult.data.users.map((user) => [user.id, user.last_sign_in_at || null])
  )
  return NextResponse.json({
    users: (data || []).map((user) => ({
      ...user,
      last_sign_in_at: lastSignInByUser.get(user.id) || null,
    })),
  })
}

export async function POST(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || password.length < 10) {
    return NextResponse.json(
      { error: 'Inserisci una email valida e una password di almeno 10 caratteri.' },
      { status: 400 }
    )
  }

  const { data, error } = await context.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ userId: data.user.id }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    userId?: string
    action?: 'suspend' | 'reactivate'
    replacementUserId?: string
  } | null
  const userId = body?.userId
  const action = body?.action

  if (!userId || (action !== 'suspend' && action !== 'reactivate')) {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }
  if (userId === context.user.id && action === 'suspend') {
    return NextResponse.json({ error: 'Non puoi sospendere il tuo account amministratore.' }, { status: 400 })
  }

  const { data: target, error: targetError } = await context.admin
    .from('users')
    .select('id, email, is_active')
    .eq('id', userId)
    .maybeSingle()
  if (targetError || !target) {
    return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 })
  }

  if (action === 'reactivate') {
    const { error: authError } = await context.admin.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const { error: profileError } = await context.admin
      .from('users')
      .update({ is_active: true, suspended_at: null, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (profileError) {
      return NextResponse.json({ error: 'Riattivazione del profilo non riuscita' }, { status: 500 })
    }

    await context.admin.from('audit_logs').insert({
      user_id: context.user.id,
      action: 'user_reactivated',
      entity_type: 'user',
      entity_id: userId,
      changes: { email: target.email },
    })
    return NextResponse.json({ success: true })
  }

  const { data: ownedProjects, error: projectsError } = await context.admin
    .from('projects')
    .select('id, is_personal')
    .eq('owner_id', userId)
  if (projectsError) {
    return NextResponse.json({ error: 'Impossibile controllare i progetti dell’utente' }, { status: 500 })
  }

  const regularProjects = (ownedProjects || []).filter((project) => !project.is_personal)
  const personalProject = (ownedProjects || []).find((project) => project.is_personal)
  let personalTaskCount = 0
  if (personalProject) {
    const { count, error: personalTasksError } = await context.admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', personalProject.id)
    if (personalTasksError) {
      return NextResponse.json({ error: 'Impossibile controllare l’Inbox personale.' }, { status: 500 })
    }
    personalTaskCount = count || 0
  }

  const replacementUserId = body?.replacementUserId || ''
  if ((regularProjects.length > 0 || personalTaskCount > 0) && !replacementUserId) {
    return NextResponse.json({
      error: 'Scegli chi erediterà progetti e task prima di sospendere l’utente.',
      requires_replacement: true,
      owned_projects: regularProjects.length,
    }, { status: 409 })
  }

  if (replacementUserId) {
    const { data: replacement, error: replacementError } = await context.admin
      .from('users')
      .select('id, is_active')
      .eq('id', replacementUserId)
      .maybeSingle()
    if (replacementError || !replacement?.is_active || replacement.id === userId) {
      return NextResponse.json({ error: 'Il sostituto selezionato non è valido.' }, { status: 400 })
    }
  }

  const { error: banError } = await context.admin.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
  })
  if (banError) return NextResponse.json({ error: banError.message }, { status: 400 })

  try {
    if (replacementUserId) {
      const replacementInbox = await ensurePersonalInbox(context.admin, replacementUserId)
      const updates = await Promise.all([
        context.admin.from('projects').update({ owner_id: replacementUserId, updated_at: new Date().toISOString() }).eq('owner_id', userId).eq('is_personal', false),
        personalProject
          ? context.admin.from('tasks').update({ project_id: replacementInbox.id, owner_id: replacementUserId, assignee_id: replacementUserId, updated_at: new Date().toISOString() }).eq('project_id', personalProject.id)
          : Promise.resolve({ error: null }),
        context.admin.from('tasks').update({ owner_id: replacementUserId, updated_at: new Date().toISOString() }).eq('owner_id', userId),
        context.admin.from('tasks').update({ assignee_id: replacementUserId, updated_at: new Date().toISOString() }).eq('assignee_id', userId),
      ])
      const failedUpdate = updates.find((result) => result.error)
      if (failedUpdate?.error) throw failedUpdate.error
    }

    const { error: profileError } = await context.admin
      .from('users')
      .update({ is_active: false, suspended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (profileError) throw profileError

    await context.admin.from('audit_logs').insert({
      user_id: context.user.id,
      action: 'user_suspended',
      entity_type: 'user',
      entity_id: userId,
      changes: {
        email: target.email,
        replacement_user_id: replacementUserId || null,
        transferred_projects: regularProjects.length,
        transferred_personal_tasks: personalTaskCount,
      },
    })
  } catch (error) {
    await context.admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Sospensione non riuscita',
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    transferred_projects: regularProjects.length,
  })
}
