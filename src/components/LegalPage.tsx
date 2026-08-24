import type { ReactNode } from 'react'
import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'

interface LegalPageProps {
  title: string
  updatedAt: string
  children: ReactNode
}

export default function LegalPage({ title, updatedAt, children }: LegalPageProps) {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-700">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="block max-w-[240px]" aria-label="Torna alla home di Cronovia">
          <BrandLogo priority />
        </Link>
        <h1 className="mt-10 text-3xl font-bold text-[#0b2f57]">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Ultimo aggiornamento: {updatedAt}</p>
        <div className="mt-10 space-y-8 leading-7 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[#0b2f57] [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          {children}
        </div>
        <div className="mt-12 border-t border-slate-200 pt-6 text-sm">
          <Link href="/" className="font-semibold text-[#0b2f57] hover:underline">Torna a Cronovia</Link>
        </div>
      </article>
    </main>
  )
}
