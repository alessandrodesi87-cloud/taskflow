'use client'

import { useMemo } from 'react'
import { Project, Task } from '@/types'
import { format, differenceInDays, startOfDay } from 'date-fns'

interface GanttChartProps {
  projects: Project[]
  tasks: Task[]
}

export default function GanttChart({ projects, tasks }: GanttChartProps) {
  const dateRange = useMemo(() => {
    const allDates = [
      ...projects.map(p => new Date(p.start_date)),
      ...projects.map(p => new Date(p.end_date)),
      ...tasks.map(t => new Date(t.start_date)),
      ...tasks.map(t => new Date(t.due_date)),
    ]

    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())))

    return { minDate, maxDate, days: differenceInDays(maxDate, minDate) + 1 }
  }, [projects, tasks])

  const getDayPosition = (date: string) => {
    const targetDate = startOfDay(new Date(date))
    const baseDate = startOfDay(dateRange.minDate)
    return differenceInDays(targetDate, baseDate)
  }

  const getTaskWidth = (task: Task) => {
    const days = differenceInDays(new Date(task.due_date), new Date(task.start_date)) + 1
    return (days / dateRange.days) * 100
  }

  const dayHeaders = useMemo(() => {
    const days = []
    for (let i = 0; i < dateRange.days; i++) {
      const date = new Date(dateRange.minDate)
      date.setDate(date.getDate() + i)
      days.push(date)
    }
    return days
  }, [dateRange])

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        {/* Header with dates */}
        <div className="flex sticky top-0 z-20">
          <div className="w-64 flex-shrink-0 bg-gray-100 border-r border-gray-200 px-4 py-3">
            <h3 className="font-semibold text-sm">Progetti / Task</h3>
          </div>
          <div className="flex flex-1">
            {dayHeaders.map((date, idx) => (
              <div
                key={idx}
                className="flex-1 min-w-[40px] px-1 py-2 text-center text-xs border-r border-gray-200 bg-gray-50"
              >
                <div className="font-semibold">{format(date, 'd')}</div>
                <div className="text-gray-500">{format(date, 'EEE', { locale: { name: 'it' } })}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Projects and tasks */}
        <div>
          {projects.map((project) => {
            const projectTasks = tasks.filter(t => t.project_id === project.id)
            const projectStart = getDayPosition(project.start_date)
            const projectWidth = getTaskWidth(project as any)

            return (
              <div key={project.id}>
                {/* Project row */}
                <div className="flex border-b border-gray-100 hover:bg-gray-50">
                  <div className="w-64 flex-shrink-0 px-4 py-3 border-r border-gray-200 bg-gray-50">
                    <h4 className="font-semibold text-sm">{project.name}</h4>
                    <p className="text-xs text-gray-500">
                      {format(new Date(project.start_date), 'd MMM')} - {format(new Date(project.end_date), 'd MMM')}
                    </p>
                  </div>
                  <div className="flex-1 relative h-12 bg-white">
                    <div
                      className="absolute top-1/2 transform -translate-y-1/2 bg-blue-200 rounded h-6 px-2 flex items-center text-xs font-semibold text-blue-800"
                      style={{
                        left: `${(projectStart / dateRange.days) * 100}%`,
                        width: `${projectWidth}%`,
                      }}
                    >
                      {project.name}
                    </div>
                  </div>
                </div>

                {/* Task rows */}
                {projectTasks.map((task) => {
                  const taskStart = getDayPosition(task.start_date)
                  const taskWidth = getTaskWidth(task)
                  const statusColor = {
                    todo: 'bg-gray-400',
                    in_progress: 'bg-blue-500',
                    done: 'bg-green-500',
                  }[task.status]

                  return (
                    <div key={task.id} className="flex border-b border-gray-100 hover:bg-gray-50">
                      <div className="w-64 flex-shrink-0 px-4 py-3 border-r border-gray-200">
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="text-xs text-gray-500">
                          {format(new Date(task.start_date), 'd MMM')} - {format(new Date(task.due_date), 'd MMM')}
                        </p>
                      </div>
                      <div className="flex-1 relative h-12 bg-white">
                        <div
                          className={`absolute top-1/2 transform -translate-y-1/2 rounded h-6 px-2 flex items-center text-xs font-semibold text-white cursor-pointer hover:shadow-lg transition-all ${statusColor}`}
                          style={{
                            left: `${(taskStart / dateRange.days) * 100}%`,
                            width: `${taskWidth}%`,
                          }}
                          title={task.title}
                        >
                          {task.title}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
