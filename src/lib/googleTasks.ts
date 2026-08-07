import 'server-only'

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_TASKS_URL = 'https://tasks.googleapis.com/tasks/v1'
const OAUTH_STATE_TTL_SECONDS = 10 * 60

export const GOOGLE_OAUTH_COOKIE = 'taskflow_google_oauth_nonce'

interface OAuthStatePayload {
  userId: string
  nonce: string
  redirectUri: string
  expiresAt: number
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface GoogleTaskList {
  id: string
  title: string
}

interface GoogleTask {
  id: string
  title?: string
  notes?: string
  due?: string
  status?: string
}

interface GoogleAccount {
  id: string
  user_id: string
  email: string
  access_token: string | null
  refresh_token: string | null
  default_project_id: string | null
}

interface GooglePage<T> {
  items?: T[]
  nextPageToken?: string
}

export interface GoogleSyncResult {
  accounts: number
  imported: number
  completedInGoogle: number
  skipped: number
  failures: Array<{ email: string; message: string }>
}

function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth non è configurato')
  }

  return { clientId, clientSecret }
}

function toBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function signState(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

export function createGoogleAuthorization(userId: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleCredentials()
  const nonce = randomBytes(32).toString('base64url')
  const payload: OAuthStatePayload = {
    userId,
    nonce,
    redirectUri,
    expiresAt: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const state = `${encodedPayload}.${signState(encodedPayload, clientSecret)}`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/tasks',
    ].join(' '),
    state,
  })

  return {
    authorizationUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    nonce,
    maxAge: OAUTH_STATE_TTL_SECONDS,
  }
}

export function verifyGoogleOAuthState(state: string, cookieNonce: string | undefined) {
  const { clientSecret } = getGoogleCredentials()
  const [encodedPayload, receivedSignature, ...rest] = state.split('.')

  if (!encodedPayload || !receivedSignature || rest.length > 0 || !cookieNonce) {
    throw new Error('Collegamento Google non valido o scaduto')
  }

  const expectedSignature = signState(encodedPayload, clientSecret)
  const expectedBuffer = Buffer.from(expectedSignature)
  const receivedBuffer = Buffer.from(receivedSignature)

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error('Collegamento Google non valido o scaduto')
  }

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthStatePayload
  } catch {
    throw new Error('Collegamento Google non valido o scaduto')
  }

  if (
    !payload.userId ||
    !payload.redirectUri ||
    payload.nonce !== cookieNonce ||
    payload.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error('Collegamento Google non valido o scaduto')
  }

  return payload
}

async function parseGoogleResponse<T>(response: Response, fallbackMessage: string) {
  const body = await response.json().catch(() => null) as T | GoogleTokenResponse | null

  if (!response.ok) {
    const tokenError = body as GoogleTokenResponse | null
    throw new Error(tokenError?.error_description || tokenError?.error || fallbackMessage)
  }

  return body as T
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleCredentials()
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  const tokens = await parseGoogleResponse<GoogleTokenResponse>(
    response,
    'Google non ha accettato il codice di collegamento',
  )

  if (!tokens.access_token) {
    throw new Error('Google non ha restituito un token di accesso')
  }

  return tokens
}

export async function getGoogleAccountEmail(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const profile = await parseGoogleResponse<{ email?: string }>(
    response,
    'Impossibile leggere il profilo Google',
  )

  if (!profile.email) {
    throw new Error('L’account Google non ha restituito un indirizzo email')
  }

  return profile.email.toLowerCase()
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleCredentials()
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const tokens = await parseGoogleResponse<GoogleTokenResponse>(
    response,
    'Il collegamento Google deve essere rinnovato',
  )

  if (!tokens.access_token) {
    throw new Error('Il collegamento Google deve essere rinnovato')
  }

  return tokens.access_token
}

async function googleFetch<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`${GOOGLE_TASKS_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (response.status === 204) {
    return null as T
  }

  return parseGoogleResponse<T>(response, 'Google Tasks non è raggiungibile')
}

async function listAllGooglePages<T>(
  path: string,
  accessToken: string,
  extraParams?: Record<string, string>,
) {
  const items: T[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({ maxResults: '100', ...extraParams })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await googleFetch<GooglePage<T>>(`${path}?${params.toString()}`, accessToken)
    items.push(...(page.items || []))
    pageToken = page.nextPageToken
  } while (pageToken)

  return items
}

async function canUseProject(admin: SupabaseClient, userId: string, projectId: string) {
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError || !project) return false
  if (project.owner_id === userId) return true

  const { data: membership, error: membershipError } = await admin
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  return !membershipError && Boolean(membership)
}

export async function userCanUseProject(
  admin: SupabaseClient,
  userId: string,
  projectId: string,
) {
  return canUseProject(admin, userId, projectId)
}

function deterministicTaskId(externalId: string) {
  const bytes = createHash('sha256').update(externalId).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function googleTaskDate(task: GoogleTask) {
  const dueDate = task.due?.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')
    ? dueDate as string
    : new Date().toISOString().slice(0, 10)
}

async function markGoogleTaskCompleted(
  taskListId: string,
  taskId: string,
  accessToken: string,
) {
  await googleFetch(
    `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) },
  )
}

async function syncGoogleAccount(admin: SupabaseClient, account: GoogleAccount) {
  if (!account.default_project_id) {
    throw new Error('Scegli prima il progetto di destinazione')
  }

  if (!(await canUseProject(admin, account.user_id, account.default_project_id))) {
    throw new Error('Il progetto di destinazione non è più accessibile')
  }

  let accessToken = account.access_token
  if (account.refresh_token) {
    accessToken = await refreshGoogleAccessToken(account.refresh_token)
    const { error } = await admin
      .from('gmail_accounts')
      .update({ access_token: accessToken })
      .eq('id', account.id)
      .eq('user_id', account.user_id)
    if (error) throw new Error('Impossibile aggiornare il collegamento Google')
  }

  if (!accessToken) {
    throw new Error('Il collegamento Google deve essere rinnovato')
  }

  const taskLists = await listAllGooglePages<GoogleTaskList>('/users/@me/lists', accessToken)
  let imported = 0
  let completedInGoogle = 0
  let skipped = 0

  for (const taskList of taskLists) {
    const tasks = await listAllGooglePages<GoogleTask>(
      `/lists/${encodeURIComponent(taskList.id)}/tasks`,
      accessToken,
      { showCompleted: 'false', showDeleted: 'false', showHidden: 'false' },
    )

    for (const task of tasks) {
      if (!task.id || task.status === 'completed') continue

      const externalId = `google:${account.id}:${taskList.id}:${task.id}`
      const localTaskId = deterministicTaskId(externalId)
      const date = googleTaskDate(task)
      const { data: existing, error: existingError } = await admin
        .from('tasks')
        .select('id')
        .eq('id', localTaskId)
        .maybeSingle()

      if (existingError) throw new Error('Impossibile verificare i task già importati')

      if (!existing) {
        const description = [
          task.notes?.trim(),
          `Importato da Google Tasks · Lista: ${taskList.title}`,
        ].filter(Boolean).join('\n\n')
        const { error: insertError } = await admin.from('tasks').insert({
          id: localTaskId,
          project_id: account.default_project_id,
          title: task.title?.trim() || 'Task Google senza titolo',
          description,
          owner_id: account.user_id,
          creator_id: account.user_id,
          start_date: date,
          due_date: date,
          status: 'todo',
          priority: 'medium',
          tags: ['google-tasks'],
          google_task_id: externalId,
        })

        if (insertError && insertError.code !== '23505') {
          throw new Error('Impossibile importare un task da Google')
        }
        if (insertError?.code === '23505') skipped += 1
        else imported += 1
      } else {
        skipped += 1
      }

      await markGoogleTaskCompleted(taskList.id, task.id, accessToken)
      completedInGoogle += 1
    }
  }

  return { imported, completedInGoogle, skipped }
}

export async function syncGoogleTasks(
  admin: SupabaseClient,
  userId?: string,
): Promise<GoogleSyncResult> {
  let query = admin
    .from('gmail_accounts')
    .select('id, user_id, email, access_token, refresh_token, default_project_id')
  if (userId) query = query.eq('user_id', userId)

  const { data, error } = await query
  if (error) throw new Error('Impossibile leggere gli account Google collegati')

  const accounts = (data || []) as GoogleAccount[]
  const result: GoogleSyncResult = {
    accounts: accounts.length,
    imported: 0,
    completedInGoogle: 0,
    skipped: 0,
    failures: [],
  }

  for (const account of accounts) {
    try {
      const accountResult = await syncGoogleAccount(admin, account)
      result.imported += accountResult.imported
      result.completedInGoogle += accountResult.completedInGoogle
      result.skipped += accountResult.skipped
    } catch (error) {
      result.failures.push({
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore di sincronizzazione',
      })
    }
  }

  return result
}

export async function revokeGoogleToken(token: string | null) {
  if (!token) return
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined)
}
