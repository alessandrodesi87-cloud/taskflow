import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/serverAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await context.admin
    .from('users')
    .select('id, email, full_name, role, phone, telegram_chat_id')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Unable to load users' }, { status: 500 })
  }

  return NextResponse.json({ users: data })
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
