import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import {
  createTelegramLinkToken,
  getTelegramBotUsername,
} from '@/lib/integrations/telegram'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })

  try {
    const [{ token, expiresAt }, username] = await Promise.all([
      createTelegramLinkToken(context.admin, context.user.id),
      getTelegramBotUsername(),
    ])
    const url = `https://t.me/${username}?start=${token}`
    return NextResponse.json({
      url,
      app_url: url,
      web_url: `https://web.telegram.org/k/#@${username}`,
      bot_username: `@${username}`,
      start_command: `/start ${token}`,
      expires_at: expiresAt,
    })
  } catch (error) {
    console.error('Unable to create Telegram link:', error)
    return NextResponse.json({ error: 'Impossibile preparare il collegamento Telegram' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const context = await requireUser(request)
  if (!context) return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })

  try {
    const [{ error: userError }, { error: tokenError }] = await Promise.all([
      context.admin.from('users')
        .update({ telegram_chat_id: null, updated_at: new Date().toISOString() })
        .eq('id', context.user.id),
      context.admin.from('telegram_link_tokens').delete().eq('user_id', context.user.id),
    ])
    if (userError) throw userError
    if (tokenError) throw tokenError
    return NextResponse.json({ disconnected: true })
  } catch (error) {
    console.error('Unable to disconnect Telegram:', error)
    return NextResponse.json({ error: 'Impossibile scollegare Telegram' }, { status: 500 })
  }
}
