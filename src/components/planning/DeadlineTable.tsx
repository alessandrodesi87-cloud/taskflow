'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { addDays, format, isValid, parseISO, startOfDay } from 'date-fns'
import { it } from 'date-fns/locale'
import { Project, Task } from '@/types'

interface TeamUser {
  id: string
  email?: string
  full_name?: string
}

interface DeadlineTableProps {
  projects: Project[]
  tasks: Task[]
  users: TeamUser[]
  onTaskClick?: (task: Task) => void
  onTaskDueDateChange?: (task: Task, dueDate: string) => void | Promise<void>
  onTaskProjectChange?: (task: Task, projectId: string) => void | Promise<void>
  onTaskStatusChange?: (task: Task, status: Task['status']) => void | Promise<void>
  savingTaskId?: string | null
}

type DueState = 'overdue' | 'today' | 'soon' | 'future' | 'none' | 'done'

const dueStateClasses: Record<DueState, string> = {
  overdue: 'bg-red-50 text-red-700 hover:bg-red-100',
  today: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
  soon: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  future: 'text-slate-700 hover:bg-slate-100',
  none: 'text-slate-500 hover:bg-slate-100',
  done: 'text-emerald-700 hover:bg-emerald-50',
}

const statusLabels: Record<Task['status'], string> = {
  todo: 'Da fare',
  in_progress: 'In corso',
  done: 'Completato',
}

const statusClasses: Record<Task['status'], string> = {
  todo: 'border-slate-200 bg-slate-50 text-slate-700',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

function parseTaskDate(value: string) {
  if (!value) return null
  const date = parseISO(value)
  return isValid(date) ? startOfDay(date) : null
}

function getDueState(task: Task, todayKey: string, weekKey: string): DueState {
  if (task.status === 'done') return 'done'
  if (!task.due_date) return 'none'
  if (task.due_date < todayKey) return 'overdue'
  if (task.due_date === todayKey) return 'today'
  if (task.due_date <= weekKey) return 'soon'
  return 'future'
}

function formatDueDate(task: Task, dueState: DueState) {
  const date = parseTaskDate(task.due_date)
  if (!date) return 'Senza data'

  const formattedDate = format(date, 'd MMM', { locale: it })
  if (dueState === 'overdue') return `Scaduto · ${formattedDate}`
  if (dueState === 'today') return `Oggi · ${formattedDate}`
  return format(date, 'EEE d MMM', { locale: it })
}

function getDisplayName(user?: TeamUser) {
  return user?.full_name?.trim() || user?.email?.trim() || 'Non assegnato'
}

function getInitials(user?: TeamUser) {
  if (!user) return '—'
  const label = user.full_name?.trim() || user.email?.split('@')[0] || ''
  const parts = label.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export default function DeadlineTable({
  projects,
  tasks,
  users,
  onTaskClick,
  onTaskDueDateChange,
  onTaskProjectChange,
  onTaskStatusChange,
  savingTaskId,
}: DeadlineTableProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const today = useMemo(() => startOfDay(new Date()), [])
  const todayKey = format(today, 'yyyy-MM-dd')
  const weekKey = format(addDays(today, 7), 'yyyy-MM-dd')

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
    }
  }, [])

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const userById = useMemo(
    () => new Map(users.map((teamUser) => [teamUser.id, teamUser])),
    [users]
  )
  const orderedTasks = useMemo(
    () => [...tasks].sort((firstTask, secondTask) => {
      if (!firstTask.due_date && !secondTask.due_date) {
        return firstTask.title.localeCompare(secondTask.title, 'it')
      }
      if (!firstTask.due_date) return 1
      if (!secondTask.due_date) return -1
      return firstTask.due_date.localeCompare(secondTask.due_date)
        || firstTask.title.localeCompare(secondTask.title, 'it')
    }),
    [tasks]
  )

  const dueCounts = useMemo(() => orderedTasks.reduce(
    (counts, task) => {
      const dueState = getDueState(task, todayKey, weekKey)
      if (dueState === 'overdue') counts.overdue += 1
      if (dueState === 'today') counts.today += 1
      return counts
    },
    { overdue: 0, today: 0 }
  ), [orderedTasks, todayKey, weekKey])

  const closeDateEditor = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setEditingTaskId(null)
    }
  }

  const highlightTask = (taskId: string) => {
    setHighlightedTaskId(taskId)
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedTaskId(null)
      highlightTimerRef.current = null
    }, 1600)
  }

  const updateDueDate = async (task: Task, dueDate: string) => {
    if (!dueDate || dueDate === task.due_date) {
      setEditingTaskId(null)
      return
    }

    setEditingTaskId(null)
    highlightTask(task.id)
    await onTaskDueDateChange?.(task, dueDate)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="font-semibold text-slate-900">Lista scadenze</h3>
          <p className="text-xs text-slate-500">
            Ordinamento globale: prima le scadenze più vicine, senza raggruppamento per progetto
          </p>
        </div>
        <p className="text-xs font-medium text-slate-500" aria-live="polite">
          {dueCounts.overdue} scaduti · {dueCounts.today} oggi · {orderedTasks.length} task
        </p>
      </div>

      {orderedTasks.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          Nessun task corrisponde ai filtri selezionati.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[30%]" />
              <col className="w-[18%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className="border-b border-slate-200 px-4 py-3">Progetto</th>
                <th scope="col" className="border-b border-slate-200 px-4 py-3">Titolo</th>
                <th scope="col" aria-sort="ascending" className="border-b border-slate-200 px-4 py-3">
                  Scadenza ↑
                </th>
                <th scope="col" className="border-b border-slate-200 px-4 py-3">Stato</th>
                <th scope="col" className="border-b border-slate-200 px-4 py-3">In carico a</th>
              </tr>
            </thead>
            <tbody>
              {orderedTasks.map((task) => {
                const project = projectById.get(task.project_id)
                const assignee = task.assignee_id ? userById.get(task.assignee_id) : undefined
                const dueState = getDueState(task, todayKey, weekKey)
                const isSaving = savingTaskId === task.id
                const isHighlighted = highlightedTaskId === task.id

                return (
                  <tr
                    key={task.id}
                    className={`border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50 ${
                      isHighlighted ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: project?.color || '#94a3b8' }}
                          aria-hidden="true"
                        />
                        <select
                          value={task.project_id}
                          onChange={(event) => {
                            highlightTask(task.id)
                            void onTaskProjectChange?.(task, event.target.value)
                          }}
                          disabled={!onTaskProjectChange || isSaving}
                          className="min-w-0 flex-1 truncate rounded-lg border border-transparent bg-transparent px-1 py-1.5 text-sm text-slate-700 hover:border-slate-200 hover:bg-white disabled:cursor-wait disabled:opacity-60"
                          aria-label={`Cambia progetto per ${task.title}`}
                        >
                          {!project && <option value={task.project_id}>Progetto non disponibile</option>}
                          {projects.map((availableProject) => (
                            <option key={availableProject.id} value={availableProject.id}>
                              {availableProject.name}
                            </option>
                          ))}
                        </select>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => onTaskClick?.(task)}
                        className={`block max-w-full truncate text-left font-medium hover:text-blue-700 ${
                          task.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'
                        }`}
                        title={`${task.title} · Apri dettagli`}
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      {editingTaskId === task.id ? (
                        <input
                          type="date"
                          defaultValue={task.due_date}
                          min="2000-01-01"
                          autoFocus
                          onChange={(event) => void updateDueDate(task, event.target.value)}
                          onBlur={() => setEditingTaskId(null)}
                          onKeyDown={closeDateEditor}
                          className="w-[150px] rounded-lg border border-blue-500 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none ring-2 ring-blue-100"
                          aria-label={`Nuova scadenza per ${task.title}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingTaskId(task.id)}
                          disabled={!onTaskDueDateChange || isSaving}
                          className={`inline-flex min-h-8 items-center rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                            dueStateClasses[dueState]
                          }`}
                          aria-label={`Modifica la scadenza di ${task.title}`}
                        >
                          {isSaving ? 'Salvataggio…' : formatDueDate(task, dueState)}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={task.status}
                        onChange={(event) => {
                          highlightTask(task.id)
                          void onTaskStatusChange?.(task, event.target.value as Task['status'])
                        }}
                        disabled={!onTaskStatusChange || isSaving}
                        className={`w-full rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-60 ${statusClasses[task.status]}`}
                        aria-label={`Cambia stato per ${task.title}`}
                      >
                        {(Object.keys(statusLabels) as Task['status'][]).map((status) => (
                          <option key={status} value={status}>{statusLabels[status]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700"
                          aria-hidden="true"
                        >
                          {getInitials(assignee)}
                        </span>
                        <span className="truncate" title={getDisplayName(assignee)}>
                          {getDisplayName(assignee)}
                        </span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
