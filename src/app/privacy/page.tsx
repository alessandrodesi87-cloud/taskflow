import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Informativa sulla privacy',
  description: 'Informativa sulla privacy del servizio Cronovia.',
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Informativa sulla privacy" updatedAt="23 agosto 2026">
      <section>
        <h2>1. Ambito dell’informativa</h2>
        <p>Questa informativa descrive come Cronovia tratta i dati necessari a fornire il servizio di organizzazione di progetti, attività, scadenze e notifiche.</p>
      </section>
      <section>
        <h2>2. Dati trattati</h2>
        <ul>
          <li>Dati dell’account, come nome, indirizzo email e identificativo utente.</li>
          <li>Contenuti inseriti nel servizio, inclusi progetti, task, descrizioni, date e assegnazioni.</li>
          <li>Preferenze relative a notifiche, integrazioni e visualizzazione.</li>
          <li>Dati tecnici essenziali per sicurezza, autenticazione e funzionamento del servizio.</li>
        </ul>
      </section>
      <section>
        <h2>3. Integrazioni facoltative</h2>
        <p>Se scegli di collegare Google Tasks, Telegram o i servizi email, Cronovia tratta soltanto i dati e i permessi necessari a eseguire le funzioni richieste. Le integrazioni possono essere scollegate dalle impostazioni del profilo.</p>
      </section>
      <section>
        <h2>4. Finalità</h2>
        <p>I dati sono utilizzati per creare e gestire l’account, sincronizzare le attività richieste, consentire la collaborazione, inviare notifiche abilitate dall’utente, proteggere il servizio e risolvere eventuali problemi tecnici.</p>
      </section>
      <section>
        <h2>5. Fornitori del servizio</h2>
        <p>Cronovia utilizza fornitori infrastrutturali e tecnici, tra cui Supabase per autenticazione e dati, Vercel per l’hosting, Resend per le email e, solo quando collegati dall’utente, Google e Telegram per le rispettive integrazioni.</p>
      </section>
      <section>
        <h2>6. Conservazione e sicurezza</h2>
        <p>I dati vengono conservati per il tempo necessario a fornire il servizio e a rispettare gli obblighi applicabili. Sono adottate misure tecniche e organizzative proporzionate per limitare accessi non autorizzati, perdita o uso improprio dei dati.</p>
      </section>
      <section>
        <h2>7. Scelte e diritti</h2>
        <p>Puoi modificare le preferenze, scollegare le integrazioni e richiedere accesso, correzione o cancellazione dei dati utilizzando il canale di assistenza indicato nell’applicazione e nella schermata di consenso Google.</p>
      </section>
      <section>
        <h2>8. Modifiche</h2>
        <p>Questa informativa potrà essere aggiornata con l’evoluzione del servizio. La data dell’ultima revisione viene indicata all’inizio della pagina.</p>
      </section>
    </LegalPage>
  )
}
