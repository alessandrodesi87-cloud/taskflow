import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { processStructuredReply } from '@/lib/integrations/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function extractEmailAddress(value: string) {
  const bracketed = value.match(/<([^>]+)>/)
  return (bracketed?.[1] || value).trim().toLowerCase()
}

function textFromHtml(html: string) {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '')
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (!apiKey || !webhookSecret) {
    return NextResponse.json({ error: 'Webhook non configurato' }, { status: 503 })
  }

  const payload = await request.text()
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: 'Firma mancante' }, { status: 400 })
  }

  const resend = new Resend(apiKey)
  let event
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    })
  } catch {
    return NextResponse.json({ error: 'Firma non valida' }, { status: 401 })
  }

  if (event.type !== 'email.received') {
    return NextResponse.json({ ignored: true })
  }

  const admin = getSupabaseAdmin()
  const { data: existing, error: existingError } = await admin
    .from('inbound_email_events')
    .select('status')
    .eq('id', id)
    .maybeSingle()

  if (existingError) {
    console.error('Unable to inspect inbound event:', existingError)
    return NextResponse.json({ error: 'Errore database' }, { status: 500 })
  }
  if (existing?.status === 'processed' || existing?.status === 'ignored') {
    return NextResponse.json({ duplicate: true })
  }

  if (!existing) {
    const { error: insertError } = await admin.from('inbound_email_events').insert({
      id,
      email_id: event.data.email_id,
      sender_email: extractEmailAddress(event.data.from),
      status: 'received',
    })
    if (insertError && insertError.code !== '23505') {
      console.error('Unable to register inbound event:', insertError)
      return NextResponse.json({ error: 'Errore database' }, { status: 500 })
    }
  }

  try {
    const configuredRecipient = process.env.RESEND_REPLY_TO
      ? extractEmailAddress(process.env.RESEND_REPLY_TO)
      : null
    if (configuredRecipient && !event.data.to.map(extractEmailAddress).includes(configuredRecipient)) {
      await admin.from('inbound_email_events').update({
        status: 'ignored',
        result: { reason: 'recipient_mismatch' },
        processed_at: new Date().toISOString(),
      }).eq('id', id)
      return NextResponse.json({ ignored: true })
    }

    const { data: email, error: emailError } = await resend.emails.receiving.get(event.data.email_id)
    if (emailError || !email) throw new Error(emailError?.message || 'Email body unavailable')

    const sender = extractEmailAddress(email.from || event.data.from)
    const body = email.text || textFromHtml(email.html || '')
    const result = await processStructuredReply(admin, sender, body)
    const status = result.processed > 0 ? 'processed' : 'ignored'

    await admin.from('inbound_email_events').update({
      sender_email: sender,
      status,
      result,
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', id)

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown inbound email error'
    await admin.from('inbound_email_events').update({
      status: 'failed',
      error_message: message.slice(0, 1000),
      processed_at: new Date().toISOString(),
    }).eq('id', id)
    console.error('Inbound email processing failed:', error)
    return NextResponse.json({ error: 'Elaborazione risposta non riuscita' }, { status: 500 })
  }
}
