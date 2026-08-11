'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'

interface UserInfo {
  id: string
  email: string
  full_name: string
  role: string
  phone?: string
  telegram_chat_id?: string
  is_active: boolean
  suspended_at?: string | null
  last_sign_in_at?: string | null
}

interface AdminProjectInfo {
  id: string
  name: string
  owner_id: string
  start_date: string
  end_date: string
  task_count: number
  open_task_count: number
  owner?: {
    id: string
    email?: string
    full_name?: string
    is_active: boolean
  } | null
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
  const [projects, setProjects] = useState<AdminProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [notificationSettings, setNotificationSettings] = useState<NotificationAdminSettings | null>(null)
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [replacementByUser, setReplacementByUser] = useState<Record<string, string>>({})
  const [ownerByProject, setOwnerByProject] = useState<Record<string, string>>({})
  const [workingItem, setWorkingItem] = useState<string | null>(null)
  const [adminMessage, setAdminMessage] = useState('')
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
        const [response, notificationsResponse, projectsResponse] = await Promise.all([
          fetch('/api/admin/users', { headers }),
          fetch('/api/admin/notifications', { headers }),
          fetch('/api/admin/projects', { headers }),
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
        if (!projectsResponse.ok) {
          throw new Error('Impossibile caricare i progetti')
        }

        const payload = await response.json()
        const notificationsPayload = await notificationsResponse.json()
        const projectsPayload = await projectsResponse.json()
        setAccessToken(session.access_token)
        setCurrentUserId(session.user.id)
        setCurrentUserEmail(session.user.email || '')
        setUsers(payload.users || [])
        setProjects(projectsPayload.projects || [])
        setOwnerByProject(Object.fromEntries((projectsPayload.projects || []).map((project: AdminProjectInfo) => [project.id, project.owner_id])))
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

  const reloadPeopleAndProjects = async () => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const [usersResponse, projectsResponse] = await Promise.all([
      fetch('/api/admin/users', { headers }),
      fetch('/api/admin/projects', { headers }),
    ])
    if (!usersResponse.ok || !projectsResponse.ok) {
      throw new Error('Aggiornamento dati amministrativi non riuscito')
    }
    const usersPayload = await usersResponse.json()
    const projectsPayload = await projectsResponse.json()
    setUsers(usersPayload.users || [])
    setProjects(projectsPayload.projects || [])
    setOwnerByProject(Object.fromEntries((projectsPayload.projects || []).map((project: AdminProjectInfo) => [project.id, project.owner_id])))
  }

  const changeUserStatus = async (user: UserInfo) => {
    const action = user.is_active ? 'suspend' : 'reactivate'
    if (action === 'suspend' && !window.confirm(`Sospendere ${user.email}? I suoi dati non verranno cancellati.`)) return

    setWorkingItem(`user-${user.id}`)
    setErrorMessage('')
    setAdminMessage('')
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          action,
          replacementUserId: action === 'suspend' ? replacementByUser[user.id] || undefined : undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Operazione non riuscita')
      await reloadPeopleAndProjects()
      setAdminMessage(action === 'suspend' ? 'Utente sospeso e responsabilità trasferite.' : 'Utente riattivato.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Operazione non riuscita')
    } finally {
      setWorkingItem(null)
    }
  }

  const transferProject = async (project: AdminProjectInfo) => {
    const ownerId = ownerByProject[project.id]
    if (!ownerId || ownerId === project.owner_id) return
    if (!window.confirm(`Trasferire la proprietà del progetto “${project.name}”?`)) return

    setWorkingItem(`project-${project.id}`)
    setErrorMessage('')
    setAdminMessage('')
    try {
      const response = await fetch('/api/admin/projects', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectId: project.id, ownerId }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Trasferimento non riuscito')
      await reloadPeopleAndProjects()
      setAdminMessage('Proprietà del progetto trasferita.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Trasferimento non riuscito')
    } finally {
      setWorkingItem(null)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
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
      <AppHeader
        email={currentUserEmail}
        fullName={users.find((user) => user.id === currentUserId)?.full_name}
        isAdmin
        current="admin"
        onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Amministrazione</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">Persone e continuità</h1>
          <p className="mt-2 text-gray-600">Sospendi gli accessi senza perdere il lavoro e trasferisci le responsabilità in sicurezza.</p>
        </div>
        {errorMessage && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}
        {adminMessage && (
          <div className="mb-6 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">{adminMessage}</div>
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
              required
            />
            <input
              type="password"
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              placeholder="Password"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
              minLength={10}
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
        <section className="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900">Utenti</h2>
            <p className="mt-1 text-sm text-gray-500">Per sospendere chi possiede progetti, scegli prima la persona che erediterà il lavoro.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="border-b bg-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-sm font-semibold">Persona</th>
                  <th className="px-5 py-3 text-left text-sm font-semibold">Ruolo</th>
                  <th className="px-5 py-3 text-left text-sm font-semibold">Stato</th>
                  <th className="px-5 py-3 text-left text-sm font-semibold">Ultimo accesso</th>
                  <th className="px-5 py-3 text-left text-sm font-semibold">Trasferisci a</th>
                  <th className="px-5 py-3 text-right text-sm font-semibold">Azione</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm">
                      <p className="font-medium text-gray-900">{user.full_name || user.email}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${user.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{user.role}</span>
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{user.is_active ? 'Attivo' : 'Sospeso'}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {user.last_sign_in_at ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(user.last_sign_in_at)) : 'Mai'}
                    </td>
                    <td className="px-5 py-3 text-sm">
                      {user.is_active && user.id !== currentUserId ? (
                        <select value={replacementByUser[user.id] || ''} onChange={(event) => setReplacementByUser((current) => ({ ...current, [user.id]: event.target.value }))} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                          <option value="">Scegli se necessario</option>
                          {users.filter((candidate) => candidate.is_active && candidate.id !== user.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.full_name || candidate.email}</option>)}
                        </select>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-sm">
                      {user.id === currentUserId ? (
                        <span className="text-xs text-gray-400">Account corrente</span>
                      ) : (
                        <button type="button" onClick={() => changeUserStatus(user)} disabled={workingItem !== null} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${user.is_active ? 'border border-red-200 text-red-700 hover:bg-red-50' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                          {workingItem === `user-${user.id}` ? 'Attendi...' : user.is_active ? 'Sospendi' : 'Riattiva'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900">Progetti aziendali</h2>
            <p className="mt-1 text-sm text-gray-500">Solo gli amministratori possono cambiare l’owner.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {projects.map((project) => (
              <div key={project.id} className="grid gap-4 p-5 md:grid-cols-[1.2fr_0.8fr_1fr_auto] md:items-center">
                <div>
                  <p className="font-semibold text-gray-900">{project.name}</p>
                  <p className="text-xs text-gray-500">{project.start_date} → {project.end_date}</p>
                </div>
                <div className="text-sm text-gray-600">
                  <p>{project.task_count} task totali</p>
                  <p className={project.open_task_count > 0 ? 'text-amber-700' : 'text-green-700'}>{project.open_task_count} ancora aperti</p>
                </div>
                <select value={ownerByProject[project.id] || project.owner_id} onChange={(event) => setOwnerByProject((current) => ({ ...current, [project.id]: event.target.value }))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  {users.filter((user) => user.is_active).map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}
                </select>
                <button type="button" onClick={() => transferProject(project)} disabled={workingItem !== null || (ownerByProject[project.id] || project.owner_id) === project.owner_id} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:cursor-default disabled:bg-gray-200 disabled:text-gray-500">
                  {workingItem === `project-${project.id}` ? 'Trasferimento...' : 'Trasferisci'}
                </button>
              </div>
            ))}
            {projects.length === 0 && <p className="p-8 text-center text-sm text-gray-500">Nessun progetto disponibile.</p>}
          </div>
        </section>
      </main>
    </div>
  )
}
