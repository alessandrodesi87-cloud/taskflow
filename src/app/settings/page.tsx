'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/types'

interface GoogleAccountView {
  id: string
  email: string
  default_project_id: string | null
  connected_at: string
}

interface SyncResult {
  accounts: number
  imported: number
  completedInGoogle: number
  skipped: number
  failures: Array<{ email: string; message: string }>
}

interface NotificationPreferencesView {
  defaults: {
    email_enabled: boolean
    email_time: string
    timezone: string
    include_overdue: boolean
  }
  overrides: {
    email_enabled: boolean | null
    email_time: string | null
    include_overdue: boolean | null
  }
  effective: {
    email_enabled: boolean
    email_time: string
    timezone: string
    include_overdue: boolean
  }
  using_defaults: boolean
  replies_enabled: boolean
  deliveries: Array<{
    id: string
    notification_kind: 'daily_digest' | 'test'
    delivery_date: string
    scheduled_for: string | null
    sent_at: string | null
    status: string
    task_count: number
    created_at: string
  }>
}

async function authenticatedFetch(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sessione scaduta. Accedi di nuovo.')

  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(body.error || 'Operazione non riuscita')
  return body
}

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<GoogleAccountView[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [notifications, setNotifications] = useState<NotificationPreferencesView | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace('/auth/login')
      return
    }

    const [projectsResult, accountsResult, notificationsResult] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, description, owner_id, start_date, end_date, color, created_at')
        .order('start_date', { ascending: true }),
      authenticatedFetch('/api/google/accounts'),
      authenticatedFetch('/api/notifications/preferences'),
    ])

    if (projectsResult.error) throw new Error('Impossibile leggere i progetti')
    setProjects((projectsResult.data || []) as Project[])
    setAccounts(accountsResult as GoogleAccountView[])
    setNotifications(notificationsResult as NotificationPreferencesView)
  }, [router])

  useEffect(() => {
    const googleResult = new URLSearchParams(window.location.search).get('google')
    if (googleResult === 'connected') {
      setMessage({ type: 'success', text: 'Account Google collegato correttamente.' })
      window.history.replaceState({}, '', '/settings')
    } else if (googleResult === 'error') {
      setMessage({
        type: 'error',
        text: 'Il collegamento Google non è riuscito. Puoi riprovare tra poco.',
      })
      window.history.replaceState({}, '', '/settings')
    }

    loadData()
      .catch((error) => setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Caricamento non riuscito',
      }))
      .finally(() => setLoading(false))
  }, [loadData])

  const connectGoogle = async () => {
    setWorking('connect')
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/google/connect', { method: 'POST' }) as { url: string }
      window.location.assign(result.url)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Collegamento non riuscito' })
      setWorking(null)
    }
  }

  const selectProject = async (accountId: string, projectId: string) => {
    setWorking(accountId)
    setMessage(null)
    try {
      const updated = await authenticatedFetch('/api/google/accounts', {
        method: 'PATCH',
        body: JSON.stringify({ accountId, projectId: projectId || null }),
      }) as GoogleAccountView
      setAccounts((current) => current.map((account) => (
        account.id === accountId ? updated : account
      )))
      setMessage({ type: 'success', text: 'Progetto di destinazione aggiornato.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Aggiornamento non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const disconnectGoogle = async (account: GoogleAccountView) => {
    if (!window.confirm(`Vuoi scollegare ${account.email} da TaskFlow?`)) return

    setWorking(account.id)
    setMessage(null)
    try {
      await authenticatedFetch('/api/google/accounts', {
        method: 'DELETE',
        body: JSON.stringify({ accountId: account.id }),
      })
      setAccounts((current) => current.filter((item) => item.id !== account.id))
      setMessage({ type: 'success', text: 'Account Google scollegato.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Scollegamento non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const syncNow = async () => {
    setWorking('sync')
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/google/sync', { method: 'POST' }) as SyncResult
      if (result.failures.length > 0) {
        setMessage({
          type: 'error',
          text: result.failures.map((failure) => `${failure.email}: ${failure.message}`).join(' · '),
        })
      } else if (result.accounts === 0) {
        setMessage({ type: 'error', text: 'Collega prima almeno un account Google.' })
      } else {
        setMessage({
          type: 'success',
          text: result.imported > 0
            ? `${result.imported} task importati in TaskFlow.`
            : 'Sincronizzazione completata: nessun nuovo task da importare.',
        })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Sincronizzazione non riuscita' })
    } finally {
      setWorking(null)
    }
  }

  const saveNotifications = async () => {
    if (!notifications) return

    setWorking('notifications-save')
    setMessage(null)
    try {
      await authenticatedFetch('/api/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify(notifications.using_defaults ? {
          use_defaults: true,
        } : {
          use_defaults: false,
          email_enabled: notifications.effective.email_enabled,
          email_time: notifications.effective.email_time,
          include_overdue: notifications.effective.include_overdue,
        }),
      })
      const refreshed = await authenticatedFetch('/api/notifications/preferences') as NotificationPreferencesView
      setNotifications(refreshed)
      setMessage({ type: 'success', text: 'Preferenze email salvate.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Salvataggio non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const sendTestEmail = async () => {
    setWorking('notifications-test')
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/notifications/test', { method: 'POST' }) as { task_count: number }
      setMessage({
        type: 'success',
        text: `Email di prova inviata. Contiene ${result.task_count} task da controllare.`,
      })
      const refreshed = await authenticatedFetch('/api/notifications/preferences') as NotificationPreferencesView
      setNotifications(refreshed)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Invio di prova non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Caricamento...</div>
  }

  const canSync = accounts.length > 0 && accounts.every((account) => account.default_project_id)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="text-2xl font-bold text-blue-600">TaskFlow</Link>
          <Link href="/dashboard" className="text-sm font-medium text-gray-600 hover:text-blue-600">
            ← Torna ai progetti
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-600">Fase 2</p>
          <h1 className="text-3xl font-bold text-gray-900">Integrazioni</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Collega Google Tasks e scegli in quale progetto TaskFlow importare le attività.
          </p>
        </div>

        {message && (
          <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {notifications && (
          <section className="mb-8 overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-100 bg-blue-50 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">La tua giornata</p>
                  <h2 className="mt-1 text-xl font-semibold text-gray-900">Promemoria email</h2>
                  <p className="mt-2 max-w-2xl text-sm text-gray-600">
                    Ricevi al mattino i task in scadenza e, se vuoi, anche quelli arretrati.
                  </p>
                </div>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                  notifications.effective.email_enabled
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {notifications.effective.email_enabled
                    ? `Attivo alle ${notifications.effective.email_time}`
                    : 'Disattivato'}
                </span>
              </div>
            </div>

            <div className="space-y-5 p-6">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-4">
                <input
                  type="checkbox"
                  checked={notifications.using_defaults}
                  onChange={(event) => setNotifications((current) => current ? ({
                    ...current,
                    using_defaults: event.target.checked,
                    effective: event.target.checked ? { ...current.defaults } : current.effective,
                  }) : current)}
                  className="mt-0.5 h-5 w-5 rounded border-gray-300 text-blue-600"
                />
                <span>
                  <span className="block font-semibold text-gray-900">Usa le impostazioni consigliate dall’admin</span>
                  <span className="mt-1 block text-sm text-gray-500">
                    Attualmente: {notifications.defaults.email_enabled ? 'attivo' : 'disattivato'} alle {notifications.defaults.email_time}
                    {notifications.defaults.include_overdue ? ', arretrati inclusi' : ', solo scadenze di oggi'}.
                  </span>
                </span>
              </label>

              {!notifications.using_defaults && (
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                    <input
                      type="checkbox"
                      checked={notifications.effective.email_enabled}
                      onChange={(event) => setNotifications((current) => current ? ({
                        ...current,
                        effective: { ...current.effective, email_enabled: event.target.checked },
                      }) : current)}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600"
                    />
                    <span className="font-semibold text-gray-900">Ricevi email</span>
                  </label>

                  <label className="block rounded-lg border border-gray-200 p-4">
                    <span className="block text-sm font-semibold text-gray-900">Il tuo orario</span>
                    <input
                      type="time"
                      min="07:00"
                      max="22:00"
                      value={notifications.effective.email_time}
                      onChange={(event) => setNotifications((current) => current ? ({
                        ...current,
                        effective: { ...current.effective, email_time: event.target.value },
                      }) : current)}
                      disabled={!notifications.effective.email_enabled}
                      className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                    />
                    <span className="mt-1 block text-xs text-gray-500">Ora italiana · 07:00–22:00</span>
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                    <input
                      type="checkbox"
                      checked={notifications.effective.include_overdue}
                      onChange={(event) => setNotifications((current) => current ? ({
                        ...current,
                        effective: { ...current.effective, include_overdue: event.target.checked },
                      }) : current)}
                      disabled={!notifications.effective.email_enabled}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 disabled:opacity-50"
                    />
                    <span>
                      <span className="block font-semibold text-gray-900">Includi arretrati</span>
                      <span className="block text-xs text-gray-500">Anche task già scaduti</span>
                    </span>
                  </label>
                </div>
              )}

              <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                Le email riguardano i task assegnati a te; se un task non ha assegnatario, viene incluso quando ne sei il proprietario.
                {notifications.replies_enabled
                  ? ' Puoi anche rispondere all’email per completare o riprogrammare un task.'
                  : ''}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500">
                Le modifiche valgono dal prossimo promemoria. Il test viene inviato subito.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={sendTestEmail}
                  disabled={working !== null}
                  className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  {working === 'notifications-test' ? 'Invio...' : 'Invia email di prova'}
                </button>
                <button
                  type="button"
                  onClick={saveNotifications}
                  disabled={working !== null}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {working === 'notifications-save' ? 'Salvataggio...' : 'Salva preferenze'}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Google Tasks</h2>
              <p className="mt-1 text-sm text-gray-500">
                I token Google sono conservati in modo protetto e non vengono inviati al browser.
              </p>
            </div>
            <button
              type="button"
              onClick={connectGoogle}
              disabled={working !== null}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working === 'connect' ? 'Collegamento...' : '+ Collega account Google'}
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                Nessun account Google collegato.
              </div>
            ) : accounts.map((account) => (
              <div key={account.id} className="grid gap-4 p-6 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Account</p>
                  <p className="mt-1 font-medium text-gray-900">{account.email}</p>
                </div>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Progetto di destinazione
                  </span>
                  <select
                    value={account.default_project_id || ''}
                    onChange={(event) => selectProject(account.id, event.target.value)}
                    disabled={working !== null}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Scegli un progetto</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => disconnectGoogle(account)}
                  disabled={working !== null}
                  className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Scollega
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 bg-gray-50 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-600">
              La sincronizzazione automatica viene eseguita ogni mattina.
            </p>
            <button
              type="button"
              onClick={syncNow}
              disabled={working !== null || !canSync}
              title={!canSync ? 'Scegli un progetto per ogni account collegato' : undefined}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working === 'sync' ? 'Sincronizzazione...' : 'Sincronizza adesso'}
            </button>
          </div>
        </section>

        {projects.length === 0 && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Prima di sincronizzare crea almeno un progetto dalla dashboard.
          </div>
        )}
      </main>
    </div>
  )
}
