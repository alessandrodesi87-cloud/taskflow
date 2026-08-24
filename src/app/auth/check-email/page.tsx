import Link from 'next/link'
import AuthShell from '@/components/auth/AuthShell'

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Controlla la tua email"
      subtitle="Ti abbiamo inviato un messaggio per confermare il tuo account Cronovia."
    >
      <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="font-semibold">Apri l’email e premi “Conferma il mio account”.</p>
        <p className="mt-2 text-emerald-800">
          Se non la trovi entro qualche minuto, controlla anche le cartelle Spam o Promozioni.
        </p>
      </div>
      <Link
        href="/auth/login"
        className="mt-6 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Torna al login
      </Link>
    </AuthShell>
  )
}
