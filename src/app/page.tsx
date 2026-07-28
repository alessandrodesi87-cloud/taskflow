'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
      } else {
        router.push('/dashboard')
      }
    }
    checkAuth()
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p>Caricamento...</p>
    </div>
  )
}
