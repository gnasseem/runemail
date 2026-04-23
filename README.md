# RuneMail

**AI-powered email client built on top of Gmail.** RuneMail connects to your Gmail account and uses AI to triage your inbox, surface action items, draft replies in your writing style, and deliver a daily briefing. Available at [runemail.org](https://runemail.org).

---

## Features

- **Smart Inbox** - AI categorizes every email and extracts todos, meetings, and suggested replies automatically
- **Three AI Modes** - Choose between fully local (on-device, private), cloud (Cerebras), or hybrid processing
- **Daily Briefing** - Morning summary of your most important emails, strictly bucketed into Reply Needed, Deadlines, Crucial, and Non-essential
- **Solve Everything** - Conversational AI agent that clears your whole briefing: proposes replies, todos, meetings, and bulk archives, asks you for any ambiguous decisions via interactive cards, and executes the approved plan in one click. Runs in the background so you can keep working
- **AI Assistant** - Conversational assistant with full access to your inbox context
- **Smart Drafts** - AI-generated replies that learn and match your personal writing style
- **Read Receipts** - Invisible tracking pixel embedded in outgoing emails so you know when they are opened
- **Scheduled Send** - Queue emails to deliver at a specific time
- **Calendar and Zoom Integration** - Create Google Calendar events and Zoom meetings directly from emails
- **Web Push Notifications** - Real-time browser notifications for new emails via Gmail webhooks
- **Multi-Account Gmail** - Connect and switch between multiple Gmail accounts
- **Interactive Tutorial** - Guided demo using a fake inbox so new users can explore every feature before connecting their real account

## AI Modes

| Mode | Description | Privacy |
|------|-------------|---------|
| **Local** | Runs Qwen2.5-3B entirely in your browser via WebLLM. No data leaves your device. | Maximum |
| **Cloud** | Uses Cerebras API via Supabase Edge Functions. Fast and always available. | Standard |
| **Hybrid** | Tries local inference first; falls back to cloud on failure. | High |

The local model (~4 GB) is downloaded once and cached in the browser.

## Tech Stack

**Frontend**
- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) for in-browser LLM inference (local mode)
- [Supabase JS](https://supabase.com/docs/reference/javascript) for auth and database access

**Backend**
- [Supabase](https://supabase.com/) for PostgreSQL database, Row Level Security, auth, and Edge Functions (Deno)
- [Cerebras](https://cerebras.ai/) (`qwen-3-235b`) for cloud AI processing via OpenAI-compatible API
- Gmail API and Google Calendar API for email and calendar access
- Web Push API for real-time browser notifications

**Infrastructure**
- [Vercel](https://vercel.com/) for frontend deployment
- Supabase for backend and database hosting

## Repository Structure

```
RuneMail/
├── frontend/                   # Next.js application
│   └── src/
│       ├── app/                # App Router: landing, /app, /auth, /privacy, /terms
│       ├── components/         # UI components
│       │   ├── views/          # InboxView, BriefingView, TodosView, MeetingsView, etc.
│       │   └── tutorial/       # Interactive tutorial with fake demo inbox
│       └── lib/
│           ├── emailGraph.ts   # LangGraph-style AI state machine
│           ├── webllm.ts       # Browser-side LLM inference wrapper
│           └── supabase/       # Supabase client helpers and middleware
├── supabase/
│   ├── functions/
│   │   ├── api/index.ts        # Main Edge Function (all backend routes)
│   │   ├── scheduled-emails/   # Cron function for scheduled email delivery
│   │   └── _shared/            # ai.ts, gmail.ts, cors.ts, fernet.ts
│   ├── migrations/             # SQL migrations
│   └── schema.sql              # Full database schema with RLS policies
└── vercel.json                 # Points Vercel build at frontend/
```

## Getting Started

### Prerequisites

- Node.js 20.18.0 (see `.nvmrc`)
- A [Supabase](https://supabase.com/) project
- A Google Cloud project with the Gmail API and Google Calendar API enabled
- A [Cerebras API key](https://cloud.cerebras.ai/) for cloud/hybrid AI mode

### 1. Clone and install

```bash
git clone https://github.com/georgenasseem/runemail.git
cd RuneMail

# Install root dependencies (Supabase CLI)
npm install

# Install frontend dependencies
cd frontend && npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Copy `frontend/.env.example` to `frontend/.env.local`:

```bash
cp frontend/.env.example frontend/.env.local
```

| Variable | Where to get it |
|----------|----------------|
| `PROJECT_URL` / `ANON_KEY` | Supabase project settings |
| `SERVICE_ROLE` | Supabase project settings (keep server-side only) |
| `CEREBRAS_API_KEY` | [Cerebras Cloud](https://cloud.cerebras.ai/) |
| `CLIENT_ID` / `CLIENT_SECRET` | Google Cloud Console (OAuth 2.0 credentials) |
| `TOKEN` | Generate a Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |

### 3. Set up the database

Apply the schema in your Supabase project SQL editor, in order:

1. `supabase/schema.sql`
2. `supabase/migrations/001_add_missing_tables.sql`
3. `supabase/migrations/002_add_tag_description.sql`
4. `supabase/migrations/003_create_draft_emails.sql`
5. `supabase/migrations/004_perf_indexes.sql`
6. `supabase/migrations/005_email_signals.sql`
7. `supabase/migrations/005_last_briefing.sql`
8. `supabase/migrations/006_push_subscriptions.sql`
9. `supabase/migrations/007_knowledge_use_count.sql`

### 4. Configure Google OAuth

In Google Cloud Console:
1. Create an OAuth 2.0 Web Application client
2. Add your Supabase auth callback as an authorized redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`
3. Enable the **Gmail API** and **Google Calendar API**
4. Add these OAuth scopes: `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/calendar`

In Supabase, enable Google as an OAuth provider under Authentication > Providers.

### 5. Deploy Edge Functions

```bash
# Set secrets on your Supabase project
npx supabase secrets set \
  CEREBRAS_API_KEY=... \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  FERNET_KEY=... \
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  --project-ref your-project-id

# Deploy functions
npx supabase functions deploy api --project-ref your-project-id --no-verify-jwt
npx supabase functions deploy scheduled-emails --project-ref your-project-id
```

### 6. Run locally

```bash
cd frontend
npm run dev
# Open http://localhost:3000
```

### 7. Deploy to Vercel

```bash
# From the repo root
npx vercel --prod
```

Set these environment variables in your Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

## Architecture Notes

### State Management

Global app state lives in `AppShell.tsx` via React Context. Access it with `useApp()` inside any component. Key fields: `user`, `profile`, `view`, `syncing`, `addToast`.

### Email Processing Pipeline

When emails are fetched, each one goes through a multi-step AI pipeline:

1. **Categorize** - assigns a category label
2. **Summarize** - generates a one-sentence summary
3. **Extract actions** - identifies todos, meetings, and suggested replies

This pipeline runs via `emailGraph.ts`, a custom LangGraph-style state machine that dispatches to the correct AI backend (local WebLLM or cloud Cerebras) based on the user's selected AI mode.

### Security

- All database tables use Row Level Security (RLS); users only access their own rows
- Gmail OAuth tokens are encrypted at rest using [Fernet symmetric encryption](https://cryptography.io/en/latest/fernet/)
- The read-receipt pixel endpoint is the only unauthenticated route; all other API routes verify the Supabase JWT

## License

MIT
