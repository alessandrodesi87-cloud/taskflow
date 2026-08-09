'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface UserInfo {
  id: string
  email: string
  full_name: string
  role: string
  phone?: string
  telegram_chat_id?: string
}

interface NotificationAdminSettings {
  defaults: {
    email_enabled: boolean
    email_time: string
    telegram_enabled: boolean
    telegram_time: string
    timezone: string
    include_overdue: boolean
  }
  personalized_users: number
  email_configured: boolean
  replies_configured: boolean
  telegram_configured: boolean
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [notificationSettings, setNotificationSettings] = useState<NotificationAdminSettings | null>(null)
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const router = useRouter()

  useEffect(() => {
    const checkAdminAndLoadUsers = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/auth/login')
          return
        }

        const headers = { Authorization: `Bearer ${session.access_token}` }
        const [response, notificationsResponse] = await Promise.all([
          fetch('/api/admin/users', { headers }),
          fetch('/api/admin/notifications', { headers }),
        ])

        if (response.status === 401) {
          router.push('/dashboard')
          return
        }

        if (!response.ok) {
          throw new Error('Impossibile caricare gli utenti')
        }

        if (!notificationsResponse.ok) {
          throw new Error('Impossibile caricare le impostazioni email')
        }

        const payload = await response.json()
        const notificationsPayload = await notificationsResponse.json()
        setAccessToken(session.access_token)
        setUsers(payload.users || [])
        setNotificationSettings(notificationsPayload)
        setIsAdmin(true)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Errore inatteso')
      } finally {
        setLoading(false)
      }
    }

    checkAdminAndLoadUsers()
  }, [router])

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Impossibile creare l’utente')
      }

      const usersResponse = await fetch('/api/admin/users', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      const usersPayload = await usersResponse.json()

      setUsers(usersPayload.users || [])
      setNewUserEmail('')
      setNewUserPassword('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Errore inatteso')
    }
  }

  const saveNotificationDefaults = async () => {
    if (!notificationSettings) return

    setSavingNotifications(true)
    setErrorMessage('')
    setNotificationMessage('')
    try {
      const response = await fetch('/api/admin/notifications', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notificationSettings.defaults),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Salvataggio non riuscito')
      setNotificationMessage(
        payload.telegram_webhook_configured
          ? 'Impostazioni salvate e Telegram attivo in produzione.'
          : 'Impostazioni predefinite salvate.'
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Errore inatteso')
    } finally {
      setSavingNotifications(false)
    }
  }

  if (loading) return <div className="p-8">Caricamento...</div>
  if (!isAdmin) return <div className="p-8">Non autorizzato</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Admin Console</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {errorMessage && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {notificationSettings && (
          <section className="mb-8 overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-100 bg-blue-50 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Notifiche di squadra</p>
                  <h2 className="mt-1 text-xl font-bold text-gray-900">Promemoria predefiniti</h2>
                  <p className="mt-2 max-w-2xl text-sm text-gray-600">
                    Questi valori si applicano a tutti. Ogni utente può mantenerli oppure personalizzarli dalle proprie impostazioni.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className={`rounded-full px-3 py-1 ${notificationSettings.email_configured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                    {notificationSettings.email_configured ? 'Invio configurato' : 'Invio da configurare'}
                  </span>
                  <span className={`rounded-full px-3 py-1 ${notificationSettings.replies_configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {notificationSettings.replies_configured ? 'Risposte attive' : 'Risposte non attive'}
                  </span>
                  <span className={`rounded-full px-3 py-1 ${notificationSettings.telegram_configured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                    {notificationSettings.telegram_configured ? 'Telegram configurato' : 'Telegram da configurare'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-6 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                <input
                  type="checkbox"
                  checked={notificationSettings.defaults.email_enabled}
                  onChange={(event) => setNotificationSettings((current) => current ? ({
                    ...current,
                    defaults: { ...current.defaults, email_enabled: event.target.checked },
                  }) : current)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600"
                />
                <span>
                  <span className="block font-semibold text-gray-900">Email giornaliera</span>
                  <span className="block text-xs text-gray-500">Attiva per impostazione predefinita</span>
                </span>
              </label>

              <label className="block rounded-lg border border-gray-200 p-4">
                <span className="block text-sm font-semibold text-gray-900">Orario predefinito</span>
                <input
                  type="time"
                  min="07:00"
                  max="22:00"
                  value={notificationSettings.defaults.email_time}
                  onChange={(event) => setNotificationSettings((current) => current ? ({
                    ...current,
                    defaults: { ...current.defaults, email_time: event.target.value },
                  }) : current)}
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"
                />
                <span className="mt-1 block text-xs text-gray-500">Fuso orario Italia · dalle 07:00 alle 22:00</span>
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                <input
                  type="checkbox"
                  checked={notificationSettings.defaults.telegram_enabled}
                  onChange={(event) => setNotificationSettings((current) => current ? ({
                    ...current,
                    defaults: { ...current.defaults, telegram_enabled: event.target.checked },
                  }) : current)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600"
                />
                <span>
                  <span className="block font-semibold text-gray-900">Telegram giornaliero</span>
                  <span className="block text-xs text-gray-500">Attivo dopo che l’utente collega il bot</span>
                </span>
              </label>

              <label className="block rounded-lg border border-gray-200 p-4">
                <span className="block text-sm font-semibold text-gray-900">Orario Telegram predefinito</span>
                <input
                  type="time"
                  min="07:00"
                  max="22:00"
                  value={notificationSettings.defaults.telegram_time}
                  onChange={(event) => setNotificationSettings((current) => current ? ({
                    ...current,
                    defaults: { ...current.defaults, telegram_time: event.target.value },
                  }) : current)}
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"
                />
                <span className="mt-1 block text-xs text-gray-500">Fuso orario Italia · dalle 07:00 alle 22:00</span>
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 md:col-span-2">
                <input
                  type="checkbox"
                  checked={notificationSettings.defaults.include_overdue}
                  onChange={(event) => setNotificationSettings((current) => current ? ({
                    ...current,
                    defaults: { ...current.defaults, include_overdue: event.target.checked },
                  }) : current)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600"
                />
                <span>
                  <span className="block font-semibold text-gray-900">Includi arretrati</span>
                  <span className="block text-xs text-gray-500">Mostra anche i task già scaduti</span>
                </span>
              </label>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">
                {notificationSettings.personalized_users === 0
                  ? 'Tutti gli utenti stanno usando i valori predefiniti.'
                  : `${notificationSettings.personalized_users} utenti hanno scelto impostazioni personali.`}
              </p>
              <div className="flex items-center gap-3">
                {notificationMessage && <span className="text-sm font-medium text-green-700">{notificationMessage}</span>}
                <button
                  type="button"
                  onClick={saveNotificationDefaults}
                  disabled={savingNotifications}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingNotifications ? 'Salvataggio...' : 'Salva impostazioni notifiche'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Add new user */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Aggiungi nuovo utente</h2>
          <form onSubmit={handleAddUser} className="flex gap-4">
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Email"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
              minLength={10}
              required
            />
            <input
              type="password"
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              placeholder="Password"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
              required
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Aggiungi
            </button>
          </form>
        </div>

        {/* Users list */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Email</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Nome</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Ruolo</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Telefono</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Telegram</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm">{user.email}</td>
                  <td className="px-6 py-3 text-sm">{user.full_name || '-'}</td>
                  <td className="px-6 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      user.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm">{user.phone || '-'}</td>
                  <td className="px-6 py-3 text-sm">{user.telegram_chat_id ? '✓' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
