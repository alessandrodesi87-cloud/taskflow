'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import GoogleAuthButton from '@/components/auth/GoogleAuthButton'
import { getEmailConfirmationRedirectUrl, signInWithGoogle } from '@/lib/authClient'
import { supabase } from '@/lib/supabase'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'password' | 'google' | null>(null)
  const router = useRouter()

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading('password')
    setError('')

    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: getEmailConfirmationRedirectUrl(),
        },
      })
      if (signupError) throw signupError

      router.replace(data.session ? '/dashboard' : '/auth/check-email')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Non siamo riusciti a creare l’account.')
    } finally {
      setLoading(null)
    }
  }

  const handleGoogleSignup = async () => {
    setLoading('google')
    setError('')

    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      setError('La registrazione con Google non è ancora disponibile. Puoi usare email e password.')
      setLoading(null)
    }
  }

  return (
    <AuthShell title="Crea il tuo account" subtitle="Inizia a organizzare il lavoro con Cronovia.">
      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-8">
        <GoogleAuthButton
          label={loading === 'google' ? 'Collegamento a Google…' : 'Registrati con Google'}
          disabled={loading !== null}
          onClick={handleGoogleSignup}
        />
        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          oppure
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      </div>

      <form className="space-y-5" onSubmit={handleSignup}>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nome completo</span>
          <input
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-[#0b2f57] focus:ring-2 focus:ring-[#0b2f57]/15"
            required
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-[#0b2f57] focus:ring-2 focus:ring-[#0b2f57]/15"
            required
          />
          <span className="mt-1 block text-xs text-slate-500">Usa almeno 8 caratteri.</span>
        </label>
        <button
          type="submit"
          disabled={loading !== null}
          className="w-full rounded-lg bg-[#0b2f57] px-4 py-2.5 font-semibold text-white transition-colors hover:bg-[#082544] disabled:cursor-wait disabled:opacity-60"
        >
          {loading === 'password' ? 'Creazione account…' : 'Crea account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Hai già un account?{' '}
        <Link href="/auth/login" className="font-semibold text-[#0b2f57] hover:underline">
          Accedi
        </Link>
      </p>
    </AuthShell>
  )
}
