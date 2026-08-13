import 'server-only'

import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_TIMEZONE = 'Europe/Rome'
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'TaskFlow <notifications@graveldi.cc>'

export interface NotificationDefaults {
  email_enabled: boolean
  email_time: string
  timezone: string
  include_overdue: boolean
}

export interface NotificationOverrides {
  email_enabled: boolean | null
  email_time: string | null
  include_overdue: boolean | null
}

export type EffectiveNotificationPreferences = NotificationDefaults

interface ReminderTask {
  id: string
  title: string
  due_date: string
  priority: 'low' | 'medium' | 'high'
  project_name: string
}

interface UserRow {
  id: string
  email: string | null
  full_name: string | null
}

interface PreferenceRow {
  user_id: string
  email_enabled_override: boolean | null
  email_time_override: string | null
  include_overdue_override: boolean | null
  notification_project_ids: string[]
}

function getResend() {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
  return new Resend(apiKey)
}

function normalizeTime(value: string) {
  return value.slice(0, 5)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  )

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

function localDateString(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function addLocalDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function localDateTimeToUtc(dateString: string, time: string, timeZone: string) {
  const [year, month, day] = dateString.split('-').map(Number)
  const [hour, minute] = normalizeTime(time).split(':').map(Number)
  const desiredUtcShape = Date.UTC(year, month - 1, day, hour, minute, 0)
  let candidate = desiredUtcShape

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zonedParts(new Date(candidate), timeZone)
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
    candidate = desiredUtcShape - (representedAsUtc - candidate)
  }

  return new Date(candidate)
}

export function getNextReminderSchedule(
  emailTime: string,
  timeZone = DEFAULT_TIMEZONE,
  now = new Date()
) {
  let deliveryDate = localDateString(now, timeZone)
  let scheduledFor = localDateTimeToUtc(deliveryDate, emailTime, timeZone)

  if (scheduledFor.getTime() <= now.getTime() + 5 * 60 * 1000) {
    deliveryDate = addLocalDays(deliveryDate, 1)
    scheduledFor = localDateTimeToUtc(deliveryDate, emailTime, timeZone)
  }

  return { deliveryDate, scheduledFor }
}

export function mergeNotificationPreferences(
  defaults: NotificationDefaults,
  overrides?: PreferenceRow | null
): EffectiveNotificationPreferences {
  return {
    email_enabled: overrides?.email_enabled_override ?? defaults.email_enabled,
    email_time: normalizeTime(overrides?.email_time_override ?? defaults.email_time),
    timezone: defaults.timezone || DEFAULT_TIMEZONE,
    include_overdue: overrides?.include_overdue_override ?? defaults.include_overdue,
  }
}

export async function loadNotificationDefaults(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('notification_defaults')
    .select('email_enabled, email_time, timezone, include_overdue')
    .eq('id', 1)
    .single()

  if (error || !data) throw new Error(error?.message || 'Notification defaults not found')

  return {
    email_enabled: data.email_enabled,
    email_time: normalizeTime(data.email_time),
    timezone: data.timezone,
    include_overdue: data.include_overdue,
  } as NotificationDefaults
}

async function loadReminderTasks(
  admin: SupabaseClient,
  userId: string,
  deliveryDate: string,
  includeOverdue: boolean,
  projectIds: string[] = []
) {
  let query = admin
    .from('tasks')
    .select('id, title, due_date, priority, assignee_id, owner_id, projects(name)')
    .neq('status', 'done')
    .or(`assignee_id.eq.${userId},and(assignee_id.is.null,owner_id.eq.${userId})`)
    .order('due_date', { ascending: true })

  if (projectIds.length > 0) query = query.in('project_id', projectIds)

  query = includeOverdue
    ? query.lte('due_date', deliveryDate)
    : query.eq('due_date', deliveryDate)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data || []).map((task) => {
    const project = Array.isArray(task.projects) ? task.projects[0] : task.projects
    return {
      id: task.id,
      title: task.title,
      due_date: task.due_date,
      priority: task.priority,
      project_name: project?.name || 'Senza progetto',
    } as ReminderTask
  })
}

function priorityLabel(priority: ReminderTask['priority']) {
  if (priority === 'high') return 'Alta'
  if (priority === 'low') return 'Bassa'
  return 'Media'
}

function buildReminderContent(
  user: UserRow,
  tasks: ReminderTask[],
  deliveryDate: string,
  isTest: boolean
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://taskflow-zeta-plum.vercel.app'
  const canReply = Boolean(process.env.RESEND_REPLY_TO)
  const greeting = user.full_name?.trim() ? `Ciao ${escapeHtml(user.full_name.trim())},` : 'Ciao,'
  const overdueCount = tasks.filter((task) => task.due_date < deliveryDate).length
  const dueTodayCount = tasks.length - overdueCount

  const rows = tasks.map((task) => {
    const overdue = task.due_date < deliveryDate
    return `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb">
          <div style="font-weight:700;color:#111827">${escapeHtml(task.title)}</div>
          <div style="margin-top:4px;font-size:13px;color:#6b7280">${escapeHtml(task.project_name)} · Priorità ${priorityLabel(task.priority)}</div>
          <div style="margin-top:4px;font-size:12px;color:${overdue ? '#b91c1c' : '#2563eb'}">${overdue ? `Scaduto il ${task.due_date}` : 'Scade oggi'}</div>
          ${canReply ? `<div style="margin-top:7px;font-family:monospace;font-size:11px;color:#6b7280">ID: ${task.id}</div>` : ''}
        </td>
      </tr>`
  }).join('')

  const emptyState = `
    <div style="padding:24px;border-radius:12px;background:#ecfdf5;color:#166534;text-align:center">
      Nessun task in scadenza o arretrato. Ottimo lavoro!
    </div>`

  const replyHelp = canReply && tasks.length > 0 ? `
    <div style="margin-top:24px;padding:16px;border-radius:10px;background:#f3f4f6;color:#374151;font-size:13px">
      <strong>Rispondi direttamente a questa email</strong><br>
      Per completare: <code>DONE: ID-task</code><br>
      Per spostare la scadenza: <code>RESCHEDULE: ID-task 2026-08-15</code>
    </div>` : ''

  const summary = tasks.length > 0
    ? `${dueTodayCount} in scadenza oggi${overdueCount > 0 ? ` e ${overdueCount} arretrat${overdueCount === 1 ? 'o' : 'i'}` : ''}`
    : 'nessuna attività urgente'

  const html = `<!doctype html>
  <html lang="it">
    <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827">
      <div style="max-width:640px;margin:0 auto;padding:28px 16px">
        <div style="padding:24px;border-radius:16px 16px 0 0;background:#2563eb;color:white">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">TaskFlow</div>
          <h1 style="margin:8px 0 0;font-size:26px">${isTest ? 'Email di prova' : 'La tua agenda di oggi'}</h1>
        </div>
        <div style="padding:24px;border-radius:0 0 16px 16px;background:white">
          <p style="margin-top:0">${greeting}</p>
          <p style="color:#4b5563">Hai ${summary}.</p>
          ${tasks.length > 0 ? `<table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px">${rows}</table>` : emptyState}
          ${replyHelp}
          <a href="${escapeHtml(appUrl)}/dashboard" style="display:inline-block;margin-top:24px;padding:12px 18px;border-radius:9px;background:#2563eb;color:white;text-decoration:none;font-weight:700">Apri TaskFlow</a>
        </div>
        <p style="margin:16px 4px 0;text-align:center;font-size:12px;color:#9ca3af">Puoi cambiare orario e preferenze dalle impostazioni di TaskFlow.</p>
      </div>
    </body>
  </html>`

  const lines = tasks.map((task) => (
    `- ${task.title} | ${task.project_name} | ${task.due_date < deliveryDate ? `scaduto ${task.due_date}` : 'scade oggi'} | ID ${task.id}`
  ))
  const text = `${isTest ? 'Email di prova TaskFlow' : 'La tua agenda TaskFlow'}\n\n${user.full_name ? `Ciao ${user.full_name},` : 'Ciao,'}\nHai ${summary}.\n\n${lines.length > 0 ? lines.join('\n') : 'Nessun task urgente.'}\n\nApri TaskFlow: ${appUrl}/dashboard${canReply && tasks.length > 0 ? '\n\nRispondi con DONE: ID-task oppure RESCHEDULE: ID-task YYYY-MM-DD' : ''}`

  return {
    subject: isTest
      ? 'TaskFlow: email di prova riuscita'
      : `TaskFlow: ${tasks.length} task da controllare oggi`,
    html,
    text,
  }
}

async function deliverReminder(
  user: UserRow,
  tasks: ReminderTask[],
  deliveryDate: string,
  options: { scheduledFor?: Date; idempotencyKey: string; isTest: boolean }
) {
  if (!user.email) throw new Error('User email is missing')

  const content = buildReminderContent(user, tasks, deliveryDate, options.isTest)
  const replyTo = process.env.RESEND_REPLY_TO
  const { data, error } = await getResend().emails.send({
    from: RESEND_FROM_EMAIL,
    to: user.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    replyTo: replyTo || undefined,
    scheduledAt: options.scheduledFor?.toISOString(),
    tags: [
      { name: 'category', value: options.isTest ? 'test' : 'daily_digest' },
      { name: 'user_id', value: user.id },
    ],
  }, {
    idempotencyKey: options.idempotencyKey,
  })

  if (error || !data) throw new Error(error?.message || 'Resend did not return a message id')
  return data.id
}

export async function scheduleDailyReminders(admin: SupabaseClient, now = new Date()) {
  const defaults = await loadNotificationDefaults(admin)
  const [{ data: users, error: usersError }, { data: preferences, error: preferencesError }] = await Promise.all([
    admin.from('users').select('id, email, full_name').eq('is_active', true).not('email', 'is', null),
    admin.from('user_notification_preferences').select(
      'user_id, email_enabled_override, email_time_override, include_overdue_override, notification_project_ids'
    ),
  ])

  if (usersError) throw new Error(usersError.message)
  if (preferencesError) throw new Error(preferencesError.message)

  const preferenceMap = new Map(
    ((preferences || []) as PreferenceRow[]).map((preference) => [preference.user_id, preference])
  )
  const result = { scheduled: 0, skipped: 0, disabled: 0, failures: [] as Array<{ userId: string; message: string }> }

  for (const user of (users || []) as UserRow[]) {
    const preference = preferenceMap.get(user.id)
    const effective = mergeNotificationPreferences(defaults, preference)
    if (!effective.email_enabled) {
      result.disabled += 1
      continue
    }

    const { deliveryDate, scheduledFor } = getNextReminderSchedule(
      effective.email_time,
      effective.timezone,
      now
    )

    const { data: insertedDelivery, error: insertError } = await admin
      .from('notification_deliveries')
      .insert({
        user_id: user.id,
        notification_kind: 'daily_digest',
        delivery_date: deliveryDate,
        scheduled_for: scheduledFor.toISOString(),
        status: 'preparing',
      })
      .select('id')
      .single()

    let delivery = insertedDelivery
    if (insertError?.code === '23505') {
      const { data: existingDelivery, error: existingError } = await admin
        .from('notification_deliveries')
        .select('id, status, created_at')
        .eq('user_id', user.id)
        .eq('notification_kind', 'daily_digest')
        .eq('delivery_date', deliveryDate)
        .maybeSingle()

      if (existingError || !existingDelivery) {
        result.failures.push({
          userId: user.id,
          message: existingError?.message || 'Existing delivery not found',
        })
        continue
      }

      const preparingIsStale = existingDelivery.status === 'preparing'
        && new Date(existingDelivery.created_at).getTime() < now.getTime() - 15 * 60 * 1000
      if (existingDelivery.status !== 'failed' && !preparingIsStale) {
        result.skipped += 1
        continue
      }

      const { error: retryError } = await admin
        .from('notification_deliveries')
        .update({
          status: 'preparing',
          scheduled_for: scheduledFor.toISOString(),
          error_message: null,
        })
        .eq('id', existingDelivery.id)
      if (retryError) {
        result.failures.push({ userId: user.id, message: retryError.message })
        continue
      }
      delivery = { id: existingDelivery.id }
    }
    if (insertError || !delivery) {
      result.failures.push({ userId: user.id, message: insertError?.message || 'Delivery row not created' })
      continue
    }

    try {
      const tasks = await loadReminderTasks(
        admin,
        user.id,
        deliveryDate,
        effective.include_overdue,
        preference?.notification_project_ids || []
      )

      if (tasks.length === 0) {
        await admin
          .from('notification_deliveries')
          .update({ status: 'skipped', task_count: 0 })
          .eq('id', delivery.id)
        result.skipped += 1
        continue
      }

      const providerMessageId = await deliverReminder(user, tasks, deliveryDate, {
        scheduledFor,
        idempotencyKey: `daily-${user.id}-${deliveryDate}`,
        isTest: false,
      })

      await admin
        .from('notification_deliveries')
        .update({
          status: 'scheduled',
          provider_message_id: providerMessageId,
          task_count: tasks.length,
        })
        .eq('id', delivery.id)
      result.scheduled += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reminder error'
      await admin
        .from('notification_deliveries')
        .update({ status: 'failed', error_message: message.slice(0, 1000) })
        .eq('id', delivery.id)
      result.failures.push({ userId: user.id, message })
    }
  }

  return result
}

export async function sendTestReminder(admin: SupabaseClient, userId: string) {
  const defaults = await loadNotificationDefaults(admin)
  const [{ data: user, error: userError }, { data: preference, error: preferenceError }] = await Promise.all([
    admin.from('users').select('id, email, full_name').eq('id', userId).single(),
    admin.from('user_notification_preferences')
      .select('user_id, email_enabled_override, email_time_override, include_overdue_override, notification_project_ids')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (userError || !user?.email) throw new Error(userError?.message || 'Email utente non disponibile')
  if (preferenceError) throw new Error(preferenceError.message)

  const effective = mergeNotificationPreferences(defaults, preference as PreferenceRow | null)
  const deliveryDate = localDateString(new Date(), effective.timezone)
  const tasks = await loadReminderTasks(
    admin,
    userId,
    deliveryDate,
    effective.include_overdue,
    (preference as PreferenceRow | null)?.notification_project_ids || []
  )
  const providerMessageId = await deliverReminder(user as UserRow, tasks, deliveryDate, {
    idempotencyKey: `test-${userId}-${crypto.randomUUID()}`,
    isTest: true,
  })

  await admin.from('notification_deliveries').insert({
    user_id: userId,
    notification_kind: 'test',
    delivery_date: deliveryDate,
    sent_at: new Date().toISOString(),
    status: 'sent',
    provider_message_id: providerMessageId,
    task_count: tasks.length,
  })

  return { providerMessageId, taskCount: tasks.length }
}

export async function processStructuredReply(
  admin: SupabaseClient,
  senderEmail: string,
  body: string
) {
  const sender = senderEmail.trim().toLowerCase()
  const { data: user, error: userError } = await admin
    .from('users')
    .select('id')
    .ilike('email', sender)
    .maybeSingle()

  if (userError) throw new Error(userError.message)
  if (!user) return { processed: 0, ignored: 1, details: ['Mittente non riconosciuto'] }

  const commands: Array<{ type: 'done' | 'reschedule'; taskId: string; date?: string }> = []
  const commandPattern = /(?:^|\n)\s*(DONE|RESCHEDULE):\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\s+(\d{4}-\d{2}-\d{2}))?/gi
  for (const match of body.matchAll(commandPattern)) {
    const type = match[1].toLowerCase() as 'done' | 'reschedule'
    if (type === 'reschedule' && !match[3]) continue
    commands.push({ type, taskId: match[2], date: match[3] })
  }

  let processed = 0
  let ignored = 0
  const details: string[] = []

  for (const command of commands.slice(0, 20)) {
    const { data: task, error: taskError } = await admin
      .from('tasks')
      .select('id, start_date, assignee_id, owner_id')
      .eq('id', command.taskId)
      .maybeSingle()

    if (taskError) throw new Error(taskError.message)
    const canManage = task && (
      task.assignee_id === user.id
      || (!task.assignee_id && task.owner_id === user.id)
    )
    if (!canManage) {
      ignored += 1
      details.push(`${command.taskId}: non autorizzato`)
      continue
    }

    if (command.type === 'done') {
      const { error } = await admin.from('tasks').update({ status: 'done' }).eq('id', task.id)
      if (error) throw new Error(error.message)
      processed += 1
      details.push(`${task.id}: completato`)
      continue
    }

    const date = command.date as string
    const parsedDate = new Date(`${date}T00:00:00Z`)
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      ignored += 1
      details.push(`${task.id}: data non valida`)
      continue
    }

    const update: { due_date: string; start_date?: string } = { due_date: date }
    if (task.start_date > date) update.start_date = date
    const { error } = await admin.from('tasks').update(update).eq('id', task.id)
    if (error) throw new Error(error.message)
    processed += 1
    details.push(`${task.id}: scadenza ${date}`)
  }

  if (commands.length === 0) {
    ignored += 1
    details.push('Nessun comando valido trovato')
  }

  return { processed, ignored, details }
}
