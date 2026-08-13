import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  const { data, error } = await context.admin
    .from('users')
    .select('id, email, full_name, phone, role, is_active, created_at')
    .eq('id', context.user.id)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Profilo non disponibile' }, { status: 500 })
  }

  return NextResponse.json({ profile: data })
}

export async function PATCH(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    full_name?: string
    phone?: string
  } | null
  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''

  if (!fullName || fullName.length > 120 || phone.length > 40) {
    return NextResponse.json({ error: 'Controlla nome e numero di telefono' }, { status: 400 })
  }

  const { data, error } = await context.admin
    .from('users')
    .update({
      full_name: fullName,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', context.user.id)
    .select('id, email, full_name, phone, role, is_active, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Salvataggio profilo non riuscito' }, { status: 500 })
  }

  return NextResponse.json({ profile: data })
}
