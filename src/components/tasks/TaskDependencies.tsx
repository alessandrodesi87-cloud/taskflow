'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Task } from '@/types'

type Dependency = {
  id: string
  project_id: string
  task_id: string
  depends_on_task_id: string
}

interface TaskDependenciesProps {
  task: Task
  tasks: Task[]
}

export default function TaskDependencies({ task, tasks }: TaskDependenciesProps) {
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_dependencies')
      .select('id, project_id, task_id, depends_on_task_id')
      .eq('project_id', task.project_id)
    if (error) {
      setMessage(`Dipendenze non disponibili: ${error.message}`)
      return
    }
    setDependencies((data || []) as Dependency[])
    setMessage('')
  }, [task.project_id])

  useEffect(() => { void reload() }, [reload])

  const taskById = useMemo(() => new Map(tasks.map((item) => [item.id, item])), [tasks])
  const predecessors = dependencies.filter((item) => item.task_id === task.id)
  const dependents = dependencies.filter((item) => item.depends_on_task_id === task.id)
  const linkedIds = new Set(dependencies.filter((item) => item.task_id === task.id).map((item) => item.depends_on_task_id))
  const candidates = tasks.filter((item) => item.project_id === task.project_id && item.id !== task.id && !linkedIds.has(item.id))

  const add = async () => {
    if (!choice) return
    setBusy(true)
    setMessage('')
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('task_dependencies').insert({
      project_id: task.project_id,
      task_id: task.id,
      depends_on_task_id: choice,
      created_by: user?.id,
    })
    if (error) {
      setMessage(error.message.includes('cycle_not_allowed')
        ? 'Dipendenza non valida: creerebbe un ciclo tra task.'
        : error.message.includes('same_project')
          ? 'Puoi collegare solo task dello stesso progetto.'
          : `Non sono riuscito ad aggiungere la dipendenza: ${error.message}`)
    } else {
      setChoice('')
      await reload()
    }
    setBusy(false)
  }

  const remove = async (id: string) => {
    setBusy(true)
    const { error } = await supabase.from('task_dependencies').delete().eq('id', id)
    if (error) setMessage(`Non sono riuscito a rimuovere la dipendenza: ${error.message}`)
    else await reload()
    setBusy(false)
  }

  const dateWarning = (predecessor: Task | undefined) => Boolean(
    predecessor?.due_date && task.due_date && task.due_date < predecessor.due_date
  )

  return (
    <section className="rounded-lg border border-slate-200 p-4" aria-label="Dipendenze tra task">
      <h4 className="text-sm font-semibold text-slate-800">Dipendenze</h4>
      <p className="mt-1 text-xs text-slate-500">“Dipende da” indica un prerequisito; “È prerequisito per” mostra i task che vengono dopo.</p>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dipende da</p>
        {predecessors.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nessun prerequisito collegato.</p> : (
          <ul className="mt-1 space-y-2">
            {predecessors.map((item) => {
              const predecessor = taskById.get(item.depends_on_task_id)
              const warning = dateWarning(predecessor)
              return <li key={item.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="text-slate-800">{predecessor?.title || 'Task non disponibile'}</span>
                  {warning && <span className="mt-0.5 block text-xs font-medium text-amber-700">Scadenza incoerente: questo task scade prima del prerequisito.</span>}
                </span>
                <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="shrink-0 text-xs text-red-700 hover:underline">Rimuovi</button>
              </li>
            })}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">È prerequisito per</p>
        {dependents.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nessun task successivo collegato.</p> : (
          <ul className="mt-1 space-y-1">{dependents.map((item) => <li key={item.id} className="text-sm text-slate-700">{taskById.get(item.task_id)?.title || 'Task non disponibile'}</li>)}</ul>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select aria-label="Seleziona il prerequisito" value={choice} onChange={(event) => setChoice(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">Seleziona un task prerequisito…</option>
          {candidates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" disabled={!choice || busy} onClick={() => void add()} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Aggiungi</button>
      </div>
      {message && <p role="status" className="mt-2 text-xs text-amber-800">{message}</p>}
    </section>
  )
}
