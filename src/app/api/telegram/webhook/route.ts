import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  processTelegramUpdate,
  type TelegramUpdate,
  verifyTelegramWebhookSecret,
} from '@/lib/integrations/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function updateChatId(update: TelegramUpdate) {
  return String(
    update.callback_query?.message?.chat.id
      ?? update.message?.chat.id
      ?? ''
  ) || null
}

function updateType(update: TelegramUpdate) {
  if (update.callback_query) return 'callback_query'
  if (update.message) return 'message'
  return 'other'
}

export async function POST(request: NextRequest) {
  if (!verifyTelegramWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const update = await request.json().catch(() => null) as TelegramUpdate | null
  if (!update || !Number.isSafeInteger(update.update_id)) {
    return NextResponse.json({ error: 'Aggiornamento non valido' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const now = new Date()
  const { error: insertError } = await admin.from('telegram_update_events').insert({
    update_id: update.update_id,
    chat_id: updateChatId(update),
    event_type: updateType(update),
    status: 'processing',
  })

  if (insertError?.code === '23505') {
    const { data: existing, error: existingError } = await admin
      .from('telegram_update_events')
      .select('status, updated_at')
      .eq('update_id', update.update_id)
      .single()
    if (existingError) return NextResponse.json({ error: 'Verifica aggiornamento non riuscita' }, { status: 500 })
    const processingIsStale = existing.status === 'processing'
      && new Date(existing.updated_at).getTime() < now.getTime() - 5 * 60 * 1000
    if (existing.status === 'processed' || (existing.status === 'processing' && !processingIsStale)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    const { error: retryError } = await admin.from('telegram_update_events').update({
      status: 'processing',
      error_message: null,
    }).eq('update_id', update.update_id)
    if (retryError) return NextResponse.json({ error: 'Riprova non riuscita' }, { status: 500 })
  } else if (insertError) {
    console.error('Unable to register Telegram update:', insertError)
    return NextResponse.json({ error: 'Registrazione aggiornamento non riuscita' }, { status: 500 })
  }

  try {
    await processTelegramUpdate(admin, update)
    await admin.from('telegram_update_events').update({
      status: 'processed',
      processed_at: new Date().toISOString(),
    }).eq('update_id', update.update_id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Telegram webhook error'
    await admin.from('telegram_update_events').update({
      status: 'failed',
      error_message: message.slice(0, 1000),
    }).eq('update_id', update.update_id)
    console.error('Telegram webhook failed:', error)
    return NextResponse.json({ error: 'Elaborazione Telegram non riuscita' }, { status: 500 })
  }
}

