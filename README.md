# TaskFlow - Team Task Manager with Gantt Chart

Una web app per gestire task e progetti del team con visualizzazione Gantt, integrazioni Gmail/Google Tasks, reminder via email e Telegram.

## Features

✅ **MVP (Phase 1 - Completato)**
- Gantt chart visualization
- CRUD task manuali
- Auth utenti
- Admin console per gestire utenti
- Database schema completo

🔄 **In Sviluppo (Phase 2-3)**
- Integrazione Google Tasks (import + sync)
- Integrazione Gmail (collegare più account, task from email)
- Email reminders giornalieri
- Telegram bot
- File attachments
- Co-owner support

## Stack Tecnologico

- **Frontend**: Next.js 14 + React + TypeScript + Tailwind CSS
- **Backend**: Next.js API Routes + Node.js
- **Database**: PostgreSQL (Supabase)
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage
- **Email**: Resend (da configurare)
- **Telegram**: node-telegram-bot-api
- **Google APIs**: googleapis

## Setup Locale

### 1. Clona il progetto
```bash
git clone <repo>
cd task-manager-gantt
```

### 2. Installa dipendenze
```bash
npm install
```

### 3. Configura environment variables
Crea `.env.local` dalla template:
```bash
cp .env.local.example .env.local
```

Compila con i tuoi valori:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
RESEND_API_KEY=your-resend-api-key
```

### 4. Setup Supabase

Vai a [supabase.com](https://supabase.com):
1. Crea nuovo progetto
2. In SQL Editor, copia il contenuto di `supabase/migrations/001_init.sql`
3. Esegui la migration

### 5. Avvia dev server
```bash
npm run dev
```

Accedi a `http://localhost:3000`

## Deploy su Vercel + Supabase

### Frontend (Vercel)
1. Push il repo su GitHub
2. Vai a [vercel.com](https://vercel.com)
3. Importa il repo
4. Aggiungi le environment variables
5. Deploy!

### Backend (Supabase - Free Tier)
Il database è già su Supabase, basta configurare le env variables in Vercel.

## Roadmap

**Phase 1 ✅** (MVP - 2-3 settimane)
- Setup base + Gantt chart
- Auth + Admin console
- CRUD task

**Phase 2** (Integrazioni - 3-4 settimane)
- Google Tasks import + sync
- Gmail multi-account + task origin
- Email reminders strutturati

**Phase 3** (Polish - 2-3 settimane)
- Telegram bot
- File attachments
- Advanced permissions (co-owner)
- GDPR compliance

**Phase 4** (Optimization)
- Performance tuning
- Security hardening
- Testing

## Struttura Cartelle

```
src/
├── app/                 # Next.js App Router
│   ├── auth/           # Login/Signup pages
│   ├── dashboard/      # Main Gantt view
│   ├── admin/          # Admin console
│   └── api/            # API endpoints
├── components/
│   ├── gantt/          # Gantt chart component
│   ├── task/           # Task components
│   └── project/        # Project components
├── lib/
│   ├── supabase.ts     # Supabase client
│   ├── types/          # TypeScript types
│   └── integrations/   # Google, Email, Telegram
└── types/              # Global types
```

## API Endpoints

```
GET  /api/projects           - Listavvi progetti
POST /api/projects           - Crea progetto
GET  /api/tasks?projectId=x  - Lista task
POST /api/tasks              - Crea task
PATCH /api/tasks             - Aggiorna task
```

## Prossimi Passi

1. **Setup Supabase** - Esegui la migration SQL
2. **Setup Google OAuth** - Configura credenziali Google Console
3. **Setup Telegram Bot** - Crea bot su BotFather
4. **Setup Resend** - Account email per reminder
5. **Test MVP** - Crea progetti/task, verifica Gantt
6. **Deploy** - Push a Vercel

## Support

Per domande/problemi, controlla:
- Supabase docs: https://supabase.com/docs
- Next.js docs: https://nextjs.org/docs
- Telegram Bot API: https://core.telegram.org/bots/api

## Riferimenti open source

La progettazione evolutiva del Gantt prende spunto anche da
[Jordium Gantt Vue3](https://github.com/nelson820125/jordium-gantt-vue3),
distribuito con licenza MIT. TaskFlow non incorpora la libreria Vue e non ne
dipende: il componente viene implementato autonomamente in React, mantenendo
Jordium come riferimento dichiarato per interazioni e visualizzazione.
