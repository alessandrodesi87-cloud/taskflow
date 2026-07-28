'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Project, Task } from '@/types'
import GanttChart from '@/components/gantt/GanttChart'

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          router.push('/auth/login')
          return
        }

        setUser(session.user)

        const { data: projectsData } = await supabase
          .from('projects')
          .select('*')
          .or(`owner_id.eq.${session.user.id}`)

        if (projectsData) setProjects(projectsData)

        const { data: tasksData } = await supabase
          .from('tasks')
          .select('*')

        if (tasksData) setTasks(tasksData)
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p>Caricamento...</p></div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">TaskFlow</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">{user?.email}</span>
            <button onClick={handleLogout} className="px-4 py-2 bg-red-600 text-white rounded">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold">I tuoi Progetti</h2>
          <button className="px-4 py-2 bg-blue-600 text-white rounded">+ Nuovo Progetto</button>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">Non hai progetti ancora</p>
            <button className="px-4 py-2 bg-blue-600 text-white rounded">Crea il primo progetto</button>
          </div>
        ) : (
          <GanttChart projects={projects} tasks={tasks} />
        )}
      </main>
    </div>
  )
}
