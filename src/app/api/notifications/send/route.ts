import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { scheduleDailyReminders } from '@/lib/integrations/email'

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

