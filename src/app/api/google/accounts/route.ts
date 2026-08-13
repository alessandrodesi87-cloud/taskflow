import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import { revokeGoogleToken, userCanUseProject } from '@/lib/googleTasks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authenticated = await requireUser(request)
  if (!authenticated) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  const { data, error } = await authenticated.admin
    .from('gmail_accounts')
    .select('id, email, default_project_id, connected_at, last_sync_at, last_sync_status, last_sync_error')
    .eq('user_id', authenticated.user.id)
    .order('connected_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Impossibile leggere gli account Google' }, { status: 500 })
  }

  return NextResponse.json(data || [])
}

export async function PATCH(request: NextRequest) {
  const authenticated = await requireUser(request)
  if (!authenticated) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    accountId?: string
    projectId?: string | null
  } | null
  const accountId = body?.accountId
  const projectId = body?.projectId ?? null

  if (!accountId || (projectId !== null && typeof projectId !== 'string')) {
    return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  }

  if (
    projectId &&
    !(await userCanUseProject(authenticated.admin, authenticated.user.id, projectId))
  ) {
    return NextResponse.json({ error: 'Progetto non accessibile' }, { status: 403 })
  }

  const { data, error } = await authenticated.admin
    .from('gmail_accounts')
    .update({ default_project_id: projectId })
    .eq('id', accountId)
    .eq('user_id', authenticated.user.id)
    .select('id, email, default_project_id, connected_at, last_sync_at, last_sync_status, last_sync_error')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Impossibile aggiornare l’account Google' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Account Google non trovato' }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const authenticated = await requireUser(request)
  if (!authenticated) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { accountId?: string } | null
  if (!body?.accountId) {
    return NextResponse.json({ error: 'Account Google non valido' }, { status: 400 })
  }

  const { data: account, error: readError } = await authenticated.admin
    .from('gmail_accounts')
    .select('id, access_token, refresh_token')
    .eq('id', body.accountId)
    .eq('user_id', authenticated.user.id)
    .maybeSingle()

  if (readError) {
    return NextResponse.json({ error: 'Impossibile scollegare l’account Google' }, { status: 500 })
  }
  if (!account) {
    return NextResponse.json({ error: 'Account Google non trovato' }, { status: 404 })
  }

  await revokeGoogleToken(account.refresh_token || account.access_token)
  const { error: deleteError } = await authenticated.admin
    .from('gmail_accounts')
    .delete()
    .eq('id', account.id)
    .eq('user_id', authenticated.user.id)

  if (deleteError) {
    return NextResponse.json({ error: 'Impossibile scollegare l’account Google' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
