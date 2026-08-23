import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'

const features = [
  {
    title: 'Una vista operativa',
    description: 'Scadenze ordinate per priorità temporale e una timeline compatta per pianificare senza perdere il contesto.',
  },
  {
    title: 'Tutto collegato',
    description: 'Integra Google Tasks, email e Telegram mantenendo progetti e attività in un unico spazio.',
  },
  {
    title: 'Personale e condiviso',
    description: 'Raccogli velocemente i task nella tua Inbox personale e assegnali poi al progetto o al collega corretto.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <BrandLogo priority className="max-w-[230px]" />
          <div className="flex items-center gap-2">
            <Link href="/auth/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-[#0b2f57] hover:bg-slate-100">
              Accedi
            </Link>
            <Link href="/auth/signup" className="rounded-lg bg-[#0b2f57] px-4 py-2 text-sm font-semibold text-white hover:bg-[#082544]">
              Registrati
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#b28d31]">Il lavoro, lungo la sua linea del tempo</p>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-tight text-[#0b2f57] sm:text-6xl">
            Dai ordine a progetti, attività e scadenze.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Cronovia riunisce pianificazione, collaborazione e promemoria in una vista semplice da leggere e veloce da aggiornare.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/auth/signup" className="rounded-xl bg-[#0b2f57] px-6 py-3 font-semibold text-white shadow-lg shadow-[#0b2f57]/15 hover:bg-[#082544]">
              Inizia con Cronovia
            </Link>
            <Link href="/auth/login" className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:bg-slate-100">
              Ho già un account
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-[#d8c27f] bg-white p-7 shadow-xl shadow-slate-200/70">
          <div className="flex items-center justify-between border-b border-slate-100 pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#b28d31]">Oggi</p>
              <p className="mt-1 text-xl font-bold text-[#0b2f57]">Le prossime scadenze</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Tutto sotto controllo</span>
          </div>
          <div className="mt-5 space-y-3">
            {['Conferma il piano di progetto', 'Rivedi le attività della settimana', 'Assegna i nuovi task'].map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <span className={`h-3 w-3 rounded-full ${index === 0 ? 'bg-rose-500' : index === 1 ? 'bg-amber-400' : 'bg-blue-500'}`} />
                <span className="flex-1 text-sm font-medium text-slate-700">{item}</span>
                <span className="text-xs text-slate-400">{index === 0 ? 'Oggi' : index === 1 ? 'Domani' : 'Venerdì'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-14 md:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-slate-200 p-6">
              <h2 className="text-lg font-bold text-[#0b2f57]">{feature.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Cronovia</p>
        <nav className="flex gap-5" aria-label="Informazioni legali">
          <Link href="/privacy" className="hover:text-[#0b2f57]">Privacy</Link>
          <Link href="/terms" className="hover:text-[#0b2f57]">Termini di servizio</Link>
        </nav>
      </footer>
    </main>
  )
}
