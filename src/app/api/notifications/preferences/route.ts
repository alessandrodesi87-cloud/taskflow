import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/serverAuth'
import {
  loadNotificationDefaults,
  mergeNotificationPreferences,
} from '@/lib/integrations/email'
import {
  loadTelegramDefaults,
  mergeTelegramPreferences,
} from '@/lib/integrations/telegram'

export const dynamic = 'force-dynamic'

const TIME_PATTERN = /^(0[7-9]|1\d|2[0-2]):[0-5]\d$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_NOTIFICATION_PROJECTS = 50

function timeValue(value: unknown) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return null
  return value
}

function projectIdsValue(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_NOTIFICATION_PROJECTS) return null
  if (value.some((projectId) => typeof projectId !== 'string' || !UUID_PATTERN.test(projectId))) {
    return null
  }
  return Array.from(new Set(value as string[]))
}

async function canUseProjects(
  admin: SupabaseClient,
  userId: string,
  projectIds: string[]
) {
  if (projectIds.length === 0) return true
  const [{ data: owned, error: ownedError }, { data: memberships, error: membershipError }] = await Promise.all([
    admin.from('projects')
      .select('id')
      .in('id', projectIds)
      .eq('owner_id', userId),
    admin.from('project_members')
      .select('project_id')
      .in('project_id', projectIds)
      .eq('user_id', userId),
  ])
  if (ownedError) throw ownedError
  if (membershipError) throw membershipError
  const availableIds = new Set([
    ...(owned || []).map((project) => project.id),
    ...(memberships || []).map((membership) => membership.project_id),
  ])
  return projectIds.every((projectId) => availableIds.has(projectId))
}

export async function GET(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  try {
    const [emailDefaults, telegramDefaults, { data: preference, error: preferenceError }, { data: deliveries, error: deliveriesError }, { data: profile, error: profileError }] = await Promise.all([
      loadNotificationDefaults(context.admin),
      loadTelegramDefaults(context.admin),
      context.admin
        .from('user_notification_preferences')
        .select('user_id, email_enabled_override, email_time_override, include_overdue_override, telegram_enabled_override, telegram_time_override, telegram_default_project_id, notification_project_ids')
        .eq('user_id', context.user.id)
        .maybeSingle(),
      context.admin
        .from('notification_deliveries')
        .select('id, notification_kind, delivery_date, scheduled_for, sent_at, status, task_count, created_at')
        .eq('user_id', context.user.id)
        .order('created_at', { ascending: false })
        .limit(5),
      context.admin
        .from('users')
        .select('telegram_chat_id')
        .eq('id', context.user.id)
        .single(),
    ])

    if (preferenceError) throw preferenceError
    if (deliveriesError) throw deliveriesError
    if (profileError) throw profileError

    const defaults = { ...emailDefaults, ...telegramDefaults }

    const overrides = preference ? {
      email_enabled: preference.email_enabled_override,
      email_time: preference.email_time_override?.slice(0, 5) || null,
      telegram_enabled: preference.telegram_enabled_override,
      telegram_time: preference.telegram_time_override?.slice(0, 5) || null,
      include_overdue: preference.include_overdue_override,
      telegram_default_project_id: preference.telegram_default_project_id,
      notification_project_ids: preference.notification_project_ids || [],
    } : {
      email_enabled: null,
      email_time: null,
      telegram_enabled: null,
      telegram_time: null,
      include_overdue: null,
      telegram_default_project_id: null,
      notification_project_ids: [],
    }

    const effectiveEmail = mergeNotificationPreferences(emailDefaults, preference)
    const effectiveTelegram = mergeTelegramPreferences(telegramDefaults, preference)

    return NextResponse.json({
      defaults,
      overrides,
      effective: { ...effectiveEmail, ...effectiveTelegram },
      using_defaults: !preference || (
        preference.email_enabled_override === null
        && preference.email_time_override === null
        && preference.telegram_enabled_override === null
        && preference.telegram_time_override === null
        && preference.include_overdue_override === null
      ),
      deliveries: deliveries || [],
      replies_enabled: Boolean(process.env.RESEND_REPLY_TO && process.env.RESEND_WEBHOOK_SECRET),
      telegram_connected: Boolean(profile.telegram_chat_id),
      telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    })
  } catch (error) {
    console.error('Unable to load notification preferences:', error)
    return NextResponse.json({ error: 'Impossibile caricare le preferenze di notifica' }, { status: 500 })
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
    const defaultProjectId = typeof body.telegram_default_project_id === 'string'
      && body.telegram_default_project_id.length > 0
      ? body.telegram_default_project_id
      : null
    const notificationProjectIds = projectIdsValue(body.notification_project_ids)

    if (!notificationProjectIds) {
      return NextResponse.json({ error: 'La selezione dei progetti non è valida' }, { status: 400 })
    }

    const requestedProjectIds = Array.from(new Set([
      ...notificationProjectIds,
      ...(defaultProjectId ? [defaultProjectId] : []),
    ]))
    if (!await canUseProjects(context.admin, context.user.id, requestedProjectIds)) {
      return NextResponse.json({ error: 'Uno o più progetti scelti non sono disponibili' }, { status: 400 })
    }

    if (body.use_defaults === true) {
      const { error } = await context.admin
        .from('user_notification_preferences')
        .upsert({
          user_id: context.user.id,
          email_enabled_override: null,
          email_time_override: null,
          telegram_enabled_override: null,
          telegram_time_override: null,
          include_overdue_override: null,
          telegram_default_project_id: defaultProjectId,
          notification_project_ids: notificationProjectIds,
        }, { onConflict: 'user_id' })
      if (error) throw error
      return NextResponse.json({ saved: true, using_defaults: true })
    }

    if (
      typeof body.email_enabled !== 'boolean'
      || typeof body.telegram_enabled !== 'boolean'
      || typeof body.include_overdue !== 'boolean'
      || !timeValue(body.email_time)
      || !timeValue(body.telegram_time)
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
        telegram_enabled_override: body.telegram_enabled,
        telegram_time_override: body.telegram_time,
        include_overdue_override: body.include_overdue,
        telegram_default_project_id: defaultProjectId,
        notification_project_ids: notificationProjectIds,
      }, { onConflict: 'user_id' })

    if (error) throw error
    return NextResponse.json({ saved: true, using_defaults: false })
  } catch (error) {
    console.error('Unable to save notification preferences:', error)
    return NextResponse.json({ error: 'Impossibile salvare le preferenze di notifica' }, { status: 500 })
  }
}
