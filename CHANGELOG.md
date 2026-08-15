# Changelog

All notable work, decisions, and open items are logged here, in order. This is
the source of truth for project history alongside `system_design.md`.

## 2026-08-15 — Phase 0: Foundation (done)

**Area:** Repo scaffolding, database schema, RLS.

**What was built:**

- Initialized the Next.js 15.5.23 app (App Router, TypeScript, Tailwind, `src/`
  directory) at the repo root, pinned to major version 15 per system_design.md
  (not 16, which `create-next-app@latest` would otherwise install).
- Laid out the project structure documented in `README.md`: `src/lib/<integration>/`
  per external service, `src/components/`, `src/types/`, `supabase/migrations/`,
  `scripts/`. Folders are created when the phase that needs them starts, not
  pre-scaffolded empty.
- Added Supabase client helpers: `src/lib/supabase/client.ts` (browser, anon key),
  `server.ts` (Server Components/Actions, anon key + session cookie), `admin.ts`
  (service role key, bypasses RLS, guarded with `server-only` so it can never end
  up in a client bundle).
- Wrote the full schema from system_design.md section 2 as SQL migrations:
  - `supabase/migrations/20260815000000_initial_schema.sql` — all 9 tables, enum
    checks, foreign keys, indexes, and the `plan_limits` seed row for free/starter/pro.
  - `supabase/migrations/20260815000001_rls_policies.sql` — RLS enabled on every
    table, policies scoped through a `get_my_business_ids()` SECURITY DEFINER
    helper (avoids recursive-policy issues when `business_users` policies query
    `business_users` itself).
- Added `.env.example` documenting every environment variable the whole project
  will need across all phases (not just Phase 0), so the founder has one
  checklist to work from.
- Verified `npx tsc --noEmit` and `npm run build` both pass cleanly with the new
  lib files in place.
- Created a real Supabase project (founder-owned, free tier) and pushed both
  migrations to it with `supabase db push --db-url ...` (no Docker/local Postgres
  needed for this path — `--db-url` connects straight to the hosted project).
- Wrote `scripts/verify-rls.mjs`, a repeatable smoke test that creates two
  businesses with one signed-in user each via the live project, confirms neither
  user can read or write the other's `businesses`, `business_users`, or
  `knowledge_sources` rows, confirms the public `plan_limits` table is still
  readable by both, then deletes everything it created. Ran it against the real
  project: **8/8 checks passed**, and cleanup was verified (zero leftover test
  rows/users afterward).
- Created three Stripe products/prices in test mode (Free/Starter/Pro) via the
  dashboard; price IDs stored in `.env.local` as `STRIPE_PRICE_FREE`,
  `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`.

**Decisions made (not explicit in system_design.md):**

- **Embedding vector dimension:** set `knowledge_chunks.embedding` to `vector(1536)`
  (OpenAI text-embedding-3-small's dimension) as a schema placeholder. Claude has
  no native embeddings endpoint, so Phase 2 will need a separate embeddings
  provider (likely OpenAI or Voyage AI). No vendor or cost commitment has been
  made — this needs a real decision (and the founder's sign-off, since it's a new
  paid third-party service) before Phase 2 starts calling a real embeddings API.
- **Transactional email provider:** picked Resend over Postmark (system_design.md
  named either as acceptable). Reason: simpler API, generous free tier, no cost
  decision required at this stage. Not wired up yet — Phase 1 needs it for the
  `invoice.upcoming` reminder email.
- **RLS write policies:** for Phase 0, most tenant tables get SELECT policies for
  authenticated business members, but INSERT/UPDATE/DELETE from the app is only
  wired up where Phase 0 needs it (knowledge_sources, and UPDATE on businesses
  for the owner role). Everything else (bookings, chat, usage_logs, business_user
  invites) is written by server-side code using the service role key, since those
  writes happen in later phases via webhooks/background jobs/tool calls, not
  directly from an authenticated client. This can be loosened later if a phase
  needs direct client writes instead.
- **`business_users.auth_user_id` is `NOT NULL`:** no "invited but not yet signed
  up" pending state exists yet. Phase 1's invite flow may need to revisit this
  (e.g. a nullable `auth_user_id` until the invite is accepted).

**Definition of done, checked against system_design.md section 3:**

- ✅ Schema from section 2 exists in Supabase with RLS enabled and tested (a
  query from one business cannot see another business's rows) — verified live,
  see `scripts/verify-rls.mjs` run above.
- ✅ Stripe products exist and their price IDs are stored in environment config.
- ✅ CHANGELOG.md exists and has its first entry.

**Still incomplete / next step:**

- No local dev database exists (no Docker on this machine), so all schema
  changes so far have gone straight to the shared Supabase project. This is fine
  for now (no real customer data exists yet) but worth revisiting once real data
  is on that project — either install Docker for a proper local/staging split,
  or treat the hosted project carefully as both dev and prod until then.
- The embeddings provider decision (see above) still needs to be made before
  Phase 2 starts.
- Next up: Phase 1 (business onboarding and billing) — signup/login, plan
  selection → Stripe Checkout, and the five billing webhooks.
