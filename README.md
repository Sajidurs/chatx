# chatx

Multi-tenant AI chatbot SaaS: businesses train an assistant on their own documents,
connect Google Calendar, and embed a chat widget on their site. See
[system_design.md](./system_design.md) for full architecture and build phases, and
[CHANGELOG.md](./CHANGELOG.md) for build history and decisions.

## Stack

Next.js 15 (App Router) · Supabase (Postgres + pgvector + Auth) · Stripe Billing ·
Claude API · Google Calendar API. See system_design.md section 1 for details.

## Project structure

New folders/files should follow this layout as the project grows — one place for
each kind of thing, grouped by what it does rather than by phase or feature name:

```
src/
  app/                    Routes (App Router). Pages, layouts, route handlers.
    api/                  Route handlers (webhooks, widget endpoints, etc.)
  components/
    ui/                   Small, reusable, presentation-only components
    (feature dirs)        Feature-specific components (e.g. dashboard/, widget/)
  lib/                    Framework-agnostic logic, one subfolder per integration
    supabase/             client.ts (browser), server.ts (server/RSC), admin.ts (service role)
    stripe/                checkout, webhook verification, plan <-> price mapping
    ai/                    Claude client, RAG retrieval, tool definitions
    google/                OAuth, calendar read/write, Meet link creation
    email/                 transactional email sending
  types/                  Shared TypeScript types (incl. generated Supabase types)
  hooks/                  Client-side React hooks

supabase/
  migrations/             SQL migrations, applied in filename order
  config.toml             Local Supabase CLI config

scripts/                  One-off or repeatable ops scripts (e.g. RLS verification)
```

Rules of thumb:

- A file goes in `lib/<integration>/` the first time a second file needs the same
  logic, or the first time the logic talks to an external service. Don't create
  the folder before there's something real to put in it.
- Route handlers under `app/api/` should stay thin — parse the request, call into
  `lib/`, return a response. Business logic belongs in `lib/`, not the route file.
- Nothing under `lib/` imports from `app/`. Dependencies flow one way: routes and
  components depend on `lib/`, never the reverse.
- `lib/supabase/admin.ts` (service role, bypasses RLS) is only ever imported from
  server-side code that has a specific reason to bypass RLS (webhooks, background
  jobs). Everything else uses `lib/supabase/client.ts` or `server.ts`, which are
  subject to RLS as the signed-in user.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values, never commit this file
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database changes

Schema changes are SQL migrations in `supabase/migrations/`, applied in filename
order. Every tenant-scoped table must have row-level security enabled with
policies scoped through `business_users` — see the comments in
`supabase/migrations/20260815000001_rls_policies.sql` for the pattern to follow.
