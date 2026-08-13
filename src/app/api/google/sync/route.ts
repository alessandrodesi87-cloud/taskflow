import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { requireUser } from '@/lib/serverAuth'
import { syncGoogleTasks } from '@/lib/googleTasks'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const authenticated = await requireUser(request)
  if (!authenticated) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => null) as { accountId?: string } | null
    const accountId = typeof body?.accountId === 'string' ? body.accountId : undefined
    const result = await syncGoogleTasks(authenticated.admin, authenticated.user.id, accountId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Manual Google Tasks sync failed:', error)
    return NextResponse.json({ error: 'Sincronizzazione Google non riuscita' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const result = await syncGoogleTasks(getSupabaseAdmin())
    if (result.failures.length > 0) {
      console.error('Scheduled Google Tasks sync completed with failures:', result.failures)
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Scheduled Google Tasks sync failed:', error)
    return NextResponse.json({ error: 'Sincronizzazione Google non riuscita' }, { status: 500 })
  }
}
