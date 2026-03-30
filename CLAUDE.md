# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow Rules

- **Always commit changes after each task** and deploy automatically via `npx vercel --prod` from the repo root. This is required after every change. No exceptions.
- Node version: **20.18.0** (use `.nvmrc`).
- **Never use m-dashes (—) in UI text or code comments.** Use commas, semicolons, periods, or "to" instead.

## Commands

All commands run from the **repo root** unless noted.

```bash
# Development
npm run dev           # Start Next.js dev server (port 3000)
npm run build         # Production build
npm run lint          # ESLint (from frontend/)

# TypeScript check (from frontend/)
cd frontend && node_modules/.bin/tsc --noEmit

# Deploy frontend
npx vercel --prod

# Deploy Supabase edge functions (--no-verify-jwt is REQUIRED for the api function)
npx supabase functions deploy api --project-ref qamzysoysmqzulordfzy --no-verify-jwt
```

## Architecture

### Monorepo Layout

```
RuneMail/
├── frontend/           # Next.js 16 app (deployed to Vercel)
│   └── src/
│       ├── app/        # Next.js App Router (landing, /app, /auth)
│       ├── components/ # UI components + views/
│       └── lib/        # emailGraph.ts, webllm.ts, supabase/
├── supabase/
│   ├── functions/api/  # Deno edge function — single entry point for all backend routes
│   ├── functions/_shared/  # ai.ts (Cerebras), gmail.ts, cors.ts, fernet.ts
│   └── schema.sql      # Full DB schema with RLS policies
└── vercel.json         # Points build at frontend/
```

### State Management

Global state lives in **`AppShell.tsx`** via React Context (`useApp()` hook). Key fields:
- `user` / `profile` — Supabase auth user + profile row (contains `ai_mode`, `theme`)
- `view` — current sidebar view
- `syncing` — global sync status
- `registerSyncFn` / `triggerSync` — TopBar's reload button calls whatever the active view registers

Access with `const { user, profile, addToast, ... } = useApp()` inside any component.

### AI Mode System

Three modes controlled by `profile.ai_mode` (`"cloud" | "local" | "hybrid"`):

| Mode | How it works |
|------|-------------|
| `cloud` | Calls Supabase edge functions → Cerebras API |
| `local` | Runs Qwen2.5-3B in browser via WebLLM; **never falls back to cloud** — shows error instead |
| `hybrid` | Tries local first, falls back to cloud on failure |

**Check mode before every AI call:**
```ts
const aiMode = profile?.ai_mode || "cloud";
if (aiMode === "local" || aiMode === "hybrid") { /* try emailGraph */ }
// then cloud fallback (skip if local)
```

### emailGraph (LangGraph-style state machine)

`frontend/src/lib/emailGraph.ts` — custom TypeScript state graph, no external LangChain dependency.

- **`emailGraph`**: main router dispatching by `task` field → nodes: `categorize`, `summarize`, `extract_actions`, `briefing`, `todos`, `meetings`, `draft`, `auto_reply`, `rethink`, `process_email`
- **`quickActionsGraph`**: 6-node sequential subgraph mirroring the original Python `quick_actions_graph.py` (gather_context → reply/todo/meeting/archive analysis → merge_actions)

Usage pattern across all views:
```ts
import { emailGraph } from "@/lib/emailGraph";
const result = await emailGraph.invoke({ task: "todos", emails: [...] });
```

`TaskType` determines which branch of the graph runs. State accumulates as it flows through nodes.

### WebLLM

`frontend/src/lib/webllm.ts` — browser-side inference wrapper.

- Model: `Qwen2.5-3B-Instruct-q4f16_1-MLC` (~4 GB download, cached in browser)
- Race condition guard: concurrent `initWebLLM()` calls share a single `loadingPromise`
- `extractJSON<T>(raw, fallback)` — robust parser that handles markdown code fences, preamble, loose JSON objects/arrays

### Backend Edge Function

Single Deno entry point at `supabase/functions/api/index.ts`. Key routes:
- `POST /fetch-emails` — Gmail sync + AI processing
- `POST /send-email` — send via Gmail API
- `POST /calendar/create-event` — Google Calendar (pass `sendUpdates: "all"` for invites)
- `POST /zoom/create-meeting` — Zoom integration
- `GET /briefing` — cloud AI briefing
- `GET /track/pixel/:id.gif` — read-receipt pixel (no-auth route)

Shared utilities in `_shared/`: `ai.ts` (Cerebras prompts), `gmail.ts`, `fernet.ts` (token encryption).

### Database

All tables have **Row Level Security** — users only see their own rows. Key tables:
- `profiles` — `ai_mode`, `theme`, `display_name`
- `gmail_accounts` — multi-account OAuth tokens (Fernet-encrypted)
- `emails` — raw email storage
- `email_processed` — AI results: category, summary, urgency, quick_actions (JSONB)
- `todos`, `meetings`, `draft_emails`, `scheduled_emails`, `read_receipts`

Upsert to `email_processed` keyed on `email_id` when saving local AI results.

### Auth Flow

1. Google OAuth via Supabase → `/auth/callback` exchanges code for session
2. Callback adds `?initial=1` on first login → InboxView auto-triggers `syncInbox`
3. Middleware (`lib/supabase/middleware.ts`) guards `/app` — unauthenticated users redirect to `/`
4. Dev-only: `GET /api/dev-auth?access_token=&refresh_token=` sets session directly

### Environment Variables

Required in Vercel / `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Edge function secrets (set via `supabase secrets set`): `CEREBRAS_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `FERNET_KEY`.
