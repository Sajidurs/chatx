# Changelog

All notable work, decisions, and open items are logged here, in order. This is
the source of truth for project history alongside `system_design.md`.

## Known gaps

Living list of things intentionally left unresolved, so they don't get lost.
Remove an item once it's actually fixed (and note where/when in the dated log
below) rather than leaving it here stale.

- **No local/staging environment.** No Docker on this dev machine, so
  `supabase start` can't run locally — every schema change so far has gone
  straight to the one shared (founder-owned) Supabase project. Fine while no
  real customer data exists. Revisit before launch (Phase 7): either get Docker
  installed for a proper local/staging split, or stand up a second hosted
  Supabase project as staging.
- **The one thing that can't be verified in this environment**: a real
  Checkout completion delivering a real webhook from Stripe's own servers.
  Stripe can't reach `localhost`, and there's no Docker/Stripe CLI here to
  tunnel it. Everything the webhook handler does has been verified with real
  Stripe test-mode objects and realistically-shaped signed events instead (see
  Phase 1) -- but the founder should do one real manual Checkout (test card
  `4242 4242 4242 4242`) once this is deployed somewhere with a public URL, or
  locally via the Stripe CLI if installed, to see the full real flow once.

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

- **Embeddings provider: confirmed as OpenAI `text-embedding-3-small`** (2026-08-15,
  founder sign-off). `knowledge_chunks.embedding` is `vector(1536)`, which already
  matches this model's output dimension, so no schema change is needed. Key is
  `OPENAI_API_KEY` in `.env.example`/`.env.local`. This was the one placeholder
  decision from Phase 0 that explicitly needed the founder's approval before any
  money could be spent on it (new paid third-party service) — it's now settled,
  ahead of Phase 2 actually calling the API.
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

## 2026-08-15 — Phase 1: Business onboarding and billing (in progress)

**Area:** Auth, staff invites, Stripe Checkout, billing webhooks.

**What was built:**

- Signup (`/signup`) creates the auth user, then the business + owner
  `business_users` row via the service-role client (the auth user exists
  immediately even if email confirmation is pending, so this doesn't need to
  wait on that). Rolls back (deletes the auth user/business) if either insert
  fails, so a failed signup doesn't leave an orphaned account.
- Login (`/login`), logout (`POST /auth/signout`), and the email-confirmation
  callback (`/auth/callback`) using `@supabase/ssr`. Added `src/middleware.ts` +
  `src/lib/supabase/middleware.ts` to refresh the session cookie on every
  request, per Supabase's documented Next.js App Router pattern.
- **Staff invites**, closing the gap flagged above: `business_users` migration
  (`20260815100000_phase1_billing_and_invites.sql`) makes `auth_user_id`
  nullable and adds `status` (`pending`/`accepted`) + `invite_token`. An owner
  invites by email from `/dashboard/team` (service-role insert, after
  server-side verification the caller is actually an owner); the page shows a
  shareable `/invite/[token]` link rather than auto-emailing it for now, since
  Resend wiring is separate. The invite page handles both cases: a brand-new
  person creates an account (`acceptInviteViaSignup`, calls `auth.signUp` then
  links the row) or an already-logged-in matching-email user just confirms
  (`acceptInviteViaSession`). Both funnel through one guarded UPDATE
  (`src/lib/auth/accept-invite.ts`) that only succeeds while the invite is
  still `invite_token` + `status='pending'`, so a reused/stale link is a no-op.
- **Column-level lockdown on `businesses`**: while building the plan/billing
  fields, noticed the existing "owner can update their business" RLS policy
  from Phase 0 was row-scoped only, not column-scoped -- an authenticated
  owner could have directly UPDATEd their own `plan`/`status`/
  `stripe_customer_id` and granted themselves Pro for free. Fixed via
  `REVOKE UPDATE ... FROM authenticated` + `GRANT UPDATE (assistant_name,
  assistant_photo_url, assistant_bio, system_prompt) ... TO authenticated` in
  the same migration, so billing fields are only ever writable by the service
  role (webhooks).
- **Plan selection & Checkout**: `/plans` reads live price amounts from Stripe
  (`stripe.prices.retrieve`) rather than hardcoding them, so displayed prices
  can't drift from what's actually configured. All three plans, including
  Free, route through Stripe Checkout (`/api/checkout` → subscription-mode
  Checkout Session) rather than special-casing Free as a direct server-side
  plan change -- keeps one code path for every plan assignment, all driven by
  the webhook, matching system_design.md's literal "picks a plan, pays monthly
  through Stripe."
- **Webhook handler** (`/api/webhooks/stripe`) verifies the Stripe signature
  and handles all five required events: `checkout.session.completed` (sets
  `stripe_customer_id`/`stripe_subscription_id`/`plan`/`status=active`),
  `invoice.upcoming` (sends the reminder email), `invoice.paid` (resets
  `usage_logs` for the month, clears `past_due_at`), `invoice.payment_failed`
  (sets `status=past_due`, stamps `past_due_at` -- but only if not already
  set, so repeated failed retries don't keep resetting the grace-period
  clock), `customer.subscription.deleted` (sets `status=cancelled`). Added a
  `processed_stripe_events` table so a redelivered event is a clean no-op
  instead of double-applying a usage reset or a billing state change.
- **Grace-period access control**: rather than inventing a new `businesses`
  status, "restricted" is computed at read time in
  `src/lib/billing/access.ts` (`isBusinessRestricted`): `cancelled` is always
  restricted, `past_due` is restricted once `GRACE_PERIOD_DAYS` (3, our own
  risk tolerance, independent of Stripe's own retry/dunning schedule) has
  elapsed since `past_due_at`, `active` never is. Enforced today at the
  dashboard layout level (banner + implicitly gates the rest of the
  authenticated app); Phase 3 (message quota) and Phase 6 (booking tools) will
  reuse this same helper rather than re-deriving the logic.
- Installed Playwright (`@playwright/test`, dev-only) to drive the real UI in
  a real browser for verification, rather than only testing internals.
- **Webhook idempotency bug caught during testing, fixed before it shipped**:
  the first version recorded an event as processed *before* running its
  handler, on the theory that a redelivery should short-circuit. That's
  backwards -- if the handler throws partway through (e.g. the reminder email
  step fails), the event was already marked done, so Stripe's automatic retry
  of that same event would be silently swallowed as "already processed" and
  the failed effect (an unsent email, or worse, a missed usage reset) would
  never actually happen. Fixed to check-then-process-then-record: look the
  event up first (no-op if found), run the handler, and only insert into
  `processed_stripe_events` after the switch completes without throwing. A
  concurrent duplicate hitting the final insert is treated as fine (the effect
  was already applied by whichever request got there first).

**Decisions made (not explicit in system_design.md):**

- All three plans (including Free) go through Stripe Checkout -- see above.
- Invite links are shown to the owner to share manually, not auto-emailed.
  Cheap to add later (Resend is already wired up for the billing reminder) if
  that turns out to matter.
- `GRACE_PERIOD_DAYS = 3` for the payment-failure grace period. Founder can
  adjust; this is our own choice, not something Stripe dictates.

**Verified (real Supabase project, real Stripe test-mode account, real dev
server, real browser where relevant):**

- Along the way, the Stripe secret key in `.env.local` turned out to belong to
  a *different* Stripe account than the one the three price IDs were created
  in (`stripe.products.list()`/`prices.list()` returned zero results under the
  original key). The founder pasted the correct key; all three prices then
  resolved correctly ($0/$19/$39, all confirmed `testmode`).
- `scripts/e2e-phase1.mjs` drives login → invite → accept → plans against
  `npm run dev` with Playwright, checking real database state after each step,
  then cleans up everything it creates. **7/7 checks passed**:
  login redirects to `/dashboard` and shows the business name; inviting staff
  creates a `pending` row with a working `/invite/<token>` link; accepting as
  an already-registered, logged-in matching-email user
  (`acceptInviteViaSession`) flips the row to `accepted`, clears the token,
  sets `auth_user_id`, lands on `/dashboard`; `/plans` renders real live
  Stripe amounts ($0.00 / $19.00 / $39.00), not hardcoded ones. (Signup itself
  -- business + owner row creation -- and `acceptInviteViaSignup`, the
  brand-new-user invite branch, were exercised manually against the real
  signup/invite forms rather than in this repeatable script, to avoid burning
  Supabase's low default email-sending rate limit on every run; both worked.)
- `scripts/verify-billing-webhooks.mjs` creates a real Stripe test-mode
  customer + subscription (using Stripe's `pm_card_visa` test payment method)
  and fires realistically-shaped, correctly-signed events at the running
  webhook endpoint (`stripe.webhooks.generateTestHeaderString`, the
  Stripe-documented way to test a webhook handler without the CLI, which
  isn't installed here). **14/14 checks passed**: `checkout.session.completed`
  correctly sets `plan=starter`, `status=active`, and both Stripe ids from a
  real subscription lookup; a redelivered event is a no-op; `invoice.paid`
  clears `past_due` and resets that month's `usage_logs` to 0;
  `invoice.payment_failed` sets `status=past_due` and stamps `past_due_at`
  once, and a second failure event does not reset that clock (grace period
  isn't restarted by repeated retries); `customer.subscription.deleted` sets
  `status=cancelled`; an invalid/tampered signature is rejected with 400.
  `invoice.upcoming` initially failed (500, Stripe would have retried)
  because `RESEND_API_KEY` wasn't set yet -- everything up to the email send
  (looking up the business and owner by Stripe customer id) worked.
- Both scripts confirmed clean afterward: zero leftover test businesses, auth
  users, Stripe customers, or `processed_stripe_events` rows.
- **`RESEND_API_KEY` added; `invoice.upcoming` verified end-to-end.**
  `scripts/verify-reminder-email.mjs` creates a test business whose owner
  email is the founder's real inbox (Resend's sandbox sender --
  `onboarding@resend.dev`, used since no custom domain is verified yet -- can
  only deliver to the account's own registered address), fires a real signed
  `invoice.upcoming` event at the webhook endpoint, and confirms a 200
  response. Founder confirmed the email actually arrived. Cleaned up
  afterward (business, auth user, Stripe customer, dedup row all removed).

**Still incomplete / next step:**

- The one thing that genuinely can't be verified from this environment: a
  real Checkout completion delivering a real webhook from Stripe's own
  servers (Stripe can't reach `localhost`, and there's no Docker/Stripe CLI
  here to tunnel it). Recommended manual test once deployed (or locally via
  the Stripe CLI if installed later): complete one real test-mode Checkout
  with card `4242 4242 4242 4242`, confirm the business record updates and a
  real webhook arrives.
- Once that's done, Phase 1 will be fully complete against
  system_design.md's definition of done.
