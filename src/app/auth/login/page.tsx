'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import GoogleAuthButton from '@/components/auth/GoogleAuthButton'
import { signInWithGoogle } from '@/lib/authClient'
import { supabase } from '@/lib/supabase'

function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Email o password non corretti.'
  }
  if (message.toLowerCase().includes('email not confirmed')) {
    return 'Devi prima confermare l’email che ti abbiamo inviato.'
  }
  return message || 'Non siamo riusciti ad accedere. Riprova tra poco.'
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'password' | 'google' | null>(null)
  const router = useRouter()

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading('password')
    setError('')

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) throw loginError
      router.replace('/dashboard')
    } catch (caughtError) {
      setError(authErrorMessage(caughtError))
    } finally {
      setLoading(null)
    }
  }

  const handleGoogleLogin = async () => {
    setLoading('google')
    setError('')

    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      setError('L’accesso con Google non è ancora disponibile. Puoi usare email e password.')
      setLoading(null)
    }
  }

  return (
    <AuthShell title="Bentornato" subtitle="Accedi per organizzare progetti, scadenze e attività.">
      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-8">
        <GoogleAuthButton
          label={loading === 'google' ? 'Collegamento a Google…' : 'Continua con Google'}
          disabled={loading !== null}
          onClick={handleGoogleLogin}
        />
        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          oppure
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      </div>

      <form className="space-y-5" onSubmit={handleLogin}>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-[#0b2f57] focus:ring-2 focus:ring-[#0b2f57]/15"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-[#0b2f57] focus:ring-2 focus:ring-[#0b2f57]/15"
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading !== null}
          className="w-full rounded-lg bg-[#0b2f57] px-4 py-2.5 font-semibold text-white transition-colors hover:bg-[#082544] disabled:cursor-wait disabled:opacity-60"
        >
          {loading === 'password' ? 'Accesso in corso…' : 'Accedi'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Non hai un account?{' '}
        <Link href="/auth/signup" className="font-semibold text-[#0b2f57] hover:underline">
          Registrati
        </Link>
      </p>
    </AuthShell>
  )
}
