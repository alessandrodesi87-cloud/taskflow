import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export async function requireUser(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!token || !url || !anonKey) {
    return null
  }

  const authClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { data, error } = await authClient.auth.getUser(token)

  if (error || !data.user) {
    return null
  }

  const admin = getSupabaseAdmin()

  return { user: data.user, admin }
}

export async function requireAdmin(request: NextRequest) {
  const authenticated = await requireUser(request)

  if (!authenticated) {
    return null
  }

  const { user, admin } = authenticated
  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    return null
  }

  return { user, admin }
}
