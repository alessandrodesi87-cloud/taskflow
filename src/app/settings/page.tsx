'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/types'
import AppHeader from '@/components/AppHeader'

interface GoogleAccountView {
  id: string
  email: string
  default_project_id: string | null
  connected_at: string
  last_sync_at: string | null
  last_sync_status: 'success' | 'error' | null
  last_sync_error: string | null
}

interface SyncResult {
  accounts: number
  imported: number
  completedInGoogle: number
  skipped: number
  failures: Array<{ email: string; message: string }>
}

interface TelegramConnectView {
  url: string
  app_url: string
  web_url: string
  bot_username: string
  start_command: string
  expires_at: string
}

interface NotificationPreferencesView {
  defaults: {
    email_enabled: boolean
    email_time: string
    telegram_enabled: boolean
    telegram_time: string
    timezone: string
    include_overdue: boolean
  }
  overrides: {
    email_enabled: boolean | null
    email_time: string | null
    telegram_enabled: boolean | null
    telegram_time: string | null
    include_overdue: boolean | null
    telegram_default_project_id: string | null
    notification_project_ids: string[]
  }
  effective: {
    email_enabled: boolean
    email_time: string
    telegram_enabled: boolean
    telegram_time: string
    timezone: string
    include_overdue: boolean
  }
  using_defaults: boolean
  replies_enabled: boolean
  telegram_connected: boolean
  telegram_configured: boolean
  deliveries: Array<{
    id: string
    notification_kind: 'daily_digest' | 'test' | 'telegram_daily' | 'telegram_test'
    delivery_date: string
    scheduled_for: string | null
    sent_at: string | null
    status: string
    task_count: number
    created_at: string
  }>
}

interface ProfileView {
  id: string
  email?: string | null
  full_name?: string | null
  phone?: string | null
  role: 'admin' | 'member'
  is_active: boolean
  created_at: string
}

type SettingsSection = 'profile' | 'notifications' | 'integrations'

function formatDateTime(value: string | null) {
  if (!value) return 'Mai sincronizzato'
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
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
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [section, setSection] = useState<SettingsSection>('notifications')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [telegramLink, setTelegramLink] = useState<TelegramConnectView | null>(null)
  const router = useRouter()

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace('/auth/login')
      return
    }

    const [projectsResult, accountsResult, notificationsResult, profileResult] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, description, owner_id, start_date, end_date, color, created_at')
        .order('start_date', { ascending: true }),
      authenticatedFetch('/api/google/accounts'),
      authenticatedFetch('/api/notifications/preferences'),
      authenticatedFetch('/api/profile'),
    ])

    if (projectsResult.error) throw new Error('Impossibile leggere i progetti')
    setProjects((projectsResult.data || []) as Project[])
    setAccounts(accountsResult as GoogleAccountView[])
    setNotifications(notificationsResult as NotificationPreferencesView)
    setProfile((profileResult as { profile: ProfileView }).profile)
  }, [router])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedSection = params.get('section')
    if (requestedSection === 'profile' || requestedSection === 'notifications' || requestedSection === 'integrations') {
      setSection(requestedSection)
    }
    const googleResult = params.get('google')
    if (googleResult === 'connected') {
      setSection('integrations')
      setMessage({ type: 'success', text: 'Account Google collegato correttamente.' })
      window.history.replaceState({}, '', '/settings')
    } else if (googleResult === 'error') {
      setSection('integrations')
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

  const changeSection = (nextSection: SettingsSection) => {
    setSection(nextSection)
    window.history.replaceState({}, '', `/settings?section=${nextSection}`)
  }

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
      await loadData()
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

  const syncAccount = async (account: GoogleAccountView) => {
    setWorking(`sync-${account.id}`)
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/google/sync', {
        method: 'POST',
        body: JSON.stringify({ accountId: account.id }),
      }) as SyncResult

      await loadData()
      if (result.failures.length > 0) {
        setMessage({ type: 'error', text: result.failures[0].message })
      } else {
        setMessage({
          type: 'success',
          text: result.imported > 0
            ? `${result.imported} task importati da ${account.email}.`
            : `${account.email} è aggiornato.`,
        })
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Sincronizzazione non riuscita',
      })
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
          telegram_default_project_id: notifications.overrides.telegram_default_project_id,
          notification_project_ids: notifications.overrides.notification_project_ids,
        } : {
          use_defaults: false,
          email_enabled: notifications.effective.email_enabled,
          email_time: notifications.effective.email_time,
          telegram_enabled: notifications.effective.telegram_enabled,
          telegram_time: notifications.effective.telegram_time,
          include_overdue: notifications.effective.include_overdue,
          telegram_default_project_id: notifications.overrides.telegram_default_project_id,
          notification_project_ids: notifications.overrides.notification_project_ids,
        }),
      })
      const refreshed = await authenticatedFetch('/api/notifications/preferences') as NotificationPreferencesView
      setNotifications(refreshed)
      setMessage({ type: 'success', text: 'Preferenze di notifica salvate.' })
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

  const toggleNotificationProject = (projectId: string, checked: boolean) => {
    const availableProjectIds = projects.map((project) => project.id)
    setNotifications((current) => {
      if (!current) return current
      const selectedIds = current.overrides.notification_project_ids.length === 0
        ? availableProjectIds
        : current.overrides.notification_project_ids
      const nextIds = checked
        ? Array.from(new Set([...selectedIds, projectId]))
        : selectedIds.filter((selectedId) => selectedId !== projectId)

      if (nextIds.length === 0) return current
      return {
        ...current,
        overrides: {
          ...current.overrides,
          notification_project_ids: nextIds.length === availableProjectIds.length ? [] : nextIds,
        },
      }
    })
  }

  const connectTelegram = async () => {
    setWorking('telegram-connect')
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/telegram/connect', { method: 'POST' }) as TelegramConnectView
      setTelegramLink(result)
      setMessage({
        type: 'success',
        text: 'Collegamento pronto. Scegli se aprire l\u2019app Telegram oppure Telegram Web.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Collegamento Telegram non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const copyTelegramCommand = async () => {
    if (!telegramLink) return
    try {
      await navigator.clipboard.writeText(telegramLink.start_command)
      setMessage({ type: 'success', text: 'Comando copiato. Incollalo nella chat con il bot su Telegram Web.' })
    } catch {
      setMessage({ type: 'error', text: 'Copia manualmente il comando mostrato sotto.' })
    }
  }

  const checkTelegramConnection = async () => {
    setWorking('telegram-check')
    setMessage(null)
    try {
      const refreshed = await authenticatedFetch('/api/notifications/preferences') as NotificationPreferencesView
      setNotifications(refreshed)
      if (refreshed.telegram_connected) {
        setTelegramLink(null)
        setMessage({ type: 'success', text: 'Telegram collegato correttamente.' })
      } else {
        setMessage({ type: 'error', text: 'Il collegamento non risulta ancora completato. Avvia il bot e riprova.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Verifica Telegram non riuscita' })
    } finally {
      setWorking(null)
    }
  }

  const disconnectTelegram = async () => {
    if (!window.confirm('Vuoi scollegare Telegram da TaskFlow?')) return
    setWorking('telegram-disconnect')
    setMessage(null)
    try {
      await authenticatedFetch('/api/telegram/connect', { method: 'DELETE' })
      const refreshed = await authenticatedFetch('/api/notifications/preferences') as NotificationPreferencesView
      setNotifications(refreshed)
      setTelegramLink(null)
      setMessage({ type: 'success', text: 'Telegram scollegato.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Scollegamento Telegram non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const sendTestTelegram = async () => {
    setWorking('telegram-test')
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/telegram/test', { method: 'POST' }) as { task_count: number }
      setMessage({
        type: 'success',
        text: `Messaggio Telegram inviato. Contiene ${result.task_count} task da controllare.`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Invio Telegram non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile) return
    setWorking('profile-save')
    setMessage(null)
    try {
      const result = await authenticatedFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: profile.full_name || '',
          phone: profile.phone || '',
        }),
      }) as { profile: ProfileView }
      setProfile(result.profile)
      setMessage({ type: 'success', text: 'Profilo aggiornato.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Salvataggio non riuscito' })
    } finally {
      setWorking(null)
    }
  }

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)
    if (newPassword.length < 10 || newPassword !== confirmPassword) {
      setMessage({
        type: 'error',
        text: newPassword !== confirmPassword
          ? 'Le due password non coincidono.'
          : 'La nuova password deve contenere almeno 10 caratteri.',
      })
      return
    }

    setWorking('password-save')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setNewPassword('')
      setConfirmPassword('')
      setMessage({ type: 'success', text: 'Password aggiornata.' })
    }
    setWorking(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Caricamento...</div>
  }

  const canSync = accounts.length > 0 && accounts.every((account) => account.default_project_id)

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        email={profile?.email}
        fullName={profile?.full_name}
        isAdmin={profile?.role === 'admin'}
        current="settings"
        onLogout={handleLogout}
      />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-600">Il tuo spazio</p>
          <h1 className="text-3xl font-bold text-gray-900">Impostazioni</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Gestisci profilo, promemoria e collegamenti personali.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          {([
            ['profile', 'Profilo'],
            ['notifications', 'Notifiche'],
            ['integrations', 'Integrazioni'],
          ] as Array<[SettingsSection, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => changeSection(value)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${section === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {label}
            </button>
          ))}
          {profile?.role === 'admin' && (
            <button type="button" onClick={() => router.push('/admin')} className="ml-auto rounded-lg px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
              Pannello admin
            </button>
          )}
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

        {section === 'profile' && profile && (
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={saveProfile} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-900">Informazioni personali</h2>
              <p className="mt-1 text-sm text-gray-500">Il telefono è un contatto facoltativo e non serve per collegare Telegram.</p>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Nome completo</span>
                  <input value={profile.full_name || ''} onChange={(event) => setProfile({ ...profile, full_name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Email</span>
                  <input value={profile.email || ''} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-500" disabled />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Telefono di contatto</span>
                  <input type="tel" value={profile.phone || ''} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="+39 333 1234567" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
                  <span className="mt-1 block text-xs text-gray-500">Inserisci il prefisso internazionale, ad esempio +39.</span>
                </label>
              </div>
              <button type="submit" disabled={working !== null} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {working === 'profile-save' ? 'Salvataggio...' : 'Salva profilo'}
              </button>
            </form>

            <form onSubmit={changePassword} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-900">Cambia password</h2>
              <p className="mt-1 text-sm text-gray-500">Usa almeno 10 caratteri e combina lettere, numeri e simboli.</p>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Nuova password</span>
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" autoComplete="new-password" required />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Ripeti password</span>
                  <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" autoComplete="new-password" required />
                </label>
              </div>
              <button type="submit" disabled={working !== null} className="mt-5 w-full rounded-lg bg-gray-900 px-4 py-2.5 font-semibold text-white hover:bg-black disabled:opacity-50">
                {working === 'password-save' ? 'Aggiornamento...' : 'Aggiorna password'}
              </button>
            </form>
          </div>
        )}

        {section === 'notifications' && notifications && (
          <section className="mb-8 overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-100 bg-blue-50 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">La tua giornata</p>
                  <h2 className="mt-1 text-xl font-semibold text-gray-900">Promemoria email e Telegram</h2>
                  <p className="mt-2 max-w-2xl text-sm text-gray-600">
                    Scegli quali canali usare e a che ora ricevere i task da controllare.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className={`rounded-full px-3 py-1 ${notifications.effective.email_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {notifications.effective.email_enabled ? `Email ${notifications.effective.email_time}` : 'Email off'}
                  </span>
                  <span className={`rounded-full px-3 py-1 ${notifications.effective.telegram_enabled && notifications.telegram_connected ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {notifications.telegram_connected
                      ? (notifications.effective.telegram_enabled ? `Telegram ${notifications.effective.telegram_time}` : 'Telegram off')
                      : 'Telegram da collegare'}
                  </span>
                </div>
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
                    Email {notifications.defaults.email_enabled ? `alle ${notifications.defaults.email_time}` : 'disattivata'} · Telegram {notifications.defaults.telegram_enabled ? `alle ${notifications.defaults.telegram_time}` : 'disattivato'}
                    {notifications.defaults.include_overdue ? ' · arretrati inclusi' : ' · solo scadenze di oggi'}.
                  </span>
                </span>
              </label>

              {!notifications.using_defaults && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 p-4">
                    <label className="flex items-center gap-3">
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
                      className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 p-4">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={notifications.effective.telegram_enabled}
                        onChange={(event) => setNotifications((current) => current ? ({
                          ...current,
                          effective: { ...current.effective, telegram_enabled: event.target.checked },
                        }) : current)}
                        className="h-5 w-5 rounded border-gray-300 text-blue-600"
                      />
                      <span className="font-semibold text-gray-900">Ricevi Telegram</span>
                    </label>
                    <input
                      type="time"
                      min="07:00"
                      max="22:00"
                      value={notifications.effective.telegram_time}
                      onChange={(event) => setNotifications((current) => current ? ({
                        ...current,
                        effective: { ...current.effective, telegram_time: event.target.value },
                      }) : current)}
                      disabled={!notifications.effective.telegram_enabled}
                      className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                    />
                  </div>

                  <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={notifications.effective.include_overdue}
                      onChange={(event) => setNotifications((current) => current ? ({
                        ...current,
                        effective: { ...current.effective, include_overdue: event.target.checked },
                      }) : current)}
                      disabled={!notifications.effective.email_enabled && !notifications.effective.telegram_enabled}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 disabled:opacity-50"
                    />
                    <span>
                      <span className="block font-semibold text-gray-900">Includi arretrati</span>
                      <span className="block text-xs text-gray-500">Vale per entrambi i canali</span>
                    </span>
                  </label>
                </div>
              )}

              <div className="rounded-xl border border-violet-200 bg-violet-50 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">Progetti nei promemoria</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Scegli quali progetti includere. Il filtro vale per email, Telegram, /today e messaggi di prova.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotifications((current) => current ? ({
                      ...current,
                      overrides: { ...current.overrides, notification_project_ids: [] },
                    }) : current)}
                    disabled={notifications.overrides.notification_project_ids.length === 0}
                    className="shrink-0 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-default disabled:bg-violet-100 disabled:text-violet-500"
                  >
                    Tutti i progetti
                  </button>
                </div>

                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-violet-700">
                  {notifications.overrides.notification_project_ids.length === 0
                    ? 'Sono inclusi tutti i progetti'
                    : `${notifications.overrides.notification_project_ids.length} progetti selezionati`}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {projects.map((project) => {
                    const allProjectsIncluded = notifications.overrides.notification_project_ids.length === 0
                    const projectIncluded = allProjectsIncluded
                      || notifications.overrides.notification_project_ids.includes(project.id)
                    return (
                      <label
                        key={project.id}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-violet-100 bg-white px-3 py-2.5 text-sm text-gray-800"
                      >
                        <input
                          type="checkbox"
                          checked={projectIncluded}
                          onChange={(event) => toggleNotificationProject(project.id, event.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-violet-600"
                        />
                        <span className="truncate">{project.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-sky-200 bg-sky-50 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">Bot Telegram</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${notifications.telegram_connected ? 'bg-green-100 text-green-700' : 'bg-white text-gray-600'}`}>
                        {notifications.telegram_connected ? 'Collegato' : 'Non collegato'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      Dal bot puoi vedere le scadenze, completare task e crearne di nuovi scrivendo un messaggio.
                    </p>
                  </div>
                  {notifications.telegram_connected ? (
                    <button
                      type="button"
                      onClick={disconnectTelegram}
                      disabled={working !== null}
                      className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {working === 'telegram-disconnect' ? 'Scollegamento...' : 'Scollega'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={connectTelegram}
                      disabled={working !== null || !notifications.telegram_configured}
                      className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {working === 'telegram-connect' ? 'Collegamento...' : 'Collega Telegram'}
                    </button>
                  )}
                </div>

                {!notifications.telegram_connected && telegramLink && (
                  <div className="mt-4 rounded-lg border border-sky-200 bg-white p-4">
                    <p className="text-sm font-semibold text-gray-900">Collegamento pronto per 15 minuti</p>
                    <p className="mt-1 text-sm text-gray-600">
                      Se su questo computer non hai l&apos;app Telegram, usa Telegram Web e invia il comando monouso al bot {telegramLink.bot_username}.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <a
                        href={telegramLink.app_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-sky-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-sky-700"
                      >
                        Apri nell&apos;app Telegram
                      </a>
                      <a
                        href={telegramLink.web_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-center text-sm font-semibold text-sky-700 hover:bg-sky-100"
                      >
                        Apri Telegram Web
                      </a>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <code className="overflow-x-auto text-xs text-gray-800">{telegramLink.start_command}</code>
                      <button
                        type="button"
                        onClick={copyTelegramCommand}
                        className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                      >
                        Copia comando
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={checkTelegramConnection}
                      disabled={working !== null}
                      className="mt-3 text-sm font-semibold text-sky-700 hover:text-sky-900 disabled:opacity-50"
                    >
                      {working === 'telegram-check' ? 'Verifica in corso...' : 'Ho avviato il bot, verifica collegamento'}
                    </button>
                  </div>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Progetto per i nuovi task dal bot</span>
                    <select
                      value={notifications.overrides.telegram_default_project_id || ''}
                      onChange={(event) => setNotifications((current) => current ? ({
                        ...current,
                        overrides: { ...current.overrides, telegram_default_project_id: event.target.value || null },
                      }) : current)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Scegli un progetto</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-gray-500">
                      Serve solo per decidere dove salvare i task creati scrivendo al bot.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={sendTestTelegram}
                    disabled={working !== null || !notifications.telegram_connected}
                    className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                  >
                    {working === 'telegram-test' ? 'Invio...' : 'Invia test Telegram'}
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                I promemoria riguardano i task assegnati a te; se un task non ha assegnatario, viene incluso quando ne sei il proprietario.
                {notifications.replies_enabled
                  ? ' Puoi anche rispondere all’email per completare o riprogrammare un task.'
                  : ''}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500">Le modifiche valgono dal prossimo promemoria.</p>
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

        {section === 'integrations' && (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Google Tasks</h2>
              <p className="mt-1 text-sm text-gray-500">
                I token Google sono conservati in modo protetto e non vengono inviati al browser.
              </p>
              <p className="mt-2 text-xs text-amber-700">
                In fase di collaudo, se Google mostra “Accesso bloccato”, la nuova email deve essere abilitata tra gli utenti di test del progetto Google Cloud.
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
              <div key={account.id} className="grid gap-4 p-6 lg:grid-cols-[1.1fr_1fr_1fr_auto] lg:items-end">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Account</p>
                  <p className="mt-1 font-medium text-gray-900">{account.email}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${
                      account.last_sync_status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : account.last_sync_status === 'success'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {account.last_sync_status === 'error'
                        ? 'Da ricollegare'
                        : account.last_sync_status === 'success'
                          ? 'Collegato'
                          : 'Collegato, non ancora sincronizzato'}
                    </span>
                  </div>
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
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Ultima sincronizzazione
                  </p>
                  <p className="mt-1 text-sm text-gray-700">{formatDateTime(account.last_sync_at)}</p>
                  {account.last_sync_error && (
                    <p className="mt-1 max-w-xs text-xs text-red-600" title={account.last_sync_error}>
                      {account.last_sync_error}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => syncAccount(account)}
                    disabled={working !== null || !account.default_project_id}
                    className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {working === `sync-${account.id}` ? 'Sincronizzo...' : 'Sincronizza'}
                  </button>
                  {account.last_sync_status === 'error' && (
                    <button
                      type="button"
                      onClick={connectGoogle}
                      disabled={working !== null}
                      className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Ricollega
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => disconnectGoogle(account)}
                    disabled={working !== null}
                    className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Scollega
                  </button>
                </div>
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
        )}

        {section === 'integrations' && projects.length === 0 && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Prima di sincronizzare crea almeno un progetto dalla dashboard.
          </div>
        )}
      </main>
    </div>
  )
}
