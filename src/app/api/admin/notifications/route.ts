import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/serverAuth'
import { loadNotificationDefaults } from '@/lib/integrations/email'

export const dynamic = 'force-dynamic'

const TIME_PATTERN = /^(0[7-9]|1\d|2[0-2]):[0-5]\d$/

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const [defaults, { count, error: countError }] = await Promise.all([
      loadNotificationDefaults(context.admin),
      context.admin
        .from('user_notification_preferences')
        .select('*', { count: 'exact', head: true }),
    ])
    if (countError) throw countError

    return NextResponse.json({
      defaults,
      personalized_users: count || 0,
      email_configured: Boolean(process.env.RESEND_API_KEY),
      replies_configured: Boolean(process.env.RESEND_REPLY_TO && process.env.RESEND_WEBHOOK_SECRET),
    })
  } catch (error) {
    console.error('Unable to load admin notification defaults:', error)
    return NextResponse.json({ error: 'Impossibile caricare le impostazioni email' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (
    !body
    || typeof body.email_enabled !== 'boolean'
    || typeof body.include_overdue !== 'boolean'
    || typeof body.email_time !== 'string'
    || !TIME_PATTERN.test(body.email_time)
  ) {
    return NextResponse.json(
      { error: 'Scegli un orario compreso tra le 07:00 e le 22:00.' },
      { status: 400 }
    )
  }

  try {
    const { error } = await context.admin
      .from('notification_defaults')
      .update({
        email_enabled: body.email_enabled,
        email_time: body.email_time,
        include_overdue: body.include_overdue,
        updated_by: context.user.id,
      })
      .eq('id', 1)

    if (error) throw error
    return NextResponse.json({ saved: true })
  } catch (error) {
    console.error('Unable to save admin notification defaults:', error)
    return NextResponse.json({ error: 'Impossibile salvare le impostazioni email' }, { status: 500 })
  }
}

