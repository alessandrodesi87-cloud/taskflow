'use client'

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { addDays, format, isValid, parseISO, startOfDay } from 'date-fns'
import { it } from 'date-fns/locale'
import { RotateCcw, Search, X } from 'lucide-react'
import { Project, Task } from '@/types'

interface TeamUser {
  id: string
  email?: string
  full_name?: string
}

interface DeadlineTableProps {
  projects: Project[]
  tasks: Task[]
  allTasks?: Task[]
  users: TeamUser[]
  userId?: string
  getProjectParticipants?: (projectId: string) => TeamUser[]
  onTaskClick?: (task: Task) => void
  onTaskDueDateChange?: (task: Task, dueDate: string) => void | Promise<void>
  onTaskProjectChange?: (task: Task, projectId: string) => void | Promise<void>
  onTaskStatusChange?: (task: Task, status: Task['status']) => void | Promise<void>
  onTaskAssigneeChange?: (task: Task, assigneeId: string | null) => void | Promise<void>
  savingTaskId?: string | null
}

type DueState = 'overdue' | 'today' | 'soon' | 'future' | 'none' | 'done'
type ColumnId = 'project' | 'title' | 'dueDate' | 'status' | 'assignee'

interface ColumnConfig {
  id: ColumnId
  label: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
}

interface ResizeState {
  columnId: ColumnId
  pointerId: number
  startWidth: number
  startX: number
}

const COLUMN_STORAGE_VERSION = 1
const columnConfigs: ColumnConfig[] = [
  { id: 'project', label: 'Progetto', defaultWidth: 220, minWidth: 150, maxWidth: 420 },
  { id: 'title', label: 'Titolo', defaultWidth: 320, minWidth: 190, maxWidth: 720 },
  { id: 'dueDate', label: 'Scadenza', defaultWidth: 190, minWidth: 150, maxWidth: 320 },
  { id: 'status', label: 'Stato', defaultWidth: 150, minWidth: 120, maxWidth: 240 },
  { id: 'assignee', label: 'In carico a', defaultWidth: 210, minWidth: 160, maxWidth: 360 },
]
const defaultColumnWidths = Object.fromEntries(
  columnConfigs.map((column) => [column.id, column.defaultWidth])
) as Record<ColumnId, number>

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

function normalizeSearchValue(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it')
    .trim()
}

function clampColumnWidth(columnId: ColumnId, width: number) {
  const config = columnConfigs.find((column) => column.id === columnId)
  if (!config) return width
  return Math.min(config.maxWidth, Math.max(config.minWidth, Math.round(width)))
}

function parseStoredColumnWidths(rawValue: string | null) {
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as {
      version?: number
      widths?: Partial<Record<ColumnId, unknown>>
    }
    if (parsed.version !== COLUMN_STORAGE_VERSION || !parsed.widths) return null

    return columnConfigs.reduce((widths, column) => {
      const storedWidth = parsed.widths?.[column.id]
      widths[column.id] = typeof storedWidth === 'number' && Number.isFinite(storedWidth)
        ? clampColumnWidth(column.id, storedWidth)
        : column.defaultWidth
      return widths
    }, { ...defaultColumnWidths })
  } catch {
    return null
  }
}

export default function DeadlineTable({
  projects,
  tasks,
  allTasks,
  users,
  userId,
  getProjectParticipants,
  onTaskClick,
  onTaskDueDateChange,
  onTaskProjectChange,
  onTaskStatusChange,
  onTaskAssigneeChange,
  savingTaskId,
}: DeadlineTableProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [draftDueDate, setDraftDueDate] = useState('')
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(
    defaultColumnWidths
  )
  const highlightTimerRef = useRef<number | null>(null)
  const columnWidthsRef = useRef(columnWidths)
  const resizeStateRef = useRef<ResizeState | null>(null)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const today = useMemo(() => startOfDay(new Date()), [])
  const todayKey = format(today, 'yyyy-MM-dd')
  const weekKey = format(addDays(today, 7), 'yyyy-MM-dd')

  const columnStorageKey = userId
    ? `taskflow:deadline-columns:v${COLUMN_STORAGE_VERSION}:${userId}`
    : null

  useEffect(() => {
    columnWidthsRef.current = columnWidths
  }, [columnWidths])

  useEffect(() => {
    if (!columnStorageKey) {
      setColumnWidths(defaultColumnWidths)
      return
    }

    const storedWidths = parseStoredColumnWidths(window.localStorage.getItem(columnStorageKey))
    setColumnWidths(storedWidths || defaultColumnWidths)
    columnWidthsRef.current = storedWidths || defaultColumnWidths
  }, [columnStorageKey])

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
  const participantsByProjectId = useMemo(() => new Map(
    projects.map((project) => {
      const participants = getProjectParticipants?.(project.id) || users
      return [project.id, [...participants].sort((first, second) => (
        getDisplayName(first).localeCompare(getDisplayName(second), 'it')
      ))]
    })
  ), [getProjectParticipants, projects, users])
  const normalizedSearchQuery = normalizeSearchValue(deferredSearchQuery)
  const searchedTasks = useMemo(() => {
    const sourceTasks = normalizedSearchQuery ? (allTasks || tasks) : tasks
    if (!normalizedSearchQuery) return sourceTasks

    return sourceTasks.filter((task) => {
      const project = projectById.get(task.project_id)
      const assignee = task.assignee_id ? userById.get(task.assignee_id) : undefined
      return [
        task.title,
        task.description,
        project?.name,
        assignee?.full_name,
        assignee?.email,
      ].some((value) => normalizeSearchValue(value).includes(normalizedSearchQuery))
    })
  }, [allTasks, normalizedSearchQuery, projectById, tasks, userById])
  const orderedTasks = useMemo(
    () => [...searchedTasks].sort((firstTask, secondTask) => {
      if (!firstTask.due_date && !secondTask.due_date) {
        return firstTask.title.localeCompare(secondTask.title, 'it')
      }
      if (!firstTask.due_date) return 1
      if (!secondTask.due_date) return -1
      return firstTask.due_date.localeCompare(secondTask.due_date)
        || firstTask.title.localeCompare(secondTask.title, 'it')
    }),
    [searchedTasks]
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
    if (!parseTaskDate(dueDate) || dueDate === task.due_date) {
      setEditingTaskId(null)
      return
    }

    setEditingTaskId(null)
    highlightTask(task.id)
    await onTaskDueDateChange?.(task, dueDate)
  }

  const beginDateEdit = (task: Task) => {
    setDraftDueDate(task.due_date)
    setEditingTaskId(task.id)
  }

  const cancelDateEdit = () => {
    setDraftDueDate('')
    setEditingTaskId(null)
  }

  const confirmDateEdit = (task: Task) => {
    if (!parseTaskDate(draftDueDate)) return
    void updateDueDate(task, draftDueDate)
  }

  const handleDateKeyDown = (event: KeyboardEvent<HTMLInputElement>, task: Task) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelDateEdit()
    }
    if (event.key === 'Enter' && parseTaskDate(draftDueDate)) {
      event.preventDefault()
      confirmDateEdit(task)
    }
  }

  const persistColumnWidths = (widths: Record<ColumnId, number>) => {
    if (!columnStorageKey) return
    window.localStorage.setItem(columnStorageKey, JSON.stringify({
      version: COLUMN_STORAGE_VERSION,
      widths,
    }))
  }

  const updateColumnWidth = (columnId: ColumnId, width: number, persist = false) => {
    const nextWidths = {
      ...columnWidthsRef.current,
      [columnId]: clampColumnWidth(columnId, width),
    }
    columnWidthsRef.current = nextWidths
    setColumnWidths(nextWidths)
    if (persist) persistColumnWidths(nextWidths)
  }

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLSpanElement>,
    columnId: ColumnId,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStateRef.current = {
      columnId,
      pointerId: event.pointerId,
      startWidth: columnWidthsRef.current[columnId],
      startX: event.clientX,
    }
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return
    updateColumnWidth(
      resizeState.columnId,
      resizeState.startWidth + event.clientX - resizeState.startX,
    )
  }

  const handleResizePointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeStateRef.current = null
    persistColumnWidths(columnWidthsRef.current)
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLSpanElement>, columnId: ColumnId) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    updateColumnWidth(columnId, columnWidthsRef.current[columnId] + direction * 16, true)
  }

  const resetColumnWidths = () => {
    const nextWidths = { ...defaultColumnWidths }
    columnWidthsRef.current = nextWidths
    setColumnWidths(nextWidths)
    persistColumnWidths(nextWidths)
  }

  const renderResizeHandle = (columnId: ColumnId) => {
    const config = columnConfigs.find((column) => column.id === columnId)!
    return (
      <span
        role="separator"
        aria-label={`Ridimensiona colonna ${config.label}`}
        aria-orientation="vertical"
        aria-valuemin={config.minWidth}
        aria-valuemax={config.maxWidth}
        aria-valuenow={columnWidths[columnId]}
        tabIndex={0}
        title="Trascina per ridimensionare. Usa le frecce da tastiera."
        onPointerDown={(event) => handleResizePointerDown(event, columnId)}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        onKeyDown={(event) => handleResizeKeyDown(event, columnId)}
        onDoubleClick={() => updateColumnWidth(columnId, config.defaultWidth, true)}
        className="group absolute inset-y-0 right-0 z-10 w-3 cursor-col-resize touch-none select-none outline-none"
      >
        <span className="absolute inset-y-2 right-1 w-px bg-slate-200 transition-colors group-hover:bg-blue-500 group-focus:bg-blue-500" />
      </span>
    )
  }

  const tableWidth = columnConfigs.reduce(
    (total, column) => total + columnWidths[column.id],
    0
  )
  const isSearching = Boolean(searchQuery.trim())

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="font-semibold text-slate-900">Lista scadenze</h3>
          <p className="text-xs text-slate-500">
            Ordinamento globale: prima le scadenze più vicine, senza raggruppamento per progetto
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-2">
          <p className="text-xs font-medium text-slate-500" aria-live="polite">
            {dueCounts.overdue} scaduti · {dueCounts.today} oggi · {orderedTasks.length} task
          </p>
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            <label className="relative min-w-[230px] flex-1 sm:flex-none">
              <span className="sr-only">Cerca task</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Cerca task, progetto o persona"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-8 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Cancella ricerca"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={resetColumnWidths}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              title="Ripristina le larghezze iniziali"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Ripristina colonne
            </button>
          </div>
        </div>
      </div>

      {isSearching && (
        <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700">
          La ricerca include anche i task completati o nascosti dai filtri della dashboard.
        </div>
      )}

      {orderedTasks.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          {isSearching
            ? `Nessun task trovato per “${searchQuery.trim()}”.`
            : 'Nessun task corrisponde ai filtri selezionati.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="table-fixed border-collapse text-sm"
            style={{ width: `${tableWidth}px`, minWidth: '100%' }}
          >
            <colgroup>
              {columnConfigs.map((column) => (
                <col key={column.id} style={{ width: `${columnWidths[column.id]}px` }} />
              ))}
            </colgroup>
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className="relative border-b border-slate-200 px-4 py-3">
                  Progetto
                  {renderResizeHandle('project')}
                </th>
                <th scope="col" className="relative border-b border-slate-200 px-4 py-3">
                  Titolo
                  {renderResizeHandle('title')}
                </th>
                <th scope="col" aria-sort="ascending" className="relative border-b border-slate-200 px-4 py-3">
                  Scadenza ↑
                  {renderResizeHandle('dueDate')}
                </th>
                <th scope="col" className="relative border-b border-slate-200 px-4 py-3">
                  Stato
                  {renderResizeHandle('status')}
                </th>
                <th scope="col" className="relative border-b border-slate-200 px-4 py-3">
                  In carico a
                  {renderResizeHandle('assignee')}
                </th>
              </tr>
            </thead>
            <tbody>
              {orderedTasks.map((task) => {
                const project = projectById.get(task.project_id)
                const assignee = task.assignee_id ? userById.get(task.assignee_id) : undefined
                const dueState = getDueState(task, todayKey, weekKey)
                const isSaving = savingTaskId === task.id
                const isHighlighted = highlightedTaskId === task.id
                const participantOptions = participantsByProjectId.get(task.project_id) || users
                const assigneeOptions = assignee && !participantOptions.some((user) => user.id === assignee.id)
                  ? [...participantOptions, assignee]
                  : participantOptions

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
                        <div className="flex min-w-[260px] items-center gap-1.5">
                          <input
                            type="date"
                            value={draftDueDate}
                            min="2000-01-01"
                            autoFocus
                            onChange={(event) => setDraftDueDate(event.target.value)}
                            onKeyDown={(event) => handleDateKeyDown(event, task)}
                            className="w-[145px] rounded-lg border border-blue-500 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none ring-2 ring-blue-100"
                            aria-label={`Nuova scadenza per ${task.title}`}
                          />
                          <button
                            type="button"
                            onClick={() => confirmDateEdit(task)}
                            disabled={!parseTaskDate(draftDueDate)}
                            className="rounded-md bg-[#0b2f57] px-2 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Salva
                          </button>
                          <button
                            type="button"
                            onClick={cancelDateEdit}
                            className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
                          >
                            Annulla
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => beginDateEdit(task)}
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
                        <select
                          value={task.assignee_id || ''}
                          onChange={(event) => {
                            highlightTask(task.id)
                            void onTaskAssigneeChange?.(task, event.target.value || null)
                          }}
                          disabled={!onTaskAssigneeChange || isSaving}
                          className="min-w-0 flex-1 truncate rounded-lg border border-transparent bg-transparent px-1 py-1.5 text-sm text-slate-700 hover:border-slate-200 hover:bg-white disabled:cursor-wait disabled:opacity-60"
                          aria-label={`Cambia assegnatario per ${task.title}`}
                          title={getDisplayName(assignee)}
                        >
                          <option value="">Non assegnato</option>
                          {assigneeOptions.map((availableUser) => (
                            <option key={availableUser.id} value={availableUser.id}>
                              {getDisplayName(availableUser)}
                            </option>
                          ))}
                        </select>
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
