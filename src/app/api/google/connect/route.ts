import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import { createGoogleAuthorization, GOOGLE_OAUTH_COOKIE } from '@/lib/googleTasks'

export const dynamic = 'force-dynamic'

function getAppOrigin(request: NextRequest) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL

  if (process.env.VERCEL_ENV === 'production' && configuredUrl) {
    return new URL(configuredUrl).origin
  }

  return request.nextUrl.origin
}

export async function POST(request: NextRequest) {
  const authenticated = await requireUser(request)
  if (!authenticated) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  try {
    const redirectUri = `${getAppOrigin(request)}/api/google/callback`
    const authorization = createGoogleAuthorization(authenticated.user.id, redirectUri)
    const response = NextResponse.json({ url: authorization.authorizationUrl })
    response.cookies.set(GOOGLE_OAUTH_COOKIE, authorization.nonce, {
      httpOnly: true,
      secure: redirectUri.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/google/callback',
      maxAge: authorization.maxAge,
    })
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google OAuth non è disponibile' },
      { status: 503 },
    )
  }
}
