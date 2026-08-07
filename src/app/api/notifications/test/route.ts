import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import { sendTestReminder } from '@/lib/integrations/email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  try {
    const result = await sendTestReminder(context.admin, context.user.id)
    return NextResponse.json({ sent: true, task_count: result.taskCount })
  } catch (error) {
    console.error('Test reminder failed:', error)
    const message = error instanceof Error && /domain|from|verify|testing emails/i.test(error.message)
      ? 'Mittente email non ancora verificato su Resend.'
      : 'Invio email di prova non riuscito.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

