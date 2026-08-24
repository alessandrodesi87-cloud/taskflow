import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Termini di servizio',
  description: 'Termini di utilizzo del servizio Cronovia.',
}

export default function TermsPage() {
  return (
    <LegalPage title="Termini di servizio" updatedAt="23 agosto 2026">
      <section>
        <h2>1. Il servizio</h2>
        <p>Cronovia offre strumenti per organizzare progetti, task, scadenze, collaborazioni e notifiche. Le funzionalità possono evolvere durante lo sviluppo del prodotto.</p>
      </section>
      <section>
        <h2>2. Account</h2>
        <p>L’utente è responsabile delle informazioni inserite, della riservatezza delle proprie credenziali e delle attività svolte tramite il proprio account. Eventuali accessi non autorizzati devono essere segnalati tempestivamente tramite il canale di assistenza dell’applicazione.</p>
      </section>
      <section>
        <h2>3. Uso corretto</h2>
        <p>Non è consentito utilizzare Cronovia per attività illecite, per compromettere la sicurezza del servizio o di altri utenti, per inviare contenuti abusivi o per tentare di accedere a dati senza autorizzazione.</p>
      </section>
      <section>
        <h2>4. Integrazioni esterne</h2>
        <p>Le integrazioni con servizi esterni sono facoltative e restano soggette anche alle condizioni dei rispettivi fornitori. L’utente può revocare i collegamenti dalle impostazioni di Cronovia o dal servizio esterno.</p>
      </section>
      <section>
        <h2>5. Disponibilità</h2>
        <p>Viene prestata attenzione alla continuità e alla sicurezza del servizio, ma non è possibile garantire che Cronovia sia sempre disponibile o privo di errori. Manutenzioni e aggiornamenti possono comportare interruzioni temporanee.</p>
      </section>
      <section>
        <h2>6. Contenuti dell’utente</h2>
        <p>L’utente conserva la responsabilità dei contenuti inseriti e deve assicurarsi di avere il diritto di trattarli e condividerli con gli eventuali collaboratori del progetto.</p>
      </section>
      <section>
        <h2>7. Modifiche ai termini</h2>
        <p>I termini possono essere aggiornati per riflettere modifiche del servizio o requisiti applicabili. La versione corrente e la data di aggiornamento sono pubblicate in questa pagina.</p>
      </section>
    </LegalPage>
  )
}
