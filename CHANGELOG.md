# Changelog

All notable work, decisions, and open items are logged here, in order. This is
the source of truth for project history alongside `system_design.md`.

## 2026-08-17 — Founder testing: fixed a real bug on the assistant setup page

Founder tried Phase 2's `/dashboard/onboarding` page after it shipped and hit
a genuine bug: uploaded a photo, saw a green "Saved." banner, but the photo
never actually appeared and no file existed in storage at all.

Root cause: the page has three independent forms (photo upload, persona +
questionnaire, direct system-prompt edit), and all three redirected to the
same generic `?saved=1`. The founder had successfully saved the questionnaire
moments earlier; that leftover "Saved." banner made the *separate*, silently
failed photo upload look like it had succeeded too. The photo itself failed
because it exceeded the old 5MB limit, which real photos/screenshots
routinely do.

Fixed: each action now redirects with its own `saved` value (`photo`,
`persona`, `prompt`) and the page shows a section-scoped confirmation instead
of one shared banner. Raised the photo size limit to 8MB, and the file-size/
type error messages now state the actual values involved rather than a
generic message. Also renamed the save buttons themselves (e.g. "Save name,
bio & generate prompt" vs. "Save prompt text") so it's clear at a glance
which section a click will affect.

**Process note:** this commit initially went out without a changelog entry —
founder caught the omission. Logged here after the fact; the non-negotiable
rule from CLAUDE.md (append an entry after every meaningful chunk of work,
no exceptions for small fixes) stands regardless of how small a change feels
in the moment.

## 2026-08-17 — Phase 2: AI training / RAG (done)

**Area:** File upload, text extraction, chunking, embeddings, onboarding
questionnaire, persona setup.

**What was built:**

- **Upload pipeline** (`/dashboard/knowledge`): PDF, `.docx`, and plain
  text/markdown files upload to a private Supabase Storage bucket
  (`knowledge-sources`, no client-facing storage policies -- everything goes
  through server actions using the service-role client, same pattern as
  other sensitive writes in this project). A `knowledge_sources` row is
  created with `status='processing'` immediately; extraction, chunking, and
  embedding run afterward via Next.js 15's `after()` API so the upload
  request returns instantly rather than blocking on the full pipeline.
- **Text extraction** (`src/lib/knowledge/extract.ts`): plain text read
  directly; `.docx` via `mammoth`; PDF via `unpdf`. Legacy binary `.doc` is
  not supported -- `mammoth` only handles modern OOXML `.docx`, and in
  practice almost all business documents today are `.docx`, PDF, or plain
  text anyway.
- **Chunking** (`src/lib/knowledge/chunk.ts`): a paragraph-aware sliding
  window (~1000 chars, ~150 char overlap) that only hard-splits a paragraph
  that alone exceeds the target size, keeping related sentences together
  where possible.
- **Embeddings** (`src/lib/ai/voyage.ts`): Voyage AI's official TypeScript
  SDK (`voyageai`), `voyage-4-lite`, 1024 dimensions, batched (32 texts/call)
  to stay under Voyage's per-request limits. Uses `inputType: "document"`
  for stored chunks and `inputType: "query"` for search queries -- Voyage
  recommends this distinction for retrieval alignment.
- **Similarity search**: `match_knowledge_chunks(business_id, embedding,
  count)`, a Postgres function (not `SECURITY DEFINER` -- relies on the
  existing RLS policy on `knowledge_chunks` as an independent second scoping
  layer for any caller other than the service role), centralizing the
  tenant-scoped vector search the same way the RLS helper functions
  centralize row-level scoping.
- **Onboarding questionnaire → system prompt** (`/dashboard/onboarding`):
  business type, services, tone, booking rules, FAQs generate a system
  prompt via a deterministic template (`src/lib/onboarding/generate-system-
  prompt.ts`) -- no LLM call. Kept it that way deliberately: Phase 3 owns
  actual Claude integration, and blurring that in here would mean paying for
  and depending on the chat model before Phase 3 exists. The raw
  questionnaire answers aren't persisted separately (schema has no such
  table, and system_design.md doesn't call for one) -- the generated prompt
  *is* the saved artifact, editable afterward via a plain textarea + its own
  save action, satisfying "editable afterward" from the Phase 2 spec.
- **Persona setup**: assistant name/bio save through the same form as the
  questionnaire; photo uploads to a public `assistant-photos` bucket (public
  reads are correct here, unlike knowledge-sources -- Phase 5's embed widget
  needs to show it to website visitors) and updates `assistant_photo_url`.
- Next.js config: raised Server Actions' default 1MB body limit to 20MB
  (`next.config.ts`) so document uploads don't get rejected.

**Decisions made (not explicit in system_design.md):**

- **PDF library swapped mid-build.** `pdf-parse@2.4.5` turned out to be a
  full rewrite depending on `@napi-rs/canvas` (native binary bindings) --
  real deployment-fragility risk on Vercel's serverless environment for what
  should be a simple text-extraction task. Swapped to `unpdf`, built
  specifically for serverless/edge PDF extraction with no native deps,
  before writing any code against the wrong library.
- **Background processing via `after()`, not a job queue.** Vercel-native,
  zero new infrastructure, sufficient for the modest document sizes an SMB's
  FAQs/policies actually are. Revisit with a real queue (Inngest, QStash,
  Trigger.dev) if documents get large enough that `after()`'s execution
  window becomes a real constraint -- not needed at MVP scale.
- **Any accepted business member (owner or staff) can upload/delete
  knowledge documents**, matching the existing `knowledge_sources` RLS
  policies from Phase 0. Only the owner can edit persona/system
  prompt/onboarding (mirrors the Phase 0 decision that owner-only covers
  `businesses` row edits).

**Verified end-to-end** (real dev server, real browser, real Voyage AI API,
real Supabase project) via `scripts/verify-phase2-rag.mjs`: **10/10 checks
passed** -- uploading a real PDF through the actual dashboard UI (not a
simulated pipeline call) produces `ready`-status chunks with 1024-dim
embeddings scoped to the right `business_id`; a similarity search for one
business's content returns only that business's chunks, and explicitly does
*not* return a second business's chunks for the identical query (proves
tenant isolation in vector search, not just structured-row RLS); the
onboarding questionnaire generates a system prompt that visibly reflects the
submitted answers; that prompt is directly editable afterward and persists;
persona photo upload produces a public URL. Cleaned up afterward -- zero
leftover test businesses, auth users, or storage files.

**Real operational finding, not a bug**: Voyage's account has no payment
method on file, capping it at **3 requests/minute** (200M free tokens still
apply regardless, per the Voyage decision entry below). Hit this rate limit
mid-testing from firing embed calls too quickly; the verification script now
paces Voyage calls ~25s apart to stay under it. This will matter for real
usage too -- once Phase 2 (or any later phase) is embedding/searching at any
real volume, a payment method needs to be on file in the Voyage dashboard or
the app will get 429s under normal traffic, not just rapid test scripts.

**Still incomplete / next step:**

- Next up: Phase 3 (chat engine) -- Claude API integration using
  `match_knowledge_chunks` for retrieval, human-like reply pacing, quota
  enforcement, and chat session/message storage.

## 2026-08-17 — Closed out the two remaining Phase 1 gaps

Continuing founder manual testing from 2026-08-15. Both open items from that
session are now resolved.

**Custom SMTP fixed.** The "Error sending confirmation email" error was a
misconfigured Supabase SMTP Username: it was set to the founder's account
name (`shajidur171`) instead of the literal, fixed string `resend` that
Resend's SMTP relay requires as username regardless of whose account it is.
Corrected in the Supabase dashboard; signup with a fresh email now works.

**Local Stripe webhook delivery solved with the Stripe CLI.** Real Checkout
completions were reaching Stripe fine, but nothing was listening on the
webhook endpoint, so business records never updated after a real payment
(the "one thing that can't be verified in this environment" gap from Phase
1 -- turns out it needed solving sooner than expected, since manual testing
surfaced it immediately). No package manager was available to install it
(no choco/scoop), so downloaded the Windows binary directly from
`stripe-cli`'s GitHub releases to `.tools/stripe.exe` (gitignored -- it's a
downloaded tool, not project source). Running
`stripe listen --forward-to localhost:3000/api/webhooks/stripe` forwards
real test-mode events to the local server in real time; its session webhook
signing secret replaced the self-generated placeholder in
`STRIPE_WEBHOOK_SECRET`. This should stay running during any future local
billing testing.

**Two businesses manually synced to match Stripe's actual state**, since
their real checkout completions happened before the above was set up and
Stripe won't retry old, permanently-failed-to-deliver events on its own:
"Man Feshiopn" (created during today's real signup+checkout test) updated to
`plan=starter`, `status=active`, with its real `stripe_customer_id`/
`stripe_subscription_id` attached -- applied by hand, mirroring exactly what
`checkout.session.completed` would have done. "Wallxer" (the manually-
attached test business from 2026-08-15) has an old completed session too
(`cs_test_...HfvK...`, 2026-08-15) but was left as-is since it was only ever
a throwaway login/dashboard test fixture, not a real signup -- flagging here
in case its stale Stripe session causes confusion later.

Both "Known gaps" items this closes have been removed from that list below.

## 2026-08-15 — Code review: Phase 0 + Phase 1 (done)

Founder asked for a full review of everything built so far for cleanliness
and scalability before starting Phase 2. Ran a structured review (correctness
+ simplification/scalability) over both migrations, all RLS policies, and
every file under `src/`. Six real findings, all fixed and re-verified against
the live Supabase/Stripe test accounts (not just re-read):

- **Signup/invite could attach a stranger's real account as business
  owner.** Supabase's `auth.signUp()` never errors for an email that already
  has an account (anti-enumeration): for an already-*confirmed* email it
  returns an obfuscated placeholder id (caught incidentally by the
  `business_users.auth_user_id` foreign key, which rejects the fake id), but
  for an *unconfirmed* existing account it returns that person's **real** id
  with no error -- verified empirically against this project. Confirmed via
  a second test that resubmitting signUp does NOT change that account's
  password (not an account-takeover path), but without a check, our code
  would silently create a business and attach a real stranger's `auth_user_id`
  as its owner. Added `src/lib/auth/fresh-signup.ts` (`isFreshSignup`): a
  signup only proceeds if Supabase returned actual new identities AND
  `created_at` is within the last minute -- both signals are needed, since
  age alone doesn't apply to the empty-identities case and identities alone
  doesn't apply to the unconfirmed-real-user case. Applied in both
  `signup/actions.ts` and `invite/[token]/actions.ts`.
- **`getCurrentBusinessContext` crashed for any user with more than one
  accepted business membership.** Nothing in the schema prevents that (e.g.
  invited to a second business), but `.single()` throws on >1 rows, which
  would have looped a legitimate user back to `/login` forever. Changed to
  `.order("created_at").limit(1)` -- picks the earliest membership rather
  than crashing. (A real business-switcher is out of scope for now; this
  just stops it from being a crash.)
- **Switching plans created a second, independently-billed subscription**
  instead of replacing the first -- `/plans` only disabled the *current*
  plan's button, so picking a different one always called Checkout again.
  `/api/checkout` now updates the existing subscription's price in place
  (`stripe.subscriptions.update`) when one already exists, instead of
  creating a new Checkout session; the resulting plan change flows through
  a new `customer.subscription.updated` webhook case, same as every other
  billing-state change. `customer.subscription.deleted` was also hardened to
  only cancel a business when the deleted subscription actually matches
  `stripe_subscription_id` on file -- otherwise a stale/superseded
  subscription being canceled elsewhere could wrongly lock out a business
  whose real current subscription is unaffected.
- **A race in the webhook idempotency check** could let two near-simultaneous
  deliveries of the same event both pass the "already processed?" check and
  both run the handler (e.g. two reminder emails for one invoice). Rewritten
  as claim-then-process-then-release-on-failure: the insert into
  `processed_stripe_events` is now the atomic claim itself (only one
  concurrent request can win it), and if processing throws, the claim is
  deleted so a genuine retry can still finish the job -- combining the
  earlier ordering fix (Phase 1 log below) with actual concurrency safety.
- **`business_users.invite_token` was readable by any team member**, not just
  the owner who created the invite -- the RLS policy is row-scoped (any
  member of the business), and RLS doesn't gate individual columns. Since the
  anon key is public (shipped to the browser), any authenticated team member
  could query `invite_token` directly via `@supabase/supabase-js`, bypassing
  the fact that the app's own queries never select it. Locked down at the
  grant level (same pattern as the Phase 1 `businesses` column lockdown):
  `REVOKE SELECT ... FROM authenticated` + `GRANT SELECT (id, business_id,
  email, role, status, created_at, auth_user_id)` -- `auth_user_id` is
  included even though it's never displayed, because Postgres column grants
  also gate columns referenced in `WHERE` clauses, and
  `current-business.ts` filters on it.
- **Currency formatting was duplicated** between `/plans` and the webhook's
  `invoice.upcoming` case. Extracted to `src/lib/format.ts`
  (`formatCurrency`), used by both -- one place to update before Phase 6
  analytics inevitably needs to format amounts too.

**Re-verified after all fixes** (new migration pushed to the real Supabase
project; full rebuild; all real, not re-derived from memory):

- `scripts/e2e-phase1.mjs` (7/7) and `scripts/verify-billing-webhooks.mjs`
  (14/14) both still pass unchanged -- the column lockdown and idempotency
  rewrite didn't regress anything already verified in Phase 1.
- `scripts/verify-plan-switch.mjs` (new, 9/9): switching plans via the real
  `/plans` UI leaves exactly one subscription on the Stripe customer with the
  new price (not two); the resulting `customer.subscription.updated` event
  correctly updates `business.plan`; a stale/unrelated subscription being
  deleted does NOT cancel the business; deleting the business's actual
  current subscription does.
- `isFreshSignup`'s boundary conditions (5/5, direct logic test): new
  signup allowed; empty-identities existing user blocked; non-empty-identities
  existing user from 2 minutes / 3 days ago both blocked; missing identities
  field defensively blocked.
- Attempted a full live re-test of the guard through the real `/signup` form
  against a real unconfirmed victim account
  (`scripts/verify-fresh-signup-guard.mjs`): repeatedly hit Supabase's
  email-sending rate limit (exhausted by everything else tested today)
  before reaching the code path being tested, so the exact "already
  registered" error message wasn't re-confirmed live. What DID come through
  clearly both times: no business was created, the victim's account gained
  zero `business_users` rows, and their original password still worked
  afterward -- i.e. the dangerous outcome doesn't happen, even though the
  specific UI error text is unconfirmed live. Combined with the direct logic
  test and the earlier empirical probes of Supabase's exact response shapes,
  this is good enough to consider fixed, but worth a real manual signup
  attempt with a duplicate email once the rate limit has cooled off.
- One unrelated observation surfaced while checking cleanup: an auth account
  for the founder's own email exists with no business attached and no sign-in
  recorded. Not created by any test script (none use that email) -- flagged
  to the founder rather than deleted, since it might be real (manual
  poking-around signup) rather than test debris.

## 2026-08-15 — Decision change: embeddings provider is Voyage AI, not OpenAI

Founder changed the Phase 0 embeddings decision: Voyage AI instead of OpenAI,
specifically **voyage-4-lite** rather than the flagship voyage-4. Reasoning:
the documents being embedded here (FAQs, service descriptions, booking
rules, business policies) are short and semantically straightforward --
not the dense technical/legal content where voyage-4's extra quality would
earn its higher per-token cost. voyage-4-lite is meaningfully cheaper, which
matters for a product with a free tier.

Dimension changed accordingly: Voyage's voyage-4/voyage-4-lite default to
**1024** dimensions (not OpenAI's 1536), with Matryoshka truncation available
down to 256/512 if storage or query latency ever become a concern. Chose to
keep the full 1024 rather than truncating -- at MVP scale, storage isn't a
bottleneck, and truncating trades away retrieval quality preemptively for a
saving that isn't needed yet. Revisit if `knowledge_chunks` grows large
enough for HNSW index size/query latency to matter.

Applied via `supabase/migrations/20260815120000_voyage_embedding_dimension.sql`
(drops and recreates the HNSW index around the column type change, rather
than relying on `ALTER COLUMN TYPE` to rebuild it implicitly) -- safe since
`knowledge_chunks` is still empty, Phase 2 hasn't started writing to it yet.
Verified functionally against the real Supabase project: inserting a
1536-dimension vector now fails ("expected 1024 dimensions, not 1536"),
inserting a 1024-dimension vector succeeds.

`.env.example`/`.env.local`: `OPENAI_API_KEY` replaced with `VOYAGE_API_KEY`.
Founder is signing up for a Voyage AI account and adding the key directly to
`.env.local`.

**Cost note, not yet a live spend**: Voyage's signup grant is a **one-time
free token allotment, not a recurring monthly allowance** -- unlike some
providers' ongoing free tiers, this is a bank that depletes and doesn't
refill. Once Phase 2 is embedding real documents at any volume, budget for
this as a real, metered cost from the start rather than assuming it's free
indefinitely.

## 2026-08-15 — Founder manual testing session (paused, continues next session)

Founder tried the real app in a browser before starting Phase 2 (login,
signup, dashboard). Found and worked through several environment issues that
weren't code bugs:

- An existing Supabase auth account (founder's own email) had been created
  directly in the Supabase dashboard rather than through the app's signup
  form, so it had zero `business_users` rows -- login worked, but the
  dashboard correctly bounced it back to `/login` since it had no business to
  show. Not a bug: this is the intended behavior for an account with no
  membership. Fixed by attaching that existing account as owner of a new
  business, **Wallxer** (`business_id` created via a one-off admin script),
  so the founder could get into the dashboard immediately without waiting on
  anything.
- Hit Supabase's shared default email-sending rate limit again when trying
  to submit the real signup form (exhausted by all of today's automated
  testing). Decided to fix this properly rather than just wait it out:
  configured Resend as Supabase Auth's custom SMTP (Authentication → Emails →
  SMTP Settings: host `smtp.resend.com`, port 587, username `resend`,
  password = the Resend API key), which routes auth emails through the
  founder's own Resend account instead of Supabase's shared low-quota
  service.
- That surfaced the sandbox-sender restriction directly: with an unverified
  sending domain, Resend only delivers to the account's own registered
  email, so signing up with a different test address failed
  ("Error sending confirmation email", 500 on `/auth/v1/signup`). Founder
  had already verified a real domain in Resend, **falahchat.com**
  (interesting: this may be the actual intended product/brand name, distinct
  from the `chatx` working repo name -- not confirmed, just noting it here
  in case it's relevant later e.g. for the Phase 5 embed widget's default
  branding or Phase 7's landing page). Updated `RESEND_FROM_ADDRESS` in
  `.env.local` to `Falah Chat <noreply@falahchat.com>` to use it for our own
  transactional emails (the `invoice.upcoming` reminder).

**Still open, continue here next session:** after verifying `falahchat.com`
in Resend, signup was *still* failing with the same "Error sending
confirmation email" error. The Supabase dashboard's SMTP "Sender email"
field likely still has the old sandbox address (`onboarding@resend.dev`)
rather than an address on the newly-verified domain -- that field needs to
be updated to something like `noreply@falahchat.com` and saved. Founder ran
out of time to check/fix this today. Next session: confirm that field, retry
signup with a fresh email, and if it still fails, pull the exact SMTP error
from Supabase's Auth logs (Logs → filter to Auth, or the entry logged around
14:34 today) rather than guessing further.

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
- **Voyage AI has no payment method on file**, capping it at 3 requests/min
  regardless of the free token balance. Fine for light testing, not fine
  once Phase 2 (or Phase 3's chat retrieval) sees any real traffic — add a
  payment method in the Voyage dashboard before that happens, or expect 429s.
- **`stripe listen` must be running for local billing testing to actually
  update business records.** It's a manual foreground process
  (`.tools/stripe.exe listen --forward-to localhost:3000/api/webhooks/stripe`)
  -- if it's not running when a real Checkout completes locally, that event
  is gone for good (Stripe doesn't retry a delivery attempt to an endpoint
  that was never listening). Worth remembering to start it before any future
  local Checkout testing, and something to make foolproof later (e.g. a
  `predev` script reminder, or just always test against a deployed
  environment with a real registered webhook endpoint instead).
- "Wallxer" (test business from 2026-08-15) has a real completed Stripe
  Checkout session from before webhook forwarding existed, never synced --
  see the 2026-08-17 entry above. Low priority (throwaway test fixture), but
  if it causes confusion later, that's why.

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
