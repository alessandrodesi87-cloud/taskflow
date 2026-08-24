'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import { supabase } from '@/lib/supabase'

function safeNextPath(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/dashboard'
}

export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const completeAuthentication = async () => {
      const params = new URLSearchParams(window.location.search)
      const providerError = params.get('error_description') || params.get('error')
      if (providerError) {
        if (active) setError(providerError.replaceAll('+', ' '))
        return
      }

      const code = params.get('code')
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          if (active) setError('Non siamo riusciti a completare l’accesso. Riprova dalla pagina di login.')
          return
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) {
        if (active) setError('Il collegamento non è valido o è scaduto. Riprova dalla pagina di login.')
        return
      }

      router.replace(safeNextPath(params.get('next')))
    }

    void completeAuthentication()
    return () => {
      active = false
    }
  }, [router])

  return (
    <AuthShell
      title={error ? 'Accesso non completato' : 'Accesso in corso'}
      subtitle={error || 'Stiamo verificando il tuo account e preparando Cronovia.'}
    >
      {error ? (
        <Link
          href="/auth/login"
          className="mt-8 block w-full rounded-lg bg-[#0b2f57] px-4 py-2.5 text-center font-semibold text-white hover:bg-[#082544]"
        >
          Torna al login
        </Link>
      ) : (
        <div className="mt-8 flex justify-center" aria-label="Caricamento">
          <span className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-[#c4a046]" />
        </div>
      )}
    </AuthShell>
  )
}
