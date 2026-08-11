import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/serverAuth'
import { createGoogleAuthorization, GOOGLE_OAUTH_COOKIE } from '@/lib/googleTasks'

export const dynamic = 'force-dynamic'

function getGoogleRedirectUri(request: NextRequest) {
  const explicitRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
  if (explicitRedirectUri) {
    return new URL(explicitRedirectUri).toString()
  }

  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const productionHostname = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const appOrigin = configuredAppUrl
    ? new URL(configuredAppUrl).origin
    : productionHostname
      ? `https://${productionHostname}`
      : request.nextUrl.origin

  return new URL('/api/google/callback', appOrigin).toString()
}

export async function POST(request: NextRequest) {
  const authenticated = await requireUser(request)
  if (!authenticated) {
    return NextResponse.json({ error: 'Sessione non valida' }, { status: 401 })
  }

  try {
    const redirectUri = getGoogleRedirectUri(request)
    const authorization = createGoogleAuthorization(
      authenticated.user.id,
      redirectUri,
      request.nextUrl.origin,
    )
    const callbackOrigin = new URL(redirectUri).origin
    const usesStableBridge = callbackOrigin !== request.nextUrl.origin
    const startUrl = usesStableBridge
      ? new URL(`/api/google/start?state=${encodeURIComponent(authorization.state)}`, callbackOrigin).toString()
      : authorization.authorizationUrl
    const response = NextResponse.json({ url: startUrl })

    if (usesStableBridge) {
      return response
    }

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
