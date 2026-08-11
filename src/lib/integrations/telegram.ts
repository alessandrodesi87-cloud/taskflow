import 'server-only'

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const TELEGRAM_API_URL = 'https://api.telegram.org'
const DEFAULT_TIMEZONE = 'Europe/Rome'
const MAX_REMINDER_TASKS = 30
const MAX_TELEGRAM_TITLE_LENGTH = 200

export interface TelegramDefaults {
  telegram_enabled: boolean
  telegram_time: string
  timezone: string
  include_overdue: boolean
}

export interface TelegramPreferenceRow {
  user_id: string
  telegram_enabled_override: boolean | null
  telegram_time_override: string | null
  include_overdue_override: boolean | null
  telegram_default_project_id: string | null
  notification_project_ids: string[]
}

export interface TelegramUpdate {
  update_id: number
  message?: {
    text?: string
    chat: { id: number }
  }
  callback_query?: {
    id: string
    data?: string
    message?: {
      chat: { id: number }
    }
  }
}

interface TelegramUserRow {
  id: string
  full_name: string | null
  telegram_chat_id: string
}

interface TelegramTaskRow {
  id: string
  title: string
  due_date: string
  priority: 'low' | 'medium' | 'high'
  owner_id: string
  assignee_id: string | null
  projects: { name: string } | Array<{ name: string }> | null
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

interface TelegramMessageResult {
  message_id: number
}

type CreateTelegramTaskResult =
  | { ok: false; error: string }
  | {
    ok: true
    task: { id: string; title: string; due_date: string }
    projectName: string
  }

let cachedBotUsername: string | null = null

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
  return token
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
  }
}

function localDateAndTime(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  }
}

function derivedSecret(purpose: 'webhook' | 'dispatch') {
  return createHmac('sha256', getBotToken())
    .update(`taskflow-telegram-${purpose}-v1`)
    .digest('hex')
}

function secretMatches(received: string | null, expected: string) {
  if (!received) return false
  const actualBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function getTelegramWebhookSecret() {
  return derivedSecret('webhook')
}

export function getTelegramDispatchSecret() {
  return derivedSecret('dispatch')
}

export function verifyTelegramWebhookSecret(received: string | null) {
  return secretMatches(received, getTelegramWebhookSecret())
}

export function verifyTelegramDispatchSecret(received: string | null) {
  const token = received?.startsWith('Bearer ') ? received.slice(7) : received
  return secretMatches(token || null, getTelegramDispatchSecret())
}

export async function configureTelegramWebhook(appOrigin: string) {
  const webhookUrl = new URL('/api/telegram/webhook', appOrigin)
  if (webhookUrl.protocol !== 'https:') {
    throw new Error('Telegram webhook requires an HTTPS application URL')
  }

  await telegramRequest<boolean>('setWebhook', {
    url: webhookUrl.toString(),
    secret_token: getTelegramWebhookSecret(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  })

  return webhookUrl.toString()
}

async function telegramRequest<T>(method: string, payload?: Record<string, unknown>) {
  const response = await fetch(`${TELEGRAM_API_URL}/bot${getBotToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as TelegramApiResponse<T> | null

  if (!response.ok || !body?.ok || body.result === undefined) {
    throw new Error(body?.description || `Telegram ${method} failed`)
  }
  return body.result
}

export async function getTelegramBotUsername() {
  if (cachedBotUsername) return cachedBotUsername
  const bot = await telegramRequest<{ username?: string }>('getMe')
  if (!bot.username) throw new Error('Telegram bot username not available')
  cachedBotUsername = bot.username
  return bot.username
}

async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
  return telegramRequest<TelegramMessageResult>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  await telegramRequest<boolean>('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  })
}

export async function loadTelegramDefaults(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('notification_defaults')
    .select('telegram_enabled, telegram_time, timezone, include_overdue')
    .eq('id', 1)
    .single()

  if (error || !data) throw new Error(error?.message || 'Telegram defaults not found')
  return {
    telegram_enabled: data.telegram_enabled,
    telegram_time: normalizeTime(data.telegram_time),
    timezone: data.timezone || DEFAULT_TIMEZONE,
    include_overdue: data.include_overdue,
  } as TelegramDefaults
}

export function mergeTelegramPreferences(
  defaults: TelegramDefaults,
  preference?: TelegramPreferenceRow | null
) {
  return {
    telegram_enabled: preference?.telegram_enabled_override ?? defaults.telegram_enabled,
    telegram_time: normalizeTime(
      preference?.telegram_time_override ?? defaults.telegram_time
    ),
    timezone: defaults.timezone || DEFAULT_TIMEZONE,
    include_overdue: preference?.include_overdue_override ?? defaults.include_overdue,
  }
}

export async function createTelegramLinkToken(admin: SupabaseClient, userId: string) {
  const token = randomBytes(24).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const { error } = await admin.from('telegram_link_tokens').upsert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    used_at: null,
  }, { onConflict: 'user_id' })

  if (error) throw new Error(error.message)
  return { token, expiresAt }
}

async function consumeTelegramLinkToken(
  admin: SupabaseClient,
  token: string,
  chatId: string
) {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { data, error } = await admin.rpc('consume_telegram_link_token', {
    p_token_hash: tokenHash,
    p_chat_id: chatId,
  })

  if (error) throw new Error(error.message)
  return typeof data === 'string' ? data : null
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
    .select('id, title, due_date, priority, owner_id, assignee_id, projects(name)')
    .neq('status', 'done')
    .or(`assignee_id.eq.${userId},and(assignee_id.is.null,owner_id.eq.${userId})`)
    .order('due_date', { ascending: true })
    .limit(MAX_REMINDER_TASKS)

  if (projectIds.length > 0) query = query.in('project_id', projectIds)

  query = includeOverdue
    ? query.lte('due_date', deliveryDate)
    : query.eq('due_date', deliveryDate)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []) as TelegramTaskRow[]
}

function projectName(task: TelegramTaskRow) {
  if (Array.isArray(task.projects)) return task.projects[0]?.name || 'Progetto'
  return task.projects?.name || 'Progetto'
}

function priorityLabel(priority: TelegramTaskRow['priority']) {
  if (priority === 'high') return 'Alta'
  if (priority === 'low') return 'Bassa'
  return 'Media'
}

function buildReminderMessage(
  fullName: string | null,
  tasks: TelegramTaskRow[],
  deliveryDate: string,
  isTest = false
) {
  const greeting = fullName?.trim() ? `Ciao ${escapeHtml(fullName.trim())},` : 'Ciao,'
  if (tasks.length === 0) {
    return {
      text: `${greeting}\n\n${isTest ? '✅ Il collegamento funziona.' : '✅ Nessun task da controllare oggi.'}`,
      replyMarkup: undefined,
    }
  }

  const rows = tasks.map((task) => {
    const overdue = task.due_date < deliveryDate ? ' · arretrato' : ''
    return `• <b>${escapeHtml(task.title)}</b>\n  ${escapeHtml(projectName(task))} · ${task.due_date}${overdue} · priorità ${priorityLabel(task.priority)}`
  })
  const buttons = tasks.slice(0, 12).map((task) => ([{
    text: `✅ ${task.title.slice(0, 32)}`,
    callback_data: `done:${task.id}`,
  }]))

  return {
    text: `${greeting}\n\n<b>${isTest ? 'Test TaskFlow' : 'TaskFlow · attività da controllare'}</b>\n\n${rows.join('\n\n')}\n\nPuoi completare un task con il pulsante oppure scrivere /today per aggiornare l’elenco.`,
    replyMarkup: { inline_keyboard: buttons },
  }
}

async function markTaskDone(admin: SupabaseClient, userId: string, taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null
  const { data: task, error } = await admin
    .from('tasks')
    .select('id, title, owner_id, assignee_id, status')
    .eq('id', taskId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!task) return null
  const authorized = task.assignee_id === userId
    || (!task.assignee_id && task.owner_id === userId)
  if (!authorized) return null

  if (task.status !== 'done') {
    const { error: updateError } = await admin
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', task.id)
    if (updateError) throw new Error(updateError.message)
  }
  return task.title as string
}

async function canUseProject(admin: SupabaseClient, userId: string, projectId: string) {
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, name, owner_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) throw new Error(projectError.message)
  if (!project) return null
  if (project.owner_id === userId) return project

  const { data: membership, error: membershipError } = await admin
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (membershipError) throw new Error(membershipError.message)
  return membership ? project : null
}

async function createTaskFromTelegram(
  admin: SupabaseClient,
  userId: string,
  rawText: string,
  timezone: string
): Promise<CreateTelegramTaskResult> {
  const { data: preference, error: preferenceError } = await admin
    .from('user_notification_preferences')
    .select('telegram_default_project_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (preferenceError) throw new Error(preferenceError.message)
  if (!preference?.telegram_default_project_id) {
    return { ok: false, error: 'Scegli prima il progetto predefinito nelle Impostazioni di TaskFlow.' }
  }

  const project = await canUseProject(admin, userId, preference.telegram_default_project_id)
  if (!project) return { ok: false, error: 'Il progetto predefinito non è più disponibile. Scegline un altro nelle Impostazioni.' }

  const today = localDateAndTime(new Date(), timezone).date
  const dateMatch = rawText.match(/\|\s*(\d{4}-\d{2}-\d{2})\s*$/)
  const dueDate = dateMatch?.[1] || today
  const title = rawText.replace(/\|\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim()
  if (!title) return { ok: false, error: 'Scrivi il titolo del task. Esempio: Preparare preventivo' }
  if (title.length > MAX_TELEGRAM_TITLE_LENGTH) {
    return { ok: false, error: `Il titolo può contenere al massimo ${MAX_TELEGRAM_TITLE_LENGTH} caratteri.` }
  }
  const parsedDueDate = new Date(`${dueDate}T00:00:00Z`)
  if (Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate) {
    return { ok: false, error: 'La data non è valida. Usa il formato AAAA-MM-GG.' }
  }

  const { data: task, error } = await admin.from('tasks').insert({
    project_id: project.id,
    title,
    start_date: today,
    due_date: dueDate,
    priority: 'medium',
    owner_id: userId,
    creator_id: userId,
    assignee_id: userId,
    status: 'todo',
  }).select('id, title, due_date').single()
  if (error) throw new Error(error.message)

  return { ok: true, task, projectName: project.name as string }
}

async function loadTelegramUser(admin: SupabaseClient, chatId: string) {
  const { data, error } = await admin
    .from('users')
    .select('id, full_name, telegram_chat_id')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as TelegramUserRow | null
}

async function sendCurrentTasks(admin: SupabaseClient, user: TelegramUserRow) {
  const [defaults, { data: preference, error: preferenceError }] = await Promise.all([
    loadTelegramDefaults(admin),
    admin.from('user_notification_preferences')
      .select('user_id, telegram_enabled_override, telegram_time_override, include_overdue_override, telegram_default_project_id, notification_project_ids')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (preferenceError) throw new Error(preferenceError.message)
  const effective = mergeTelegramPreferences(defaults, preference as TelegramPreferenceRow | null)
  const deliveryDate = localDateAndTime(new Date(), effective.timezone).date
  const tasks = await loadReminderTasks(
    admin,
    user.id,
    deliveryDate,
    effective.include_overdue,
    (preference as TelegramPreferenceRow | null)?.notification_project_ids || []
  )
  const content = buildReminderMessage(user.full_name, tasks, deliveryDate)
  await sendTelegramMessage(user.telegram_chat_id, content.text, content.replyMarkup)
}

export async function processTelegramUpdate(admin: SupabaseClient, update: TelegramUpdate) {
  const callback = update.callback_query
  const chatId = String(callback?.message?.chat.id ?? update.message?.chat.id ?? '')
  if (!chatId) return

  if (callback?.data?.startsWith('done:')) {
    const user = await loadTelegramUser(admin, chatId)
    if (!user) {
      await answerCallbackQuery(callback.id, 'Collega prima Telegram da TaskFlow.')
      return
    }
    const title = await markTaskDone(admin, user.id, callback.data.slice(5))
    await answerCallbackQuery(
      callback.id,
      title ? `Completato: ${title}` : 'Task non disponibile.'
    )
    return
  }

  const text = update.message?.text?.trim()
  if (!text) return
  const command = text.split(/\s+/, 1)[0].split('@')[0].toLowerCase()

  if (command === '/start') {
    const token = text.split(/\s+/, 2)[1]
    if (token) {
      try {
        const userId = await consumeTelegramLinkToken(admin, token, chatId)
        if (!userId) {
          await sendTelegramMessage(chatId, 'Questo collegamento è scaduto o è già stato usato. Generane uno nuovo nelle Impostazioni di TaskFlow.')
          return
        }
        await sendTelegramMessage(
          chatId,
          '<b>Telegram è collegato a TaskFlow.</b>\n\nScrivi un testo per creare un task nel progetto predefinito, /today per vedere le scadenze o /help per tutti i comandi.'
        )
        return
      } catch (error) {
        const message = error instanceof Error && error.message.includes('telegram_chat_id')
          ? 'Questo account Telegram è già collegato a un altro utente TaskFlow.'
          : 'Il collegamento non è riuscito. Genera un nuovo link dalle Impostazioni di TaskFlow.'
        await sendTelegramMessage(chatId, message)
        return
      }
    }
  }

  const user = await loadTelegramUser(admin, chatId)
  if (!user) {
    await sendTelegramMessage(chatId, 'Apri TaskFlow → Impostazioni → Telegram e usa il pulsante “Collega Telegram”.')
    return
  }

  if (command === '/help' || command === '/start') {
    await sendTelegramMessage(
      chatId,
      '<b>Comandi TaskFlow</b>\n\n/today — attività di oggi e arretrate\n/new Titolo — crea un task\n/done ID — completa un task\n\nPuoi anche scrivere direttamente il titolo. Per una scadenza diversa: Titolo | 2026-08-15'
    )
    return
  }

  if (command === '/today') {
    await sendCurrentTasks(admin, user)
    return
  }

  if (command === '/done') {
    const taskId = text.split(/\s+/, 2)[1]
    if (!taskId) {
      await sendTelegramMessage(chatId, 'Usa /done seguito dall’ID del task, oppure premi il pulsante ✅ nel promemoria.')
      return
    }
    const title = await markTaskDone(admin, user.id, taskId)
    await sendTelegramMessage(
      chatId,
      title ? `✅ Completato: <b>${escapeHtml(title)}</b>` : 'Task non disponibile o non assegnato a te.'
    )
    return
  }

  const rawTitle = command === '/new'
    ? text.replace(/^\/new(?:@\w+)?\s*/i, '').trim()
    : text
  const defaults = await loadTelegramDefaults(admin)
  const result = await createTaskFromTelegram(admin, user.id, rawTitle, defaults.timezone)
  if (!result.ok) {
    await sendTelegramMessage(chatId, result.error)
    return
  }
  await sendTelegramMessage(
    chatId,
    `✅ Task creato in <b>${escapeHtml(result.projectName)}</b>\n${escapeHtml(result.task.title)} · scadenza ${result.task.due_date}`
  )
}

export async function dispatchTelegramReminders(admin: SupabaseClient, now = new Date()) {
  const defaults = await loadTelegramDefaults(admin)
  const [{ data: users, error: usersError }, { data: preferences, error: preferencesError }] = await Promise.all([
    admin.from('users')
      .select('id, full_name, telegram_chat_id')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null),
    admin.from('user_notification_preferences')
      .select('user_id, telegram_enabled_override, telegram_time_override, include_overdue_override, telegram_default_project_id, notification_project_ids'),
  ])
  if (usersError) throw new Error(usersError.message)
  if (preferencesError) throw new Error(preferencesError.message)

  const preferenceMap = new Map(
    ((preferences || []) as TelegramPreferenceRow[]).map((item) => [item.user_id, item])
  )
  const current = localDateAndTime(now, defaults.timezone)
  const result = {
    due: 0,
    sent: 0,
    skipped: 0,
    disabled: 0,
    failures: [] as Array<{ userId: string; message: string }>,
  }

  for (const user of (users || []) as TelegramUserRow[]) {
    const effective = mergeTelegramPreferences(defaults, preferenceMap.get(user.id))
    if (!effective.telegram_enabled) {
      result.disabled += 1
      continue
    }
    if (effective.telegram_time !== current.time) continue
    result.due += 1

    const { data: inserted, error: insertError } = await admin
      .from('notification_deliveries')
      .insert({
        user_id: user.id,
        notification_kind: 'telegram_daily',
        delivery_date: current.date,
        scheduled_for: now.toISOString(),
        status: 'preparing',
      })
      .select('id')
      .single()

    let delivery = inserted
    if (insertError?.code === '23505') {
      const { data: existing, error: existingError } = await admin
        .from('notification_deliveries')
        .select('id, status, updated_at')
        .eq('user_id', user.id)
        .eq('notification_kind', 'telegram_daily')
        .eq('delivery_date', current.date)
        .maybeSingle()
      if (existingError || !existing) {
        result.failures.push({ userId: user.id, message: existingError?.message || 'Delivery not found' })
        continue
      }
      const stale = existing.status === 'preparing'
        && new Date(existing.updated_at).getTime() < now.getTime() - 5 * 60 * 1000
      if (existing.status !== 'failed' && !stale) {
        result.skipped += 1
        continue
      }
      const { error: retryError } = await admin.from('notification_deliveries').update({
        status: 'preparing',
        scheduled_for: now.toISOString(),
        error_message: null,
      }).eq('id', existing.id)
      if (retryError) {
        result.failures.push({ userId: user.id, message: retryError.message })
        continue
      }
      delivery = { id: existing.id }
    }
    if (insertError && insertError.code !== '23505' || !delivery) {
      result.failures.push({ userId: user.id, message: insertError?.message || 'Delivery not created' })
      continue
    }

    try {
      const preference = preferenceMap.get(user.id)
      const tasks = await loadReminderTasks(
        admin,
        user.id,
        current.date,
        effective.include_overdue,
        preference?.notification_project_ids || []
      )
      if (tasks.length === 0) {
        await admin.from('notification_deliveries')
          .update({ status: 'skipped', task_count: 0 })
          .eq('id', delivery.id)
        result.skipped += 1
        continue
      }
      const content = buildReminderMessage(user.full_name, tasks, current.date)
      const message = await sendTelegramMessage(
        user.telegram_chat_id,
        content.text,
        content.replyMarkup
      )
      await admin.from('notification_deliveries').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: String(message.message_id),
        task_count: tasks.length,
      }).eq('id', delivery.id)
      result.sent += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Telegram reminder error'
      await admin.from('notification_deliveries').update({
        status: 'failed',
        error_message: message.slice(0, 1000),
      }).eq('id', delivery.id)
      result.failures.push({ userId: user.id, message })
    }
  }

  return result
}

export async function sendTestTelegramReminder(admin: SupabaseClient, userId: string) {
  const [defaults, { data: user, error: userError }, { data: preference, error: preferenceError }] = await Promise.all([
    loadTelegramDefaults(admin),
    admin.from('users')
      .select('id, full_name, telegram_chat_id')
      .eq('id', userId)
      .single(),
    admin.from('user_notification_preferences')
      .select('user_id, telegram_enabled_override, telegram_time_override, include_overdue_override, telegram_default_project_id, notification_project_ids')
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  if (userError || !user?.telegram_chat_id) {
    throw new Error(userError?.message || 'Collega prima Telegram')
  }
  if (preferenceError) throw new Error(preferenceError.message)
  const effective = mergeTelegramPreferences(defaults, preference as TelegramPreferenceRow | null)
  const deliveryDate = localDateAndTime(new Date(), effective.timezone).date
  const tasks = await loadReminderTasks(
    admin,
    userId,
    deliveryDate,
    effective.include_overdue,
    (preference as TelegramPreferenceRow | null)?.notification_project_ids || []
  )
  const content = buildReminderMessage(user.full_name, tasks, deliveryDate, true)
  const message = await sendTelegramMessage(user.telegram_chat_id, content.text, content.replyMarkup)

  await admin.from('notification_deliveries').insert({
    user_id: userId,
    notification_kind: 'telegram_test',
    delivery_date: deliveryDate,
    sent_at: new Date().toISOString(),
    status: 'sent',
    provider_message_id: String(message.message_id),
    task_count: tasks.length,
  })

  return { messageId: message.message_id, taskCount: tasks.length }
}
