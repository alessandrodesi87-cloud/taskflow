import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/serverAuth'
import { loadNotificationDefaults } from '@/lib/integrations/email'
import { loadTelegramDefaults } from '@/lib/integrations/telegram'

export const dynamic = 'force-dynamic'

const TIME_PATTERN = /^(0[7-9]|1\d|2[0-2]):[0-5]\d$/

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request)
  if (!context) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const [emailDefaults, telegramDefaults, { data: preferences, error: preferencesError }] = await Promise.all([
      loadNotificationDefaults(context.admin),
      loadTelegramDefaults(context.admin),
      context.admin
        .from('user_notification_preferences')
        .select('email_enabled_override, email_time_override, include_overdue_override, telegram_enabled_override, telegram_time_override'),
    ])
    if (preferencesError) throw preferencesError
    const personalizedUsers = (preferences || []).filter((preference) => (
      preference.email_enabled_override !== null
      || preference.email_time_override !== null
      || preference.include_overdue_override !== null
      || preference.telegram_enabled_override !== null
      || preference.telegram_time_override !== null
    )).length

    return NextResponse.json({
      defaults: { ...emailDefaults, ...telegramDefaults },
      personalized_users: personalizedUsers,
      email_configured: Boolean(process.env.RESEND_API_KEY),
      replies_configured: Boolean(process.env.RESEND_REPLY_TO && process.env.RESEND_WEBHOOK_SECRET),
      telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
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
    || typeof body.telegram_enabled !== 'boolean'
    || typeof body.include_overdue !== 'boolean'
    || typeof body.email_time !== 'string'
    || typeof body.telegram_time !== 'string'
    || !TIME_PATTERN.test(body.email_time)
    || !TIME_PATTERN.test(body.telegram_time)
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
        telegram_enabled: body.telegram_enabled,
        telegram_time: body.telegram_time,
        include_overdue: body.include_overdue,
        updated_by: context.user.id,
      })
      .eq('id', 1)

    if (error) throw error
    return NextResponse.json({ saved: true })
  } catch (error) {
    console.error('Unable to save admin notification defaults:', error)
    return NextResponse.json({ error: 'Impossibile salvare le impostazioni di notifica' }, { status: 500 })
  }
}

