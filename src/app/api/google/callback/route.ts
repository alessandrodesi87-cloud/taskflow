import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { ensurePersonalInbox } from '@/lib/personalInbox'
import {
  exchangeGoogleCode,
  getGoogleAccountEmail,
  GOOGLE_OAUTH_COOKIE,
  verifyGoogleOAuthState,
} from '@/lib/googleTasks'

export const dynamic = 'force-dynamic'

function settingsRedirect(origin: string, result: 'connected' | 'error') {
  const url = new URL('/settings', origin)
  url.searchParams.set('google', result)
  return url
}

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_OAUTH_COOKIE, '', {
    httpOnly: true,
    secure: response.url.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/google/callback',
    maxAge: 0,
  })
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || ''
  let redirectUri = `${request.nextUrl.origin}/api/google/callback`
  let returnOrigin = request.nextUrl.origin

  try {
    const payload = verifyGoogleOAuthState(
      state,
      request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value,
    )
    redirectUri = payload.redirectUri
    returnOrigin = payload.returnOrigin || new URL(redirectUri).origin

    const providerError = request.nextUrl.searchParams.get('error')
    const code = request.nextUrl.searchParams.get('code')
    if (providerError || !code) {
      throw new Error('Collegamento Google annullato')
    }

    const tokens = await exchangeGoogleCode(code, redirectUri)
    const email = await getGoogleAccountEmail(tokens.access_token as string)
    const admin = getSupabaseAdmin()
    const { data: existing, error: existingError } = await admin
      .from('gmail_accounts')
      .select('refresh_token, default_project_id')
      .eq('user_id', payload.userId)
      .eq('email', email)
      .maybeSingle()

    if (existingError) throw new Error('Impossibile verificare l’account Google')
    const refreshToken = tokens.refresh_token || existing?.refresh_token
    if (!refreshToken) {
      throw new Error('Google non ha autorizzato la sincronizzazione automatica')
    }
    const defaultProjectId = existing?.default_project_id
      || (await ensurePersonalInbox(admin, payload.userId)).id

    const { error: saveError } = await admin
      .from('gmail_accounts')
      .upsert(
        {
          user_id: payload.userId,
          email,
          access_token: tokens.access_token,
          refresh_token: refreshToken,
          default_project_id: defaultProjectId,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,email' },
      )

    if (saveError) throw new Error('Impossibile salvare il collegamento Google')

    const response = NextResponse.redirect(settingsRedirect(returnOrigin, 'connected'))
    clearOAuthCookie(response)
    return response
  } catch (error) {
    console.error('Google OAuth callback failed:', error instanceof Error ? error.message : error)
    const response = NextResponse.redirect(settingsRedirect(returnOrigin, 'error'))
    clearOAuthCookie(response)
    return response
  }
}
