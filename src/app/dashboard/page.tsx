'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Project, Task } from '@/types'
import GanttChart from '@/components/gantt/GanttChart'
import DeadlineTable from '@/components/planning/DeadlineTable'
import AppHeader from '@/components/AppHeader'
import type { User as AuthUser } from '@supabase/supabase-js'

interface ProjectMemberWithUser {
  id: string
  project_id: string
  role: 'owner' | 'co-owner' | 'member'
  user_id: string
  users: {
    email?: string
    full_name?: string
  } | null
}

interface TeamUser {
  id: string
  email?: string
  full_name?: string
}

interface CurrentProfile {
  full_name?: string | null
  role: 'admin' | 'member'
}

type AssigneeFilter = 'all' | 'mine' | 'unassigned'
type DueFilter = 'all' | 'overdue' | 'upcoming'
type PlanningView = 'gantt' | 'deadlines'

interface UndoTaskStatus {
  taskId: string
  title: string
  previousStatus: Task['status']
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMemberWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<CurrentProfile | null>(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [shareProject, setShareProject] = useState<Project | null>(null)
  const [shareEmail, setShareEmail] = useState('')
  const [shareRole, setShareRole] = useState<'member' | 'co-owner'>('member')
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Task['priority']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all')
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([])
  const [planningView, setPlanningView] = useState<PlanningView>('deadlines')
  const [undoTaskStatus, setUndoTaskStatus] = useState<UndoTaskStatus | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const [tPriority, setTPriority] = useState<Task['priority']>('medium')
  const [tAssignee, setTAssignee] = useState('')

  const loadData = useCallback(async () => {
    const { data: projectsData, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .order('start_date', { ascending: true })

    if (projectsError) throw projectsError
    const nextProjects = ((projectsData || []) as Project[]).sort((first, second) => {
      if (first.is_personal !== second.is_personal) return first.is_personal ? -1 : 1
      return first.name.localeCompare(second.name, 'it')
    })
    setProjects(nextProjects)

    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('id, email, full_name')
      .order('full_name', { ascending: true })
    if (usersError) throw usersError
    setTeamUsers((usersData || []) as TeamUser[])

    if (nextProjects.length > 0) {
      const projectIds = nextProjects.map((project) => project.id)
      const [tasksResult, membersResult] = await Promise.all([
        supabase
          .from('tasks')
          .select('*')
          .in('project_id', projectIds)
          .order('start_date', { ascending: true }),
        supabase
          .from('project_members')
          .select('id, project_id, role, user_id, users(email, full_name)')
          .in('project_id', projectIds),
      ])

      if (tasksResult.error) throw tasksResult.error
      if (membersResult.error) throw membersResult.error
      setTasks((tasksResult.data || []) as Task[])
      setProjectMembers((membersResult.data || []) as unknown as ProjectMemberWithUser[])
    } else {
      setTasks([])
      setProjectMembers([])
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
        return
      }
      const storedPlanningView = window.localStorage.getItem(
        `taskflow:planning-view:${session.user.id}`
      )
      if (storedPlanningView === 'gantt' || storedPlanningView === 'deadlines') {
        setPlanningView(storedPlanningView)
      }
      const storedCollapsed = window.localStorage.getItem(
        `taskflow:collapsed-projects:${session.user.id}`
      )
      if (storedCollapsed) {
        try {
          const parsed = JSON.parse(storedCollapsed) as unknown
          if (Array.isArray(parsed)) {
            setCollapsedProjectIds(parsed.filter((value): value is string => typeof value === 'string'))
          }
        } catch {
          window.localStorage.removeItem(`taskflow:collapsed-projects:${session.user.id}`)
        }
      }
      setUser(session.user)
      try {
        const profileResponse = await fetch('/api/profile', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (profileResponse.ok) {
          const profileBody = await profileResponse.json() as { profile: CurrentProfile }
          setProfile(profileBody.profile)
        }
        await loadData()
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Caricamento non riuscito')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, loadData])

  useEffect(() => {
    if (!user) return
    window.localStorage.setItem(
      `taskflow:collapsed-projects:${user.id}`,
      JSON.stringify(collapsedProjectIds)
    )
  }, [collapsedProjectIds, user])

  useEffect(() => {
    if (!user) return
    window.localStorage.setItem(`taskflow:planning-view:${user.id}`, planningView)
  }, [planningView, user])

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [])

  const getProjectParticipants = useCallback((projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    const participantIds = new Set(
      projectMembers
        .filter((member) => member.project_id === projectId)
        .map((member) => member.user_id)
    )
    if (project) participantIds.add(project.owner_id)
    return teamUsers.filter((teamUser) => participantIds.has(teamUser.id))
  }, [projectMembers, projects, teamUsers])

  const visibleProjects = useMemo(
    () => projectFilter === 'all'
      ? projects
      : projects.filter((project) => project.id === projectFilter),
    [projectFilter, projects]
  )

  const visibleTasks = useMemo(() => {
    const today = localDateKey()
    const upcomingDate = new Date()
    upcomingDate.setDate(upcomingDate.getDate() + 7)
    const upcoming = localDateKey(upcomingDate)

    return tasks.filter((task) => {
      if (projectFilter !== 'all' && task.project_id !== projectFilter) return false
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (statusFilter === 'all' && !showCompleted && task.status === 'done') return false
      if (assigneeFilter === 'mine' && task.assignee_id !== user?.id) return false
      if (assigneeFilter === 'unassigned' && task.assignee_id) return false
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
      if (dueFilter === 'overdue' && (task.status === 'done' || task.due_date >= today)) return false
      if (dueFilter === 'upcoming' && (task.due_date < today || task.due_date > upcoming)) return false
      return true
    })
  }, [assigneeFilter, dueFilter, priorityFilter, projectFilter, showCompleted, statusFilter, tasks, user?.id])

  const ganttProjects = useMemo(() => visibleProjects.filter((project) => {
    const hasVisibleTasks = visibleTasks.some((task) => task.project_id === project.id)
    if (!hasVisibleTasks) return false
    if (!project.is_personal) return true
    return tasks.some((task) => task.project_id === project.id && task.status !== 'done')
  }), [tasks, visibleProjects, visibleTasks])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    if (!user) {
      setErrorMsg('Sessione scaduta. Accedi di nuovo.')
      return
    }

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
    await loadData()
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    if (!user) {
      setErrorMsg('Sessione scaduta. Accedi di nuovo.')
      return
    }

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
      assignee_id: tAssignee || null,
    })
    if (error) {
      setErrorMsg(`Errore creazione task: ${error.message}`)
      return
    }
    setShowTaskModal(false)
    setTTitle(''); setTDesc(''); setTDue(''); setTAssignee('')
    setSuccessMsg('Task creato correttamente.')
    await loadData()
  }

  const openShare = async (project: Project) => {
    setShareProject(project)
    setSelectedProject(project)
    setShareEmail('')
    if (project.is_personal) {
      setMembers([])
      return
    }
    const { data } = await supabase
      .from('project_members')
      .select('id, role, user_id, users(email, full_name)')
      .eq('project_id', project.id)
    setMembers((data || []) as unknown as ProjectMemberWithUser[])
  }

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    if (shareProject?.is_personal) {
      setErrorMsg('L’Inbox personale è privata e non può essere condivisa.')
      return
    }
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
    await loadData()
    setShareEmail('')
    setSuccessMsg('Membro aggiunto al progetto.')
  }

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase.from('project_members').delete().eq('id', memberId)
    if (error) {
      setErrorMsg(`Rimozione non riuscita: ${error.message}`)
      return
    }
    if (shareProject) await openShare(shareProject)
    await loadData()
    setSuccessMsg('Membro rimosso dal progetto.')
  }

  const handleSaveProject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedProject) return
    if (selectedProject.is_personal) {
      setErrorMsg('L’Inbox personale è gestita automaticamente.')
      return
    }
    setErrorMsg('')
    setSuccessMsg('')

    const { data, error } = await supabase
      .from('projects')
      .update({
        name: selectedProject.name.trim(),
        description: selectedProject.description || null,
        start_date: selectedProject.start_date,
        end_date: selectedProject.end_date,
        color: selectedProject.color || '#3b82f6',
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedProject.id)
      .select('*')
      .single()

    if (error) {
      setErrorMsg(`Modifica progetto non riuscita: ${error.message}`)
      return
    }

    setSelectedProject(data as Project)
    setShareProject(data as Project)
    setSuccessMsg('Progetto aggiornato.')
    await loadData()
  }

  const handleSaveTask = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedTask) return
    setErrorMsg('')
    setSuccessMsg('')

    if (selectedTask.due_date < selectedTask.start_date) {
      setErrorMsg('La scadenza non può precedere la data di inizio.')
      return
    }

    const assigneeId = selectedTask.assignee_id || null
    if (
      assigneeId
      && !getProjectParticipants(selectedTask.project_id).some((person) => person.id === assigneeId)
    ) {
      setErrorMsg('L’assegnatario deve partecipare al progetto selezionato.')
      return
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({
        project_id: selectedTask.project_id,
        title: selectedTask.title.trim(),
        description: selectedTask.description || null,
        assignee_id: assigneeId,
        start_date: selectedTask.start_date,
        due_date: selectedTask.due_date,
        status: selectedTask.status,
        priority: selectedTask.priority,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedTask.id)
      .select('*')
      .single()

    if (error) {
      setErrorMsg(`Modifica task non riuscita: ${error.message}`)
      return
    }

    setSelectedTask(data as Task)
    setSuccessMsg('Task aggiornato.')
    await loadData()
  }

  const handleTaskDateChange = async (task: Task, startDate: string, dueDate: string) => {
    setErrorMsg('')
    setSavingTaskId(task.id)
    setTasks(currentTasks =>
      currentTasks.map(currentTask =>
        currentTask.id === task.id
          ? { ...currentTask, start_date: startDate, due_date: dueDate }
          : currentTask
      )
    )

    try {
      const { data, error } = await supabase
        .from('tasks')
        .update({
          start_date: startDate,
          due_date: dueDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .select('id')
        .single()

      if (error || !data) {
        setErrorMsg(
          `Non sono riuscito a salvare le nuove date: ${
            error?.message || 'attivita non trovata'
          }`
        )
        await loadData()
      }
    } catch {
      setErrorMsg('Non sono riuscito a salvare le nuove date. Riprova tra poco.')
      await loadData()
    } finally {
      setSavingTaskId(null)
    }
  }

  const handleTaskDueDateChange = async (task: Task, dueDate: string) => {
    const startDate = task.start_date > dueDate ? dueDate : task.start_date
    await handleTaskDateChange(task, startDate, dueDate)
  }

  const clearUndoStatus = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoTaskStatus(null)
  }

  const handleTaskStatusChange = async (
    task: Task,
    status: Task['status'],
    offerUndo = true,
  ) => {
    if (status === task.status) return
    setErrorMsg('')
    setSuccessMsg('')
    clearUndoStatus()
    setSavingTaskId(task.id)
    setTasks((currentTasks) => currentTasks.map((currentTask) => (
      currentTask.id === task.id ? { ...currentTask, status } : currentTask
    )))
    setSelectedTask((currentTask) => (
      currentTask?.id === task.id ? { ...currentTask, status } : currentTask
    ))

    try {
      const { data, error } = await supabase
        .from('tasks')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .select('id')
        .single()

      if (error || !data) throw error || new Error('Task non trovato')

      if (status === 'done' && offerUndo) {
        setSuccessMsg('Task completato.')
        setUndoTaskStatus({
          taskId: task.id,
          title: task.title,
          previousStatus: task.status,
        })
        undoTimerRef.current = setTimeout(() => {
          setUndoTaskStatus(null)
          undoTimerRef.current = null
        }, 7000)
      } else {
        setSuccessMsg(offerUndo ? 'Stato aggiornato.' : 'Completamento annullato.')
      }
    } catch (error) {
      setErrorMsg(
        `Non sono riuscito ad aggiornare lo stato: ${
          error instanceof Error ? error.message : 'riprova tra poco'
        }`
      )
      await loadData()
    } finally {
      setSavingTaskId(null)
    }
  }

  const handleUndoTaskStatus = async () => {
    if (!undoTaskStatus) return
    const task = tasks.find((currentTask) => currentTask.id === undoTaskStatus.taskId)
    if (!task) {
      clearUndoStatus()
      return
    }
    const previousStatus = undoTaskStatus.previousStatus
    clearUndoStatus()
    await handleTaskStatusChange(task, previousStatus, false)
  }

  const handleTaskProjectChange = async (task: Task, projectId: string) => {
    if (projectId === task.project_id) return
    const targetProject = projects.find((project) => project.id === projectId)
    if (!targetProject) {
      setErrorMsg('Il progetto selezionato non è più disponibile.')
      return
    }

    setErrorMsg('')
    setSuccessMsg('')
    setSavingTaskId(task.id)
    const assigneeIsParticipant = !task.assignee_id || getProjectParticipants(projectId)
      .some((person) => person.id === task.assignee_id)
    const nextAssigneeId = assigneeIsParticipant ? task.assignee_id || null : null

    setTasks((currentTasks) => currentTasks.map((currentTask) => (
      currentTask.id === task.id
        ? { ...currentTask, project_id: projectId, assignee_id: nextAssigneeId }
        : currentTask
    )))
    setSelectedTask((currentTask) => (
      currentTask?.id === task.id
        ? { ...currentTask, project_id: projectId, assignee_id: nextAssigneeId }
        : currentTask
    ))

    try {
      const { data, error } = await supabase
        .from('tasks')
        .update({
          project_id: projectId,
          assignee_id: nextAssigneeId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .select('id')
        .single()

      if (error || !data) throw error || new Error('Task non trovato')
      setSuccessMsg(
        assigneeIsParticipant
          ? `Task spostato in “${targetProject.name}”.`
          : `Task spostato in “${targetProject.name}”. L’assegnatario è stato rimosso perché non partecipa al nuovo progetto.`
      )
    } catch (error) {
      setErrorMsg(
        `Non sono riuscito a cambiare progetto: ${
          error instanceof Error ? error.message : 'riprova tra poco'
        }`
      )
      await loadData()
    } finally {
      setSavingTaskId(null)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p>Caricamento...</p></div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        email={user?.email}
        fullName={profile?.full_name}
        isAdmin={profile?.role === 'admin'}
        current="dashboard"
        onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{errorMsg}</div>
        )}
        {successMsg && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-100 p-3 text-sm text-green-700">
            <span>{successMsg}</span>
            {undoTaskStatus && (
              <button
                type="button"
                onClick={() => void handleUndoTaskStatus()}
                className="rounded-md bg-white px-3 py-1.5 font-semibold text-green-800 shadow-sm hover:bg-green-50"
              >
                Annulla completamento di “{undoTaskStatus.title}”
              </button>
            )}
          </div>
        )}

        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold">I tuoi Progetti</h2>
          <div className="flex gap-3">
            {projects.length > 0 && (
              <button onClick={() => { setTProject(projects[0].id); setTAssignee(''); setShowTaskModal(true) }} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">+ Nuovo Task</button>
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
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setAssigneeFilter(assigneeFilter === 'mine' ? 'all' : 'mine')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${assigneeFilter === 'mine' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  I miei task
                </button>
                <button type="button" onClick={() => setAssigneeFilter(assigneeFilter === 'unassigned' ? 'all' : 'unassigned')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${assigneeFilter === 'unassigned' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Non assegnati
                </button>
                <button type="button" onClick={() => setDueFilter(dueFilter === 'overdue' ? 'all' : 'overdue')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${dueFilter === 'overdue' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Scaduti
                </button>
                <button type="button" onClick={() => setDueFilter(dueFilter === 'upcoming' ? 'all' : 'upcoming')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${dueFilter === 'upcoming' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Prossimi 7 giorni
                </button>
                <label className="ml-auto flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={showCompleted} onChange={(event) => { setShowCompleted(event.target.checked); if (!event.target.checked && statusFilter === 'done') setStatusFilter('all') }} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                  Mostra completati
                </label>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
                <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" aria-label="Filtra per progetto">
                  <option value="all">Tutti i progetti</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'all' | Task['priority'])} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" aria-label="Filtra per priorità">
                  <option value="all">Tutte le priorità</option>
                  <option value="urgent">Urgente</option>
                  <option value="high">Alta</option>
                  <option value="medium">Normale</option>
                  <option value="low">Bassa</option>
                </select>
                <select value={statusFilter} onChange={(event) => { const nextStatus = event.target.value as 'all' | Task['status']; setStatusFilter(nextStatus); if (nextStatus === 'done') setShowCompleted(true) }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" aria-label="Filtra per stato">
                  <option value="all">Tutti gli stati attivi</option>
                  <option value="todo">Da fare</option>
                  <option value="in_progress">In corso</option>
                  <option value="done">Completati</option>
                </select>
                <button type="button" onClick={() => { setAssigneeFilter('all'); setDueFilter('all'); setProjectFilter('all'); setPriorityFilter('all'); setStatusFilter('all'); setShowCompleted(false) }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  Ripristina filtri
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-500">{visibleTasks.length} task visualizzati · per impostazione iniziale i completati sono nascosti</p>
            </div>
            <div className="mb-3 flex justify-end">
              <div
                className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1"
                role="group"
                aria-label="Modalità di pianificazione"
              >
                <button
                  type="button"
                  onClick={() => setPlanningView('gantt')}
                  aria-pressed={planningView === 'gantt'}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    planningView === 'gantt'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Gantt compatto
                </button>
                <button
                  type="button"
                  onClick={() => setPlanningView('deadlines')}
                  aria-pressed={planningView === 'deadlines'}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    planningView === 'deadlines'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Lista scadenze
                </button>
              </div>
            </div>

            {planningView === 'gantt' ? (
              <GanttChart
                projects={ganttProjects}
                tasks={visibleTasks}
                collapsedProjectIds={collapsedProjectIds}
                onProjectClick={(project) => {
                  if (project.is_personal) {
                    setSuccessMsg('L’Inbox personale è privata e raccoglie i task ancora da classificare.')
                    return
                  }
                  void openShare(project)
                }}
                onProjectToggle={(projectId) => setCollapsedProjectIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])}
                onCollapseAll={() => setCollapsedProjectIds(ganttProjects.map((project) => project.id))}
                onExpandAll={() => setCollapsedProjectIds([])}
                onTaskClick={setSelectedTask}
                onTaskDateChange={handleTaskDateChange}
                savingTaskId={savingTaskId}
              />
            ) : (
              <DeadlineTable
                projects={projects}
                tasks={visibleTasks}
                users={teamUsers}
                onTaskClick={setSelectedTask}
                onTaskDueDateChange={handleTaskDueDateChange}
                onTaskProjectChange={handleTaskProjectChange}
                onTaskStatusChange={handleTaskStatusChange}
                savingTaskId={savingTaskId}
              />
            )}
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
                <select value={tProject} onChange={e => { setTProject(e.target.value); setTAssignee('') }} className="w-full px-3 py-2 border rounded-md" required>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Assegnatario</label>
                <select value={tAssignee} onChange={e => setTAssignee(e.target.value)} className="w-full px-3 py-2 border rounded-md">
                  <option value="">Non assegnato</option>
                  {getProjectParticipants(tProject).map((person) => (
                    <option key={person.id} value={person.id}>{person.full_name || person.email}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">Puoi scegliere solo tra i partecipanti del progetto.</p>
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
                <select value={tPriority} onChange={e => setTPriority(e.target.value as Task['priority'])} className="w-full px-3 py-2 border rounded-md">
                  <option value="low">Bassa</option>
                  <option value="medium">Normale</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
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

      {/* Pannello laterale progetto */}
      {shareProject && selectedProject && (
        <div className="fixed inset-0 z-50 bg-slate-950/30" onMouseDown={() => { setShareProject(null); setSelectedProject(null) }}>
          <aside className="ml-auto h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Progetto</p>
                <h3 className="text-xl font-bold text-gray-900">Dettagli e condivisione</h3>
              </div>
              <button type="button" onClick={() => { setShareProject(null); setSelectedProject(null) }} className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100" aria-label="Chiudi pannello">✕</button>
            </div>

            <form onSubmit={handleSaveProject} className="space-y-5 p-6">
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Titolo</span>
                <input value={selectedProject.name} onChange={(event) => setSelectedProject({ ...selectedProject, name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Descrizione</span>
                <textarea value={selectedProject.description || ''} onChange={(event) => setSelectedProject({ ...selectedProject, description: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={4} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Data inizio</span>
                  <input type="date" value={selectedProject.start_date} onChange={(event) => setSelectedProject({ ...selectedProject, start_date: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Data fine</span>
                  <input type="date" value={selectedProject.end_date} onChange={(event) => setSelectedProject({ ...selectedProject, end_date: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
                </label>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Owner</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {teamUsers.find((person) => person.id === selectedProject.owner_id)?.full_name || teamUsers.find((person) => person.id === selectedProject.owner_id)?.email || 'Non disponibile'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Solo un amministratore può trasferire la proprietà.</p>
                </div>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Colore</span>
                  <input type="color" value={selectedProject.color || '#3b82f6'} onChange={(event) => setSelectedProject({ ...selectedProject, color: event.target.value })} className="mt-1 h-12 w-16 rounded border border-gray-300 bg-white p-1" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-2xl font-bold text-gray-900">{tasks.filter((task) => task.project_id === selectedProject.id).length}</p>
                  <p className="text-xs text-gray-500">Task totali</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-2xl font-bold text-green-600">{tasks.filter((task) => task.project_id === selectedProject.id && task.status === 'done').length}</p>
                  <p className="text-xs text-gray-500">Completati</p>
                </div>
              </div>
              <button type="submit" className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700">Salva progetto</button>
            </form>

            <div className="border-t border-gray-200 p-6">
              <h4 className="font-semibold text-gray-900">Condivisione</h4>
              <p className="mt-1 text-sm text-gray-500">Invita un collega già registrato in TaskFlow.</p>
              <form onSubmit={handleShare} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input type="email" value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="email@collega.it" className="min-w-0 rounded-lg border border-gray-300 px-3 py-2" required />
                <select value={shareRole} onChange={e => setShareRole(e.target.value as 'member' | 'co-owner')} className="rounded-lg border border-gray-300 px-2 py-2">
                  <option value="member">Membro</option>
                  <option value="co-owner">Co-owner</option>
                </select>
                <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">Invita</button>
              </form>
              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                {members.length === 0 && <p className="text-sm text-gray-400">Nessun altro membro.</p>}
                {members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{member.users?.full_name || member.users?.email}</p>
                      <p className="truncate text-xs text-gray-500">{member.users?.email} · {member.role}</p>
                    </div>
                    <button type="button" onClick={() => handleRemoveMember(member.id)} className="text-sm font-medium text-red-600 hover:underline">Rimuovi</button>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Pannello laterale task */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/30" onMouseDown={() => setSelectedTask(null)}>
          <aside className="ml-auto h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-green-600">Task</p>
                <h3 className="text-xl font-bold text-gray-900">Dettagli attività</h3>
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100" aria-label="Chiudi pannello">✕</button>
            </div>

            <form onSubmit={handleSaveTask} className="space-y-5 p-6">
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Titolo</span>
                <input value={selectedTask.title} onChange={(event) => setSelectedTask({ ...selectedTask, title: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Descrizione</span>
                <textarea value={selectedTask.description || ''} onChange={(event) => setSelectedTask({ ...selectedTask, description: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={5} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Progetto</span>
                <select value={selectedTask.project_id} onChange={(event) => setSelectedTask({ ...selectedTask, project_id: event.target.value, assignee_id: undefined })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Assegnatario</span>
                <select value={selectedTask.assignee_id || ''} onChange={(event) => setSelectedTask({ ...selectedTask, assignee_id: event.target.value || undefined })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                  <option value="">Non assegnato</option>
                  {getProjectParticipants(selectedTask.project_id).map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Stato</span>
                  <select value={selectedTask.status} onChange={(event) => setSelectedTask({ ...selectedTask, status: event.target.value as Task['status'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                    <option value="todo">Da fare</option>
                    <option value="in_progress">In corso</option>
                    <option value="done">Completato</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Priorità</span>
                  <select value={selectedTask.priority} onChange={(event) => setSelectedTask({ ...selectedTask, priority: event.target.value as Task['priority'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                    <option value="urgent">Urgente</option>
                    <option value="high">Alta</option>
                    <option value="medium">Normale</option>
                    <option value="low">Bassa</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Data inizio</span>
                  <input type="date" value={selectedTask.start_date} onChange={(event) => setSelectedTask({ ...selectedTask, start_date: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Scadenza</span>
                  <input type="date" value={selectedTask.due_date} onChange={(event) => setSelectedTask({ ...selectedTask, due_date: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" required />
                </label>
              </div>
              {selectedTask.email_origin && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">Origine: {selectedTask.email_origin}</div>
              )}
              <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                Creato il {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(selectedTask.created_at))} · ultimo aggiornamento {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectedTask.updated_at))}
              </div>
              <button type="submit" className="w-full rounded-lg bg-green-600 px-4 py-2.5 font-semibold text-white hover:bg-green-700">Salva task</button>
            </form>
          </aside>
        </div>
      )}
    </div>
  )
}
