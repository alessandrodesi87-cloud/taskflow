import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import { sendTestTelegramReminder } from '@/lib/integrations/telegram'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })

  try {
    const result = await sendTestTelegramReminder(context.admin, context.user.id)
    return NextResponse.json({ sent: true, task_count: result.taskCount })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invio Telegram non riuscito'
    const status = message === 'Collega prima Telegram' ? 400 : 500
    console.error('Unable to send Telegram test:', error)
    return NextResponse.json({ error: message }, { status })
  }
}

