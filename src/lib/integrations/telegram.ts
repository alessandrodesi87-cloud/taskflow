import 'server-only'

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensurePersonalInbox } from '@/lib/personalInbox'

const TELEGRAM_API_URL = 'https://api.telegram.org'
const DEFAULT_TIMEZONE = 'Europe/Rome'
const MAX_REMINDER_TASKS = 30
const MAX_DISPLAYED_TASKS = 15
const MAX_ACTION_TASKS = 8
const MAX_PROJECT_BUTTONS = 24
const MAX_TELEGRAM_TITLE_LENGTH = 200
const TELEGRAM_UNDO_WINDOW_MS = 15 * 60 * 1000

const MENU_TODAY = '📅 Oggi'
const MENU_WEEK = '🗓 Settimana'
const MENU_OVERDUE = '⚠️ Scaduti'
const MENU_PROJECTS = '📂 Progetti'
const MENU_HELP = '❓ Aiuto'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

interface TelegramProjectRow {
  id: string
  name: string
  owner_id: string
  is_personal: boolean
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

function addDateDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isValidDateKey(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
}

function formatShortDate(dateKey: string, includeYear = false) {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`)).replace('.', '')
}

function dueDateLabel(dateKey: string, today: string) {
  const includeYear = dateKey.slice(0, 4) !== today.slice(0, 4)
  if (dateKey < today) return `scaduto ${formatShortDate(dateKey, includeYear)}`
  if (dateKey === today) return 'oggi'
  if (dateKey === addDateDays(today, 1)) return 'domani'
  return formatShortDate(dateKey, includeYear)
}

function shortText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

function mainMenuReplyMarkup() {
  return {
    keyboard: [
      [{ text: MENU_TODAY }, { text: MENU_WEEK }],
      [{ text: MENU_OVERDUE }, { text: MENU_PROJECTS }],
      [{ text: MENU_HELP }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Scrivi un task…',
  }
}

function cronoviaDashboardUrl() {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://cronovia.it'
  try {
    return new URL('/dashboard', configuredOrigin).toString()
  } catch {
    return 'https://cronovia.it/dashboard'
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

async function loadTasksForView(
  admin: SupabaseClient,
  userId: string,
  filters: {
    fromDate?: string
    throughDate?: string
    beforeDate?: string
    projectId?: string
    projectIds?: string[]
  }
) {
  let query = admin
    .from('tasks')
    .select('id, title, due_date, priority, owner_id, assignee_id, projects(name)')
    .neq('status', 'done')
    .or(`assignee_id.eq.${userId},and(assignee_id.is.null,owner_id.eq.${userId})`)
    .order('due_date', { ascending: true })
    .limit(MAX_REMINDER_TASKS)

  if (filters.fromDate) query = query.gte('due_date', filters.fromDate)
  if (filters.throughDate) query = query.lte('due_date', filters.throughDate)
  if (filters.beforeDate) query = query.lt('due_date', filters.beforeDate)
  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.projectIds?.length) query = query.in('project_id', filters.projectIds)

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

function taskActionRows(tasks: TelegramTaskRow[], today: string) {
  return tasks.slice(0, MAX_ACTION_TASKS).map((task) => {
    const buttons = [{
      text: `✅ ${shortText(task.title, 22)}`,
      callback_data: `done:${task.id}`,
    }]
    if (task.due_date <= today) {
      buttons.push({
        text: '📅 Domani',
        callback_data: `tomorrow:${task.id}`,
      })
    }
    return buttons
  })
}

function createdTaskReplyMarkup(taskId: string, dueDate: string, today: string) {
  const primaryActions = [{ text: '✅ Completa', callback_data: `done:${taskId}` }]
  if (dueDate <= today) {
    primaryActions.push({ text: '📅 Domani', callback_data: `tomorrow:${taskId}` })
  }
  return {
    inline_keyboard: [
      primaryActions,
      [
        { text: '↩️ Annulla', callback_data: `undo:${taskId}` },
        { text: '🌐 Apri Cronovia', url: cronoviaDashboardUrl() },
      ],
    ],
  }
}

function buildTaskListMessage(
  heading: string,
  tasks: TelegramTaskRow[],
  today: string,
  emptyText: string
) {
  if (tasks.length === 0) {
    return { text: `✅ ${escapeHtml(emptyText)}`, replyMarkup: undefined }
  }

  const visibleTasks = tasks.slice(0, MAX_DISPLAYED_TASKS)
  const rows = visibleTasks.map((task) => (
    `• <b>${escapeHtml(shortText(task.title, 90))}</b>\n  ${escapeHtml(shortText(projectName(task), 55))} · ${dueDateLabel(task.due_date, today)}`
  ))
  const hiddenCount = tasks.length - visibleTasks.length
  const more = hiddenCount > 0 ? `\n\n…e altri ${hiddenCount} task.` : ''

  return {
    text: `<b>${escapeHtml(heading)}</b>\n\n${rows.join('\n\n')}${more}\n\nUsa i pulsanti per completare o spostare a domani.`,
    replyMarkup: { inline_keyboard: taskActionRows(tasks, today) },
  }
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

  const visibleTasks = tasks.slice(0, MAX_DISPLAYED_TASKS)
  const rows = visibleTasks.map((task) => (
    `• <b>${escapeHtml(shortText(task.title, 90))}</b>\n  ${escapeHtml(shortText(projectName(task), 55))} · ${dueDateLabel(task.due_date, deliveryDate)} · priorità ${priorityLabel(task.priority)}`
  ))
  const hiddenCount = tasks.length - visibleTasks.length
  const more = hiddenCount > 0 ? `\n\n…e altri ${hiddenCount} task.` : ''

  return {
    text: `${greeting}\n\n<b>${isTest ? 'Test Cronovia' : 'Cronovia · attività da controllare'}</b>\n\n${rows.join('\n\n')}${more}\n\nPuoi completare o spostare un task con i pulsanti.`,
    replyMarkup: { inline_keyboard: taskActionRows(tasks, deliveryDate) },
  }
}

async function markTaskDone(admin: SupabaseClient, userId: string, taskId: string) {
  if (!isUuid(taskId)) return null
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
    const { data: updated, error: updateError } = await admin
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', task.id)
      .or(`assignee_id.eq.${userId},and(assignee_id.is.null,owner_id.eq.${userId})`)
      .select('id')
      .maybeSingle()
    if (updateError) throw new Error(updateError.message)
    if (!updated) return null
  }
  return task.title as string
}

async function postponeTaskToTomorrow(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  timezone: string
) {
  if (!isUuid(taskId)) return null
  const { data: task, error } = await admin
    .from('tasks')
    .select('id, title, start_date, owner_id, assignee_id, status')
    .eq('id', taskId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!task || task.status === 'done') return null
  const authorized = task.assignee_id === userId
    || (!task.assignee_id && task.owner_id === userId)
  if (!authorized) return null

  const today = localDateAndTime(new Date(), timezone).date
  const tomorrow = addDateDays(today, 1)
  const update: { due_date: string; start_date?: string; updated_at: string } = {
    due_date: tomorrow,
    updated_at: new Date().toISOString(),
  }
  if (task.start_date > tomorrow) update.start_date = tomorrow

  const { data: updated, error: updateError } = await admin
    .from('tasks')
    .update(update)
    .eq('id', task.id)
    .neq('status', 'done')
    .or(`assignee_id.eq.${userId},and(assignee_id.is.null,owner_id.eq.${userId})`)
    .select('id')
    .maybeSingle()
  if (updateError) throw new Error(updateError.message)
  if (!updated) return null
  return { title: task.title as string, dueDate: tomorrow }
}

async function undoTelegramTask(admin: SupabaseClient, userId: string, taskId: string) {
  if (!isUuid(taskId)) return null
  const { data: task, error } = await admin
    .from('tasks')
    .select('id, title, owner_id, creator_id, status, created_at')
    .eq('id', taskId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!task || task.owner_id !== userId || task.creator_id !== userId || task.status !== 'todo') {
    return null
  }
  const createdAt = new Date(task.created_at).getTime()
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > TELEGRAM_UNDO_WINDOW_MS) {
    return null
  }

  const { data: deleted, error: deleteError } = await admin
    .from('tasks')
    .delete()
    .eq('id', task.id)
    .eq('owner_id', userId)
    .eq('creator_id', userId)
    .eq('status', 'todo')
    .select('title')
    .maybeSingle()
  if (deleteError) throw new Error(deleteError.message)
  return (deleted?.title as string | undefined) || null
}

async function canUseProject(admin: SupabaseClient, userId: string, projectId: string) {
  if (!isUuid(projectId)) return null
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

async function loadAccessibleProjects(admin: SupabaseClient, userId: string) {
  const [{ data: owned, error: ownedError }, { data: memberships, error: membershipsError }] = await Promise.all([
    admin.from('projects')
      .select('id, name, owner_id, is_personal')
      .eq('owner_id', userId)
      .order('name', { ascending: true }),
    admin.from('project_members')
      .select('projects(id, name, owner_id, is_personal)')
      .eq('user_id', userId),
  ])
  if (ownedError) throw new Error(ownedError.message)
  if (membershipsError) throw new Error(membershipsError.message)

  const projects = new Map<string, TelegramProjectRow>()
  for (const project of (owned || []) as TelegramProjectRow[]) projects.set(project.id, project)
  for (const membership of memberships || []) {
    const related = membership.projects
    const project = (Array.isArray(related) ? related[0] : related) as TelegramProjectRow | null
    if (project) projects.set(project.id, project)
  }
  return [...projects.values()].sort((first, second) => {
    if (first.is_personal !== second.is_personal) return first.is_personal ? -1 : 1
    return first.name.localeCompare(second.name, 'it')
  })
}

function parseTelegramTaskInput(rawText: string, today: string) {
  const separatorIndex = rawText.lastIndexOf('|')
  const title = (separatorIndex >= 0 ? rawText.slice(0, separatorIndex) : rawText).trim()
  const rawDate = separatorIndex >= 0 ? rawText.slice(separatorIndex + 1).trim().toLowerCase() : ''

  if (!title) {
    return { ok: false as const, error: 'Scrivi il titolo del task. Esempio: Preparare preventivo' }
  }
  if (title.length > MAX_TELEGRAM_TITLE_LENGTH) {
    return { ok: false as const, error: `Il titolo può contenere al massimo ${MAX_TELEGRAM_TITLE_LENGTH} caratteri.` }
  }

  let dueDate = today
  if (rawDate === 'oggi' || rawDate === '') {
    dueDate = today
  } else if (rawDate === 'domani') {
    dueDate = addDateDays(today, 1)
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    dueDate = rawDate
  } else {
    const italianDate = rawDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/)
    if (!italianDate) {
      return { ok: false as const, error: 'Data non riconosciuta. Usa oggi, domani, GG/MM oppure AAAA-MM-GG.' }
    }
    const [, day, month, explicitYear] = italianDate
    let year = Number(explicitYear || today.slice(0, 4))
    dueDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    if (!explicitYear && isValidDateKey(dueDate) && dueDate < today) {
      year += 1
      dueDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
  }

  if (!isValidDateKey(dueDate)) {
    return { ok: false as const, error: 'La data non è valida. Usa oggi, domani, GG/MM oppure AAAA-MM-GG.' }
  }
  return { ok: true as const, title, dueDate }
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
  const today = localDateAndTime(new Date(), timezone).date
  const parsed = parseTelegramTaskInput(rawText, today)
  if (!parsed.ok) return parsed

  let project = preference?.telegram_default_project_id
    ? await canUseProject(admin, userId, preference.telegram_default_project_id)
    : null
  if (!project) {
    const inbox = await ensurePersonalInbox(admin, userId)
    project = await canUseProject(admin, userId, inbox.id)
  }
  if (!project) return { ok: false, error: 'Non riesco ad accedere al progetto personale. Riprova tra poco.' }

  const { data: task, error } = await admin.from('tasks').insert({
    project_id: project.id,
    title: parsed.title,
    start_date: parsed.dueDate < today ? parsed.dueDate : today,
    due_date: parsed.dueDate,
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
  const today = localDateAndTime(new Date(), effective.timezone).date
  const tasks = await loadTasksForView(admin, user.id, {
    fromDate: today,
    throughDate: today,
    projectIds: (preference as TelegramPreferenceRow | null)?.notification_project_ids || [],
  })
  const content = buildTaskListMessage('Cronovia · oggi', tasks, today, 'Nessun task in scadenza oggi.')
  await sendTelegramMessage(user.telegram_chat_id, content.text, content.replyMarkup)
}

async function sendWeekTasks(admin: SupabaseClient, user: TelegramUserRow) {
  const [defaults, { data: preference, error: preferenceError }] = await Promise.all([
    loadTelegramDefaults(admin),
    admin.from('user_notification_preferences')
      .select('notification_project_ids')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (preferenceError) throw new Error(preferenceError.message)
  const today = localDateAndTime(new Date(), defaults.timezone).date
  const throughDate = addDateDays(today, 6)
  const tasks = await loadTasksForView(admin, user.id, {
    fromDate: today,
    throughDate,
    projectIds: (preference?.notification_project_ids as string[] | null) || [],
  })
  const content = buildTaskListMessage(
    `Cronovia · prossimi 7 giorni (${formatShortDate(today)}–${formatShortDate(throughDate)})`,
    tasks,
    today,
    'Nessun task nei prossimi 7 giorni.'
  )
  await sendTelegramMessage(user.telegram_chat_id, content.text, content.replyMarkup)
}

async function sendOverdueTasks(admin: SupabaseClient, user: TelegramUserRow) {
  const [defaults, { data: preference, error: preferenceError }] = await Promise.all([
    loadTelegramDefaults(admin),
    admin.from('user_notification_preferences')
      .select('notification_project_ids')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (preferenceError) throw new Error(preferenceError.message)
  const today = localDateAndTime(new Date(), defaults.timezone).date
  const tasks = await loadTasksForView(admin, user.id, {
    beforeDate: today,
    projectIds: (preference?.notification_project_ids as string[] | null) || [],
  })
  const content = buildTaskListMessage('Cronovia · scaduti', tasks, today, 'Nessun task scaduto.')
  await sendTelegramMessage(user.telegram_chat_id, content.text, content.replyMarkup)
}

async function sendProjectsMenu(admin: SupabaseClient, user: TelegramUserRow) {
  const projects = await loadAccessibleProjects(admin, user.id)
  const visibleProjects = projects.slice(0, MAX_PROJECT_BUTTONS)
  const buttons: Array<Array<Record<string, string>>> = visibleProjects.map((project) => ([{
    text: `${project.is_personal ? '📥' : '📁'} ${shortText(project.name, 48)}`,
    callback_data: `project:${project.id}`,
  }]))
  buttons.push([{ text: '🌐 Apri Cronovia', url: cronoviaDashboardUrl() }])
  const more = projects.length > visibleProjects.length
    ? `\n\nMostro i primi ${MAX_PROJECT_BUTTONS} progetti.`
    : ''
  await sendTelegramMessage(
    user.telegram_chat_id,
    `<b>I tuoi progetti</b>\n\nScegline uno per vedere i task aperti.${more}`,
    { inline_keyboard: buttons }
  )
}

async function sendProjectTasks(
  admin: SupabaseClient,
  user: TelegramUserRow,
  projectId: string
) {
  const project = await canUseProject(admin, user.id, projectId)
  if (!project) return false
  const defaults = await loadTelegramDefaults(admin)
  const today = localDateAndTime(new Date(), defaults.timezone).date
  const tasks = await loadTasksForView(admin, user.id, { projectId })
  const content = buildTaskListMessage(
    `Progetto · ${project.name as string}`,
    tasks,
    today,
    `Nessun task aperto in ${project.name as string}.`
  )
  await sendTelegramMessage(user.telegram_chat_id, content.text, content.replyMarkup)
  return true
}

async function sendTelegramHelp(chatId: string) {
  await sendTelegramMessage(
    chatId,
    '<b>Cronovia rapido</b>\n\nScrivi un messaggio e creo subito un task nel progetto predefinito.\n\nPer scegliere la scadenza:\n• Chiamare il cliente | domani\n• Inviare preventivo | 15/09\n\nDai pulsanti puoi controllare oggi, settimana, scaduti e progetti. Dopo la creazione puoi completare, spostare a domani o annullare.',
    mainMenuReplyMarkup()
  )
}

export async function processTelegramUpdate(admin: SupabaseClient, update: TelegramUpdate) {
  const callback = update.callback_query
  const chatId = String(callback?.message?.chat.id ?? update.message?.chat.id ?? '')
  if (!chatId) return

  if (callback) {
    const user = await loadTelegramUser(admin, chatId)
    if (!user) {
      await answerCallbackQuery(callback.id, 'Collega prima Telegram da Cronovia.')
      return
    }

    if (callback.data?.startsWith('done:')) {
      const title = await markTaskDone(admin, user.id, callback.data.slice(5))
      await answerCallbackQuery(
        callback.id,
        title ? `Completato: ${shortText(title, 160)}` : 'Task non disponibile.'
      )
      return
    }

    if (callback.data?.startsWith('tomorrow:')) {
      const defaults = await loadTelegramDefaults(admin)
      const result = await postponeTaskToTomorrow(
        admin,
        user.id,
        callback.data.slice('tomorrow:'.length),
        defaults.timezone
      )
      await answerCallbackQuery(
        callback.id,
        result ? `Spostato a domani: ${shortText(result.title, 150)}` : 'Task non disponibile.'
      )
      return
    }

    if (callback.data?.startsWith('undo:')) {
      const title = await undoTelegramTask(admin, user.id, callback.data.slice(5))
      await answerCallbackQuery(
        callback.id,
        title ? `Annullato: ${shortText(title, 165)}` : 'Non è più possibile annullare questo task.'
      )
      return
    }

    if (callback.data?.startsWith('project:')) {
      await answerCallbackQuery(callback.id, 'Apro il progetto…')
      const sent = await sendProjectTasks(admin, user, callback.data.slice(8))
      if (!sent) {
        await sendTelegramMessage(chatId, 'Il progetto non è disponibile.')
      }
      return
    }

    await answerCallbackQuery(callback.id, 'Azione non disponibile.')
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
          await sendTelegramMessage(chatId, 'Questo collegamento è scaduto o è già stato usato. Generane uno nuovo nelle Impostazioni di Cronovia.')
          return
        }
        await sendTelegramMessage(
          chatId,
          '<b>Telegram è collegato a Cronovia.</b>\n\nScrivi un messaggio e creo subito un task. Usa i pulsanti per controllare la situazione.',
          mainMenuReplyMarkup()
        )
        return
      } catch (error) {
        const message = error instanceof Error && error.message.includes('telegram_chat_id')
          ? 'Questo account Telegram è già collegato a un altro utente Cronovia.'
          : 'Il collegamento non è riuscito. Genera un nuovo link dalle Impostazioni di Cronovia.'
        await sendTelegramMessage(chatId, message)
        return
      }
    }
  }

  const user = await loadTelegramUser(admin, chatId)
  if (!user) {
    await sendTelegramMessage(chatId, 'Apri Cronovia → Impostazioni → Telegram e usa il pulsante “Collega Telegram”.')
    return
  }

  if (command === '/help' || command === '/start' || command === '/menu' || text === MENU_HELP) {
    await sendTelegramHelp(chatId)
    return
  }

  if (command === '/today' || text === MENU_TODAY) {
    await sendCurrentTasks(admin, user)
    return
  }

  if (command === '/week' || text === MENU_WEEK) {
    await sendWeekTasks(admin, user)
    return
  }

  if (command === '/overdue' || text === MENU_OVERDUE) {
    await sendOverdueTasks(admin, user)
    return
  }

  if (command === '/projects' || text === MENU_PROJECTS) {
    await sendProjectsMenu(admin, user)
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

  if (command.startsWith('/') && command !== '/new') {
    await sendTelegramMessage(chatId, 'Comando non riconosciuto. Usa il menu oppure scrivi direttamente il titolo del task.', mainMenuReplyMarkup())
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
  const today = localDateAndTime(new Date(), defaults.timezone).date
  await sendTelegramMessage(
    chatId,
    `✅ Task creato in <b>${escapeHtml(result.projectName)}</b>\n<b>${escapeHtml(result.task.title)}</b> · ${dueDateLabel(result.task.due_date, today)}`,
    createdTaskReplyMarkup(result.task.id, result.task.due_date, today)
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
