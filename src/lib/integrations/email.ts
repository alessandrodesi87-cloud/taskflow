// Email integration with Resend
// This will be used for daily reminders and task notifications

import { Task } from '@/types'
import { supabase } from '@/lib/supabase'

export async function sendDailyReminder(email: string, tasks: Task[]) {
  const today = new Date().toISOString().split('T')[0]
  const dueTodayTasks = tasks.filter(t => t.due_date === today && t.status !== 'done')

  if (dueTodayTasks.length === 0) return

  const emailBody = `
    <h2>I tuoi task in scadenza oggi</h2>
    <ul>
      ${dueTodayTasks.map(t => `
        <li>
          <strong>${t.title}</strong><br/>
          Progetto: ${t.project_id}<br/>
          Priority: ${t.priority}
        </li>
      `).join('')}
    </ul>
    
    <p>Per modificare la scadenza, rispondi a questa email con il formato:</p>
    <code>RESCHEDULE: task-id 2024-08-15</code>
    
    <p>Per marcare come completato:</p>
    <code>DONE: task-id</code>
  `

  try {
    // TODO: Implement Resend email sending
    console.log('Sending email to:', email)
    console.log('Body:', emailBody)
    // const response = await resend.emails.send({
    //   from: 'noreply@taskflow.app',
    //   to: email,
    //   subject: `TaskFlow: ${dueTodayTasks.length} task in scadenza oggi`,
    //   html: emailBody,
    // })
  } catch (error) {
    console.error('Error sending email:', error)
  }
}

// Process email replies with structured format
export async function processEmailReply(from: string, subject: string, body: string) {
  // Parse DONE: task-id or RESCHEDULE: task-id date
  const doneMatch = body.match(/DONE:\s*([a-f0-9-]+)/i)
  const rescheduleMatch = body.match(/RESCHEDULE:\s*([a-f0-9-]+)\s*(\d{4}-\d{2}-\d{2})/i)

  if (doneMatch) {
    const taskId = doneMatch[1]
    await supabase
      .from('tasks')
      .update({ status: 'done' })
      .eq('id', taskId)
  }

  if (rescheduleMatch) {
    const taskId = rescheduleMatch[1]
    const newDate = rescheduleMatch[2]
    await supabase
      .from('tasks')
      .update({ due_date: newDate })
      .eq('id', taskId)
  }
}
