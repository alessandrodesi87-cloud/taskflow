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

export default function AdminPage() {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const router = useRouter()

  useEffect(() => {
    const checkAdminAndLoadUsers = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/auth/login')
          return
        }

        const response = await fetch('/api/admin/users', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })

        if (response.status === 401) {
          router.push('/dashboard')
          return
        }

        if (!response.ok) {
          throw new Error('Impossibile caricare gli utenti')
        }

        const payload = await response.json()
        setAccessToken(session.access_token)
        setUsers(payload.users || [])
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
