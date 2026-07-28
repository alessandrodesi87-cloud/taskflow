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
  const router = useRouter()

  useEffect(() => {
    const checkAdminAndLoadUsers = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/auth/login')
          return
        }

        const { data: userData } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single()

        if (userData?.role !== 'admin') {
          router.push('/dashboard')
          return
        }

        setIsAdmin(true)

        // Load all users
        const { data: usersData } = await supabase
          .from('users')
          .select('*')

        setUsers(usersData || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    checkAdminAndLoadUsers()
  }, [router])

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // Create auth user
      const { data, error: authError } = await supabase.auth.admin.createUser({
        email: newUserEmail,
        password: newUserPassword,
        email_confirm: true,
      })

      if (authError) throw authError

      // Create user profile
      if (data.user) {
        await supabase.from('users').insert({
          id: data.user.id,
          email: newUserEmail,
          role: 'member',
        })

        // Reload users
        const { data: usersData } = await supabase
          .from('users')
          .select('*')

        setUsers(usersData || [])
        setNewUserEmail('')
        setNewUserPassword('')
      }
    } catch (error) {
      console.error('Error adding user:', error)
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
