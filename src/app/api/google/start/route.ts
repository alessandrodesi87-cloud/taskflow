import { NextRequest, NextResponse } from 'next/server'
import {
  GOOGLE_OAUTH_COOKIE,
  resumeGoogleAuthorization,
} from '@/lib/googleTasks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const state = request.nextUrl.searchParams.get('state') || ''
    const authorization = resumeGoogleAuthorization(state)
    const callback = new URL(authorization.redirectUri)

    if (
      callback.origin !== request.nextUrl.origin ||
      callback.pathname !== '/api/google/callback'
    ) {
      throw new Error('Origine Google OAuth non valida')
    }

    const response = NextResponse.redirect(authorization.authorizationUrl)
    response.cookies.set(GOOGLE_OAUTH_COOKIE, authorization.nonce, {
      httpOnly: true,
      secure: callback.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/google/callback',
      maxAge: authorization.maxAge,
    })
    return response
  } catch (error) {
    console.error('Google OAuth start failed:', error instanceof Error ? error.message : error)
    const url = new URL('/settings', request.nextUrl.origin)
    url.searchParams.set('google', 'error')
    return NextResponse.redirect(url)
  }
}
