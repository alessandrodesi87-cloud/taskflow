'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { decodeComment, encodeComment, mentionQuery, updateMentions, type Mention } from '@/lib/commentMentions'
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

export default function TaskComments(props: TaskCommentsProps) { return <TaskCommentsPanel key={props.task.id + props.task.project_id + props.userId} {...props} /> }
function TaskCommentsPanel({ task, userId, users }: TaskCommentsProps) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const [members, setMembers] = useState<Array<{ id: string; full_name: string }>>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const query = mentionQuery(draft, caret)
  const suggestions = focused && !dismissed && query && !mentions.some((m) => query.start >= m.start && query.start < m.end)
    ? members.filter((member) => member.full_name.toLocaleLowerCase().includes(query.query.toLocaleLowerCase())) : []
  const body = encodeComment(draft, mentions)

  useEffect(() => {
    let cancelled = false
    const loadMembers = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || !userId) return
        const response = await fetch('/api/tasks/mention-members?taskId=' + encodeURIComponent(task.id), {
          headers: { Authorization: 'Bearer ' + session.access_token }, cache: 'no-store',
        })
        if (!response.ok) throw new Error('members_unavailable')
        const data = await response.json()
        if (!cancelled) setMembers(data.members)
      } catch {
        if (!cancelled) setMembers([])
      }
    }

    void loadMembers()
    return () => { cancelled = true }
  }, [task.id, task.project_id, userId])

  const selectMention = (member: { id: string; full_name: string }) => {
    if (!query) return
    const label = '@' + member.full_name
    const next = draft.slice(0, query.start) + label + ' ' + draft.slice(query.end)
    const nextMentions = [...updateMentions(draft, next, mentions), { start: query.start, end: query.start + label.length, userId: member.id, name: member.full_name }]
    if (encodeComment(next, nextMentions).length > 2000) { setMessage('La menzione supera il limite del commento. Accorcia il testo.'); return }
    setDraft(next)
    setMentions(nextMentions)
    setDismissed(true)
    const position = query.start + label.length + 1
    setCaret(position)
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(position, position) })
  }

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
    if (!userId || !draft.trim() || body.length > 2000 || busy) return
    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('task_comments').insert({
      task_id: task.id,
      project_id: task.project_id,
      author_id: userId,
      body,
    })
    if (error) setMessage(`Non sono riuscito ad aggiungere il commento: ${error.message}`)
    else {
      setDraft('')
      setMentions([])
      setCaret(0)
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
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{decodeComment(comment.body).map((part, index) => part.userId ? <span key={index} data-mention-user-id={part.userId} className="font-medium text-blue-700">{part.text}</span> : part.text)}</p>
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
        <textarea ref={textarea} id={`task-comment-${task.id}`} value={draft} disabled={busy}
          onChange={(event) => { setMentions(updateMentions(draft, event.target.value, mentions)); setDraft(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); setActive(0) }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !suggestions.length) return
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true) }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (value + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length) }
            if (event.key === 'Enter') { event.preventDefault(); selectMention(suggestions[active % suggestions.length]) }
          }}
          aria-autocomplete="list" aria-controls={suggestions.length ? `mentions-${task.id}` : undefined}
          aria-activedescendant={suggestions.length ? `mention-${suggestions[active % suggestions.length].id}` : undefined}
          maxLength={2000} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Scrivi un aggiornamento..." required />
        {suggestions.length > 0 && <ul id={`mentions-${task.id}`} role="listbox" aria-label="Membri del progetto" className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-1">
          {suggestions.map((member, index) => <li key={member.id} id={`mention-${member.id}`} role="option" aria-selected={index === active % suggestions.length} onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(member)} className={`cursor-pointer rounded px-3 py-2 text-sm ${index === active % suggestions.length ? 'bg-blue-50 text-blue-800' : ''}`}>{member.full_name}</li>)}
        </ul>}
        {body.length > 2000 && <p role="status" className="text-xs text-amber-800">Il testo con i riferimenti alle menzioni supera 2000 caratteri. Accorcia il commento.</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{draft.length}/2000</span>
          <button type="submit" disabled={busy || !draft.trim() || body.length > 2000} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Salvataggio...' : 'Commenta'}</button>
        </div>
      </form>
      {message && <p role="status" className="mt-2 text-xs text-amber-800">{message}</p>}
    </section>
  )
}
