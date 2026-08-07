'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  isWeekend,
  max,
  min,
  parseISO,
  startOfDay,
} from 'date-fns'
import { it } from 'date-fns/locale'
import { Project, Task } from '@/types'

type ZoomMode = 'day' | 'week' | 'month'

interface GanttChartProps {
  projects: Project[]
  tasks: Task[]
  onTaskClick?: (task: Task) => void
}

interface HeaderSegment {
  start: Date
  end: Date
  primaryLabel: string
  secondaryLabel?: string
  isToday: boolean
  isWeekend: boolean
}

interface TimelineLaneProps {
  children: ReactNode
  dayWidth: number
  days: number
  heightClass: string
  weekendIndexes: number[]
  todayIndex?: number
}

const LEFT_COLUMN_WIDTH = 256
const MIN_TIMELINE_WIDTH = 720

const zoomOptions: Array<{
  value: ZoomMode
  label: string
  pixelsPerDay: number
}> = [
  { value: 'day', label: 'Giorno', pixelsPerDay: 44 },
  { value: 'week', label: 'Settimana', pixelsPerDay: 16 },
  { value: 'month', label: 'Mese', pixelsPerDay: 5 },
]

const statusLabels: Record<Task['status'], string> = {
  todo: 'Da fare',
  in_progress: 'In corso',
  done: 'Completato',
}

const statusColors: Record<Task['status'], string> = {
  todo: 'bg-slate-500',
  in_progress: 'bg-blue-600',
  done: 'bg-emerald-600',
}

function parseTaskFlowDate(value: string) {
  const date = parseISO(value)
  return isValid(date) ? startOfDay(date) : null
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function TimelineLane({
  children,
  dayWidth,
  days,
  heightClass,
  weekendIndexes,
  todayIndex,
}: TimelineLaneProps) {
  const gridStyle: CSSProperties = {
    backgroundImage:
      'linear-gradient(to right, rgba(148, 163, 184, 0.24) 1px, transparent 1px)',
    backgroundSize: `${dayWidth}px 100%`,
  }

  return (
    <div
      className={`relative flex-none bg-white ${heightClass}`}
      style={{ ...gridStyle, width: dayWidth * days }}
    >
      {weekendIndexes.map((index) => (
        <div
          key={index}
          className="absolute inset-y-0 bg-slate-50/80"
          style={{ left: index * dayWidth, width: dayWidth }}
        />
      ))}

      {todayIndex !== undefined && (
        <div
          className="absolute inset-y-0 z-[1] w-0.5 bg-rose-400"
          style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
          aria-hidden="true"
        />
      )}

      {children}
    </div>
  )
}

export default function GanttChart({ projects, tasks, onTaskClick }: GanttChartProps) {
  const [zoom, setZoom] = useState<ZoomMode>('week')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => startOfDay(new Date()), [])

  const dateRange = useMemo(() => {
    const dates = [
      ...projects.flatMap((project) => [project.start_date, project.end_date]),
      ...tasks.flatMap((task) => [task.start_date, task.due_date]),
    ]
      .map(parseTaskFlowDate)
      .filter((date): date is Date => date !== null)

    if (dates.length === 0) {
      return { minDate: today, maxDate: today, days: 1 }
    }

    const minDate = min([...dates, today])
    const maxDate = max([...dates, today])

    return {
      minDate,
      maxDate,
      days: Math.max(differenceInCalendarDays(maxDate, minDate) + 1, 1),
    }
  }, [projects, tasks, today])

  const selectedZoom = zoomOptions.find((option) => option.value === zoom) ?? zoomOptions[1]
  const timelineWidth = Math.max(
    dateRange.days * selectedZoom.pixelsPerDay,
    MIN_TIMELINE_WIDTH
  )
  const dayWidth = timelineWidth / dateRange.days

  const headerSegments = useMemo<HeaderSegment[]>(() => {
    const segments: HeaderSegment[] = []
    let cursor = dateRange.minDate

    while (cursor <= dateRange.maxDate) {
      let segmentEnd = cursor

      if (zoom === 'week') {
        segmentEnd = min([
          endOfWeek(cursor, { weekStartsOn: 1 }),
          dateRange.maxDate,
        ])
      }

      if (zoom === 'month') {
        segmentEnd = min([endOfMonth(cursor), dateRange.maxDate])
      }

      const includesToday = today >= cursor && today <= segmentEnd
      let primaryLabel = format(cursor, 'd', { locale: it })
      let secondaryLabel: string | undefined = capitalize(
        format(cursor, 'EEE', { locale: it })
      )

      if (zoom === 'week') {
        primaryLabel = `${format(cursor, 'd MMM', { locale: it })} – ${format(
          segmentEnd,
          'd MMM',
          { locale: it }
        )}`
        secondaryLabel = `Settimana ${format(cursor, 'I')}`
      }

      if (zoom === 'month') {
        primaryLabel = capitalize(format(cursor, 'MMMM yyyy', { locale: it }))
        secondaryLabel = undefined
      }

      segments.push({
        start: cursor,
        end: segmentEnd,
        primaryLabel,
        secondaryLabel,
        isToday: includesToday,
        isWeekend: zoom === 'day' && isWeekend(cursor),
      })

      cursor = addDays(segmentEnd, 1)
    }

    return segments
  }, [dateRange.maxDate, dateRange.minDate, today, zoom])

  const weekendDayIndexes = useMemo(() => {
    if (zoom !== 'day') return []

    return Array.from({ length: dateRange.days }, (_, index) => index).filter((index) =>
      isWeekend(addDays(dateRange.minDate, index))
    )
  }, [dateRange.days, dateRange.minDate, zoom])

  const todayIndex =
    today >= dateRange.minDate && today <= dateRange.maxDate
      ? differenceInCalendarDays(today, dateRange.minDate)
      : undefined

  const getBarPosition = (start: string, end: string) => {
    const startDate = parseTaskFlowDate(start) ?? dateRange.minDate
    const endDate = parseTaskFlowDate(end) ?? startDate
    const startIndex = differenceInCalendarDays(startDate, dateRange.minDate)
    const duration = Math.max(differenceInCalendarDays(endDate, startDate) + 1, 1)

    return {
      left: startIndex * dayWidth,
      width: Math.max(duration * dayWidth, 8),
    }
  }

  const locateToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (todayIndex === undefined || !scrollContainerRef.current) return

    const visibleTimelineWidth = Math.max(
      scrollContainerRef.current.clientWidth - LEFT_COLUMN_WIDTH,
      1
    )
    const target =
      LEFT_COLUMN_WIDTH + todayIndex * dayWidth - visibleTimelineWidth / 2

    scrollContainerRef.current.scrollTo({
      left: Math.max(target, 0),
      behavior,
    })
  }, [dayWidth, todayIndex])

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      locateToday('auto')
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [locateToday])

  const formatRange = (start: string, end: string) => {
    const startDate = parseTaskFlowDate(start)
    const endDate = parseTaskFlowDate(end)

    if (!startDate || !endDate) return 'Date non disponibili'

    return `${format(startDate, 'd MMM', { locale: it })} – ${format(endDate, 'd MMM', {
      locale: it,
    })}`
  }

  const laneWidthStyle = { width: timelineWidth }
  const fullRowStyle = { width: LEFT_COLUMN_WIDTH + timelineWidth }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h3 className="font-semibold text-slate-900">Pianificazione</h3>
          <p className="text-xs text-slate-500">
            {format(dateRange.minDate, 'd MMM yyyy', { locale: it })} –{' '}
            {format(dateRange.maxDate, 'd MMM yyyy', { locale: it })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
            role="group"
            aria-label="Scala temporale"
          >
            {zoomOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setZoom(option.value)}
                aria-pressed={zoom === option.value}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  zoom === option.value
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => locateToday('smooth')}
            disabled={todayIndex === undefined}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              todayIndex === undefined
                ? 'Oggi non rientra nelle date visualizzate'
                : 'Centra la timeline su oggi'
            }
          >
            Oggi
          </button>
        </div>

        <div className="flex w-full flex-wrap items-center gap-4 text-xs text-slate-500">
          {(Object.keys(statusLabels) as Task['status'][]).map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${statusColors[status]}`} />
              {statusLabels[status]}
            </span>
          ))}
          <span className="ml-auto hidden text-slate-400 sm:inline">
            Scorri orizzontalmente per esplorare il periodo
          </span>
        </div>
      </div>

      <div ref={scrollContainerRef} className="overflow-x-auto">
        <div style={fullRowStyle}>
          <div className="sticky top-0 z-30 flex border-b border-slate-200 bg-slate-50">
            <div
              className="sticky left-0 z-30 flex-none border-r border-slate-200 bg-slate-100 px-4 py-3"
              style={{ width: LEFT_COLUMN_WIDTH }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Progetti e attività
              </p>
            </div>

            <div className="flex flex-none" style={laneWidthStyle}>
              {headerSegments.map((segment) => {
                const segmentDays =
                  differenceInCalendarDays(segment.end, segment.start) + 1

                return (
                  <div
                    key={segment.start.toISOString()}
                    className={`flex flex-none flex-col items-center justify-center border-r border-slate-200 px-1 py-2 text-center ${
                      segment.isToday
                        ? 'bg-rose-50 text-rose-700'
                        : segment.isWeekend
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-slate-50 text-slate-700'
                    }`}
                    style={{ width: segmentDays * dayWidth }}
                    title={`${format(segment.start, 'd MMM yyyy', { locale: it })} – ${format(
                      segment.end,
                      'd MMM yyyy',
                      { locale: it }
                    )}`}
                  >
                    <span className="max-w-full truncate text-xs font-semibold">
                      {segment.primaryLabel}
                    </span>
                    {segment.secondaryLabel && (
                      <span className="max-w-full truncate text-[10px] text-slate-500">
                        {segment.secondaryLabel}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {projects.map((project) => {
            const projectTasks = tasks.filter((task) => task.project_id === project.id)
            const projectBar = getBarPosition(project.start_date, project.end_date)

            return (
              <div key={project.id}>
                <div className="flex border-b border-slate-200" style={fullRowStyle}>
                  <div
                    className="sticky left-0 z-10 flex-none border-r border-slate-200 bg-slate-50 px-4 py-3"
                    style={{ width: LEFT_COLUMN_WIDTH }}
                  >
                    <h4 className="truncate text-sm font-semibold text-slate-900" title={project.name}>
                      {project.name}
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatRange(project.start_date, project.end_date)}
                    </p>
                  </div>

                  <TimelineLane
                    dayWidth={dayWidth}
                    days={dateRange.days}
                    heightClass="h-14"
                    weekendIndexes={weekendDayIndexes}
                    todayIndex={todayIndex}
                  >
                    <div
                      className="absolute top-1/2 z-[2] flex h-7 -translate-y-1/2 items-center overflow-hidden rounded-md px-2 text-xs font-semibold text-white shadow-sm"
                      style={{
                        left: projectBar.left,
                        width: projectBar.width,
                        backgroundColor: project.color || '#2563eb',
                      }}
                      title={`${project.name}: ${formatRange(
                        project.start_date,
                        project.end_date
                      )}`}
                    >
                      <span className="truncate">{project.name}</span>
                    </div>
                  </TimelineLane>
                </div>

                {projectTasks.map((task) => {
                  const taskBar = getBarPosition(task.start_date, task.due_date)

                  return (
                    <div
                      key={task.id}
                      className="flex border-b border-slate-100 hover:bg-slate-50/60"
                      style={fullRowStyle}
                    >
                      <div
                        className="sticky left-0 z-10 flex-none border-r border-slate-200 bg-white py-3 pl-8 pr-4"
                        style={{ width: LEFT_COLUMN_WIDTH }}
                      >
                        <p className="truncate text-sm font-medium text-slate-800" title={task.title}>
                          {task.title}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatRange(task.start_date, task.due_date)}
                        </p>
                      </div>

                      <TimelineLane
                        dayWidth={dayWidth}
                        days={dateRange.days}
                        heightClass="h-14"
                        weekendIndexes={weekendDayIndexes}
                        todayIndex={todayIndex}
                      >
                        <button
                          type="button"
                          onClick={() => onTaskClick?.(task)}
                          className={`absolute top-1/2 z-[2] flex h-7 -translate-y-1/2 items-center overflow-hidden rounded-md px-2 text-left text-xs font-semibold text-white shadow-sm transition hover:-translate-y-[55%] hover:shadow-md ${statusColors[task.status]}`}
                          style={{ left: taskBar.left, width: taskBar.width }}
                          title={`${task.title} · ${statusLabels[task.status]} · ${formatRange(
                            task.start_date,
                            task.due_date
                          )}`}
                        >
                          <span className="truncate">{task.title}</span>
                        </button>
                      </TimelineLane>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
