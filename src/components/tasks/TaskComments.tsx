'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Task } from '@/types'

type TaskComment = {
  id: string
  task_id: string
  project_id: string
  author_id: string | null
  body: string
  created_by_assistant: boolean
  approval_status: 'pending' | 'approved'
  created_at: string
}

interface TaskCommentsProps {
  task: Task
  userId?: string
  users: Array<{ id: string; full_name?: string; email?: string }>
}

export default function TaskComments({ task, userId, users }: TaskCommentsProps) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const userNames = useMemo(() => new Map(users.map((person) => [person.id, person.full_name || person.email || 'Utente'])), [users])

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_comments')
      .select('id, task_id, project_id, author_id, body, created_by_assistant, approval_status, created_at')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true })
    if (error) {
      setMessage(`Commenti non disponibili: ${error.message}`)
      return
    }
    setComments((data || []) as TaskComment[])
    setMessage('')
  }, [task.id])

  useEffect(() => { void reload() }, [reload])

  const addComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!userId || !draft.trim()) return
    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('task_comments').insert({
      task_id: task.id,
      project_id: task.project_id,
      author_id: userId,
      body: draft.trim(),
    })
    if (error) setMessage(`Non sono riuscito ad aggiungere il commento: ${error.message}`)
    else {
      setDraft('')
      await reload()
    }
    setBusy(false)
  }

  const approve = async (commentId: string) => {
    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('task_comments').update({ approval_status: 'approved' }).eq('id', commentId)
    if (error) setMessage(`Non sono riuscito ad approvare il commento: ${error.message}`)
    else await reload()
    setBusy(false)
  }

  return (
    <section className="rounded-lg border border-slate-200 p-4" aria-label="Commenti sul task">
      <h4 className="text-sm font-semibold text-slate-800">Commenti</h4>
      {comments.length === 0 ? <p className="mt-2 text-sm text-slate-500">Ancora nessun commento.</p> : (
        <ul className="mt-3 space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{comment.created_by_assistant ? 'Assistente' : userNames.get(comment.author_id || '') || 'Utente'}</span>
                <time dateTime={comment.created_at}>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(comment.created_at))}</time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{comment.body}</p>
              {comment.approval_status === 'pending' && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-amber-700">In attesa della tua approvazione</span>
                  {task.owner_id === userId && <button type="button" disabled={busy} onClick={() => void approve(comment.id)} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Approva</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addComment} className="mt-4 space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor={`task-comment-${task.id}`}>Aggiungi un commento</label>
        <textarea id={`task-comment-${task.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Scrivi un aggiornamento..." required />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{draft.length}/2000</span>
          <button type="submit" disabled={busy || !draft.trim()} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Salvataggio...' : 'Commenta'}</button>
        </div>
      </form>
      {message && <p role="status" className="mt-2 text-xs text-amber-800">{message}</p>}
    </section>
  )
}
