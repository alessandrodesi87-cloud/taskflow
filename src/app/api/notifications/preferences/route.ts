import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import {
  loadNotificationDefaults,
  mergeNotificationPreferences,
} from '@/lib/integrations/email'

export const dynamic = 'force-dynamic'

const TIME_PATTERN = /^(0[7-9]|1\d|2[0-2]):[0-5]\d$/

function timeValue(value: unknown) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return null
  return value
}

export async function GET(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  try {
    const [defaults, { data: preference, error: preferenceError }, { data: deliveries, error: deliveriesError }] = await Promise.all([
      loadNotificationDefaults(context.admin),
      context.admin
        .from('user_notification_preferences')
        .select('user_id, email_enabled_override, email_time_override, include_overdue_override')
        .eq('user_id', context.user.id)
        .maybeSingle(),
      context.admin
        .from('notification_deliveries')
        .select('id, notification_kind, delivery_date, scheduled_for, sent_at, status, task_count, created_at')
        .eq('user_id', context.user.id)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    if (preferenceError) throw preferenceError
    if (deliveriesError) throw deliveriesError

    const overrides = preference ? {
      email_enabled: preference.email_enabled_override,
      email_time: preference.email_time_override?.slice(0, 5) || null,
      include_overdue: preference.include_overdue_override,
    } : {
      email_enabled: null,
      email_time: null,
      include_overdue: null,
    }

    return NextResponse.json({
      defaults,
      overrides,
      effective: mergeNotificationPreferences(defaults, preference),
      using_defaults: !preference || (
        preference.email_enabled_override === null
        && preference.email_time_override === null
        && preference.include_overdue_override === null
      ),
      deliveries: deliveries || [],
      replies_enabled: Boolean(process.env.RESEND_REPLY_TO && process.env.RESEND_WEBHOOK_SECRET),
    })
  } catch (error) {
    console.error('Unable to load notification preferences:', error)
    return NextResponse.json({ error: 'Impossibile caricare le preferenze email' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  }

  try {
    if (body.use_defaults === true) {
      const { error } = await context.admin
        .from('user_notification_preferences')
        .delete()
        .eq('user_id', context.user.id)
      if (error) throw error
      return NextResponse.json({ saved: true, using_defaults: true })
    }

    if (
      typeof body.email_enabled !== 'boolean'
      || typeof body.include_overdue !== 'boolean'
      || !timeValue(body.email_time)
    ) {
      return NextResponse.json(
        { error: 'Scegli un orario compreso tra le 07:00 e le 22:00.' },
        { status: 400 }
      )
    }

    const { error } = await context.admin
      .from('user_notification_preferences')
      .upsert({
        user_id: context.user.id,
        email_enabled_override: body.email_enabled,
        email_time_override: body.email_time,
        include_overdue_override: body.include_overdue,
      }, { onConflict: 'user_id' })

    if (error) throw error
    return NextResponse.json({ saved: true, using_defaults: false })
  } catch (error) {
    console.error('Unable to save notification preferences:', error)
    return NextResponse.json({ error: 'Impossibile salvare le preferenze email' }, { status: 500 })
  }
}
