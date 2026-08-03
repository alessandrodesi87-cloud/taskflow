// Telegram Bot integration
// For daily reminders and task management via Telegram

import { Task } from '@/types'
import { supabase } from '@/lib/supabase'

const TELEGRAM_API_URL = 'https://api.telegram.org'
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

export async function sendTelegramReminder(chatId: string, tasks: Task[]) {
  const today = new Date().toISOString().split('T')[0]
  const dueTodayTasks = tasks.filter(t => t.due_date === today && t.status !== 'done')

  if (dueTodayTasks.length === 0) return

  let message = '📋 *TaskFlow - Task in scadenza oggi*\n\n'

  dueTodayTasks.forEach((task, idx) => {
    message += `${idx + 1}. *${task.title}*\n`
    message += `   Priority: ${task.priority}\n`
    message += `   Scadenza: ${task.due_date}\n\n`
  })

  message += '\nKomandi:\n'
  message += '/done task-id - Segna come completato\n'
  message += '/reschedule task-id 2024-08-15 - Modifica scadenza\n'

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to send Telegram message')
    }
  } catch (error) {
    console.error('Error sending Telegram message:', error)
  }
}

interface TelegramUpdate {
  message?: {
    text?: string
    chat: {
      id: number
    }
  }
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const message = update.message
  if (!message) return

  const text = message.text || ''
  const chatId = message.chat.id

  // Extract user from Telegram update
  // This would need to match the chatId with a user in the database

  if (text.startsWith('/done')) {
    const taskId = text.split(' ')[1]
    if (taskId) {
      await supabase
        .from('tasks')
        .update({ status: 'done' })
        .eq('id', taskId)
    }
  }

  if (text.startsWith('/reschedule')) {
    const parts = text.split(' ')
    const taskId = parts[1]
    const newDate = parts[2]
    if (taskId && newDate) {
      await supabase
        .from('tasks')
        .update({ due_date: newDate })
        .eq('id', taskId)
    }
  }

  if (text.startsWith('/new')) {
    // Parse task creation: /new "Task title" 2024-08-15 high
    // This would create a new task
    return { action: 'ask_for_project', chatId }
  }
}

export function registerTelegramWebhook() {
  // This would register the webhook with Telegram
  // For development, polling might be used instead
  console.log('Telegram webhook would be registered here')
}
