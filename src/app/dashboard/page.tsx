'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Project, Task } from '@/types'
import GanttChart from '@/components/gantt/GanttChart'

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [shareProject, setShareProject] = useState<Project | null>(null)
  const [shareEmail, setShareEmail] = useState('')
  const [shareRole, setShareRole] = useState<'member' | 'co-owner'>('member')
  const [members, setMembers] = useState<any[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const router = useRouter()

  // Form nuovo progetto
  const [pName, setPName] = useState('')
  const [pStart, setPStart] = useState(new Date().toISOString().split('T')[0])
  const [pEnd, setPEnd] = useState('')

  // Form nuovo task
  const [tTitle, setTTitle] = useState('')
  const [tDesc, setTDesc] = useState('')
  const [tProject, setTProject] = useState('')
  const [tStart, setTStart] = useState(new Date().toISOString().split('T')[0])
  const [tDue, setTDue] = useState('')
  const [tPriority, setTPriority] = useState<'low' | 'medium' | 'high'>('medium')

  const loadData = useCallback(async (userId: string) => {
    const { data: projectsData } = await supabase
      .from('projects')
      .select('*')
      .order('start_date', { ascending: true })

    setProjects(projectsData || [])

    if (projectsData && projectsData.length > 0) {
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('*')
        .in('project_id', projectsData.map(p => p.id))
        .order('start_date', { ascending: true })
      setTasks(tasksData || [])
    } else {
      setTasks([])
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
        return
      }
      setUser(session.user)
      await loadData(session.user.id)
      setLoading(false)
    }
    init()
  }, [router, loadData])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    const { error } = await supabase.from('projects').insert({
      name: pName,
      start_date: pStart,
      end_date: pEnd,
      owner_id: user.id,
    })
    if (error) {
      setErrorMsg(`Errore creazione progetto: ${error.message}`)
      return
    }
    setShowProjectModal(false)
    setPName(''); setPEnd('')
    await loadData(user.id)
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    const { error } = await supabase.from('tasks').insert({
      project_id: tProject,
      title: tTitle,
      description: tDesc,
      start_date: tStart,
      due_date: tDue,
      priority: tPriority,
      status: 'todo',
      owner_id: user.id,
      creator_id: user.id,
    })
    if (error) {
      setErrorMsg(`Errore creazione task: ${error.message}`)
      return
    }
    setShowTaskModal(false)
    setTTitle(''); setTDesc(''); setTDue('')
    await loadData(user.id)
  }

  const openShare = async (project: Project) => {
    setShareProject(project)
    setShareEmail('')
    const { data } = await supabase
      .from('project_members')
      .select('id, role, user_id, users(email, full_name)')
      .eq('project_id', project.id)
    setMembers(data || [])
  }

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', shareEmail.trim().toLowerCase())
      .single()
    if (!targetUser) {
      setErrorMsg(`Nessun utente trovato con email ${shareEmail}. Deve prima registrarsi.`)
      return
    }
    const { error } = await supabase.from('project_members').insert({
      project_id: shareProject!.id,
      user_id: targetUser.id,
      role: shareRole,
    })
    if (error) {
      setErrorMsg(error.code === '23505' ? 'Utente già membro del progetto.' : `Errore: ${error.message}`)
      return
    }
    await openShare(shareProject!)
    setShareEmail('')
  }

  const handleRemoveMember = async (memberId: string) => {
    await supabase.from('project_members').delete().eq('id', memberId)
    if (shareProject) await openShare(shareProject)
  }

  const handleTaskStatusChange = async (task: Task, status: Task['status']) => {
    await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', task.id)
    setSelectedTask(null)
    await loadData(user.id)
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p>Caricamento...</p></div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">TaskFlow</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600 text-sm">{user?.email}</span>
            <button onClick={handleLogout} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{errorMsg}</div>
        )}

        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold">I tuoi Progetti</h2>
          <div className="flex gap-3">
            {projects.length > 0 && (
              <button onClick={() => { setTProject(projects[0].id); setShowTaskModal(true) }} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">+ Nuovo Task</button>
            )}
            <button onClick={() => setShowProjectModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ Nuovo Progetto</button>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-500 mb-4">Non hai ancora progetti</p>
            <button onClick={() => setShowProjectModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Crea il primo progetto</button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {projects.map(p => (
                <button key={p.id} onClick={() => openShare(p)} className="px-3 py-1.5 text-sm bg-white border rounded-full hover:bg-gray-100" title="Gestisci condivisione">
                  {p.name} · 👥 Condividi
                </button>
              ))}
            </div>
            <GanttChart projects={projects} tasks={tasks} onTaskClick={setSelectedTask} />
          </>
        )}
      </main>

      {/* Modal Nuovo Progetto */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Nuovo Progetto</h3>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nome progetto</label>
                <input type="text" value={pName} onChange={e => setPName(e.target.value)} className="w-full px-3 py-2 border rounded-md" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Data inizio</label>
                  <input type="date" value={pStart} onChange={e => setPStart(e.target.value)} className="w-full px-3 py-2 border rounded-md" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Data fine</label>
                  <input type="date" value={pEnd} onChange={e => setPEnd(e.target.value)} className="w-full px-3 py-2 border rounded-md" required />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowProjectModal(false)} className="px-4 py-2 bg-gray-200 rounded">Annulla</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Crea</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nuovo Task */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Nuovo Task</h3>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Titolo</label>
                <input type="text" value={tTitle} onChange={e => setTTitle(e.target.value)} className="w-full px-3 py-2 border rounded-md" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Descrizione</label>
                <textarea value={tDesc} onChange={e => setTDesc(e.target.value)} className="w-full px-3 py-2 border rounded-md" rows={2} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Progetto</label>
                <select value={tProject} onChange={e => setTProject(e.target.value)} className="w-full px-3 py-2 border rounded-md" required>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Inizio</label>
                  <input type="date" value={tStart} onChange={e => setTStart(e.target.value)} className="w-full px-3 py-2 border rounded-md" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Scadenza</label>
                  <input type="date" value={tDue} onChange={e => setTDue(e.target.value)} className="w-full px-3 py-2 border rounded-md" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Priorità</label>
                <select value={tPriority} onChange={e => setTPriority(e.target.value as any)} className="w-full px-3 py-2 border rounded-md">
                  <option value="low">Bassa</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowTaskModal(false)} className="px-4 py-2 bg-gray-200 rounded">Annulla</button>
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">Crea</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Condivisione Progetto */}
      {shareProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-1">Condividi "{shareProject.name}"</h3>
            <p className="text-sm text-gray-500 mb-4">Invita un collega registrato inserendo la sua email</p>

            <form onSubmit={handleShare} className="flex gap-2 mb-4">
              <input type="email" value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="email@collega.it" className="flex-1 px-3 py-2 border rounded-md" required />
              <select value={shareRole} onChange={e => setShareRole(e.target.value as any)} className="px-2 py-2 border rounded-md">
                <option value="member">Member</option>
                <option value="co-owner">Co-owner</option>
              </select>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Invita</button>
            </form>

            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
              {members.length === 0 && <p className="text-sm text-gray-400">Nessun membro ancora</p>}
              {members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{m.users?.full_name || m.users?.email}</p>
                    <p className="text-xs text-gray-500">{m.users?.email} · {m.role}</p>
                  </div>
                  <button onClick={() => handleRemoveMember(m.id)} className="text-red-500 text-sm hover:underline">Rimuovi</button>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button onClick={() => setShareProject(null)} className="px-4 py-2 bg-gray-200 rounded">Chiudi</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dettaglio Task */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-2">{selectedTask.title}</h3>
            {selectedTask.description && <p className="text-gray-600 mb-4">{selectedTask.description}</p>}
            <p className="text-sm text-gray-500 mb-4">
              {selectedTask.start_date} → {selectedTask.due_date} · Priorità: {selectedTask.priority}
            </p>
            <div className="flex gap-2 mb-4">
              <button onClick={() => handleTaskStatusChange(selectedTask, 'todo')} className={`px-3 py-1.5 rounded text-sm ${selectedTask.status === 'todo' ? 'bg-gray-600 text-white' : 'bg-gray-200'}`}>Da fare</button>
              <button onClick={() => handleTaskStatusChange(selectedTask, 'in_progress')} className={`px-3 py-1.5 rounded text-sm ${selectedTask.status === 'in_progress' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>In corso</button>
              <button onClick={() => handleTaskStatusChange(selectedTask, 'done')} className={`px-3 py-1.5 rounded text-sm ${selectedTask.status === 'done' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>Completato</button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setSelectedTask(null)} className="px-4 py-2 bg-gray-200 rounded">Chiudi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
