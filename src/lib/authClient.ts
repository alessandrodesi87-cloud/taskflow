import { supabase } from '@/lib/supabase'

function buildAuthCallbackUrl(next = '/dashboard') {
  const callbackUrl = new URL('/auth/callback', window.location.origin)
  callbackUrl.searchParams.set('next', next)
  return callbackUrl.toString()
}

export async function signInWithGoogle(next = '/dashboard') {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: buildAuthCallbackUrl(next),
      queryParams: {
        prompt: 'select_account',
      },
    },
  })
}

export function getEmailConfirmationRedirectUrl() {
  return buildAuthCallbackUrl('/dashboard')
}
