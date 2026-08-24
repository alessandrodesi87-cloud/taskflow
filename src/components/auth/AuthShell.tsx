import type { ReactNode } from 'react'
import BrandLogo from '@/components/BrandLogo'

interface AuthShellProps {
  title: string
  subtitle: string
  children: ReactNode
}

export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg shadow-slate-200/60">
        <BrandLogo priority className="mx-auto max-w-[300px]" />
        <div className="mt-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  )
}
