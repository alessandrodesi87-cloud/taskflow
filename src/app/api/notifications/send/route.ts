import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { scheduleDailyReminders } from '@/lib/integrations/email'
import {
  dispatchTelegramReminders,
  verifyTelegramDispatchSecret,
} from '@/lib/integrations/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const result = await scheduleDailyReminders(getSupabaseAdmin())
    if (result.failures.length > 0) {
      console.error('Daily email scheduler completed with failures:', result.failures)
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Daily email scheduler failed:', error)
    return NextResponse.json({ error: 'Pianificazione email non riuscita' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!verifyTelegramDispatchSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const result = await dispatchTelegramReminders(getSupabaseAdmin())
    if (result.failures.length > 0) {
      console.error('Telegram scheduler completed with failures:', result.failures)
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Telegram scheduler failed:', error)
    return NextResponse.json({ error: 'Invio Telegram non riuscito' }, { status: 500 })
  }
}

