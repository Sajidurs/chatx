# Changelog

All notable work, decisions, and open items are logged here, in order. This is
the source of truth for project history alongside `system_design.md`.

## 2026-08-19 — Fixed: AI seemed to ignore context after a human handed a conversation back

Founder reported: after taking over as a human a few times, handing back to
the AI would get replies that ignored what had actually been discussed.
Reproduced directly (not guessed at) with a real conversation: business
agent replies "Your tracking number is TRK-999888777" (or similar), hand
back to the AI, ask it to repeat that back. Found **two separate real bugs**
stacked on top of each other, both now fixed.

**Bug 1 -- non-alternating history confuses Claude.** Both the AI's own
replies and a human agent's replies are stored with different DB roles
(`assistant` vs `business`) but both map to Claude's `"assistant"` role when
building conversation history. Several business messages sent in a row with
no visitor message between them (completely normal -- "let me check" / "found
it" / "here's the answer") produced multiple **consecutive** `"assistant"`
turns in the request to Claude. The API itself didn't reject this, but
confirmed directly: Claude recalled a fact correctly when it was the *only*
prior assistant turn, but reliably failed to recall the same fact once three
consecutive assistant-role turns preceded it. Fixed in `respond.ts` by
coalescing consecutive same-role turns into one (joined by newlines) before
sending to Claude -- gives it the well-formed alternating structure it's
actually trained on, with identical actual content.

That alone didn't fully fix it -- even with clean alternating turns, Claude
would sometimes still deflect ("I don't have that in front of me") right
after a stretch of human-authored replies specifically. Nothing in the
system prompt told it those earlier turns were trustworthy, already-said
parts of *this* conversation rather than something to be freshly cautious
about. Added an explicit instruction: earlier replies may have come from a
team member instead of the AI itself, but everything already said in the
conversation should be treated as established fact it can reference and
repeat confidently.

**Bug 2 -- a real reply-corruption bug, found while investigating, unrelated
to handoff at all.** `splitIntoMessages` (`src/lib/chat/pacing.ts`) -- the
function that splits a reply into separate chat bubbles -- used a regex
(`[^.!?]+[.!?]*(\s+|$)`) that excluded periods from its "ordinary content"
character class entirely. A decimal number not followed by whitespace (a
price like "$45.00", a version like "2.0") has no valid way to be matched:
the period can only be consumed as a sentence-ending terminator, and that
requires whitespace or end-of-string right after it, which a mid-number
period never has. The regex engine just kept advancing past whatever it
couldn't match -- silently **dropping** that entire chunk of text. Confirmed
directly: a reply saying "...your refund of $45.00 was processed..." came
back to the visitor as "Your refund was 00." -- the model actually had the
right answer, our own post-processing corrupted it before it ever reached
the widget. This would have hit *any* reply mentioning a price, a version
number, or similar -- nothing specific to human handoff, just more likely to
surface right after it since that's when questions like "what was the
number again?" naturally come up. Fixed the regex to only treat a
terminator as a real sentence break when followed by whitespace or the end
of the string (`[\s\S]+?[.!?](?=\s|$)|[\s\S]+$`).

**Decisions made (not explicit in system_design.md):** none beyond the fixes
themselves -- both are straightforward correctness bugs, not product
direction calls.

**Verified:**

- Reproduced both bugs directly against the real dev server before fixing
  anything (a garbled "$45.00" reply, a dropped tracking number after three
  consecutive human replies), confirmed each fix resolves its case, using
  properly Voyage-rate-limit-paced real `/api/chat` calls throughout.
- `scripts/verify-pacing-split-fix.mjs` (new) -- unit-level check (imports
  the real function directly via `node --experimental-strip-types`, no
  server/DB/Claude needed): a price is preserved intact, a version number is
  preserved intact, a reply with no trailing punctuation isn't dropped, a
  short multi-sentence reply still groups into one bubble as designed
  (confirmed that's not a regression -- `splitIntoMessages` intentionally
  groups short sentences together up to 160 chars per bubble), and a longer
  reply still does split into multiple bubbles once over that limit. **5/5
  passed.**
- Re-ran `verify-phase3-chat.mjs` (13/13) and `verify-chat-fixes.mjs` (8/8)
  in full, since both `respond.ts` and `pacing.ts` are shared by every chat
  turn regardless of feature -- confirmed nothing regressed.
- Full local `npm run build` passed clean.

**Still incomplete / next step:** none for this item.

## 2026-08-19 — Fixed five real bugs/gaps the founder found testing human takeover live, plus unread + sound

Founder tested the human takeover feature live and reported five things.
Investigated each on the real dev server rather than guessing from the code.

**1. A reply sent from the dashboard while a human had taken over didn't
show up on the widget until the visitor manually refreshed the page.**
Real root cause, found by testing a *fresh* conversation without ever
reloading (the existing regression script always reloaded first, which
accidentally papered over this): the widget's polling effect depended on
`open`/`leadCaptured`, but the session ID only becomes known asynchronously
via a **ref** mutation (`sessionIdRef.current = ...`), which does not itself
trigger a re-render -- so for a brand-new visitor's first conversation, the
polling interval never actually started at all. It only ever looked "fixed"
after a reload because a full remount re-runs the mount effect with the
session ID already in hand. Fixed by adding a `sessionKnown` state twin that
flips true exactly when the ref does, and keying the polling effect off that
instead. Also hardened against a second, unrelated possible cause (a poll
response being cached somewhere -- Vercel/CDN/browser) by adding
`export const dynamic = "force-dynamic"` + `Cache-Control: no-store` to
`/api/chat/messages`, and `cache: "no-store"` on every fetch to it -- cheap
insurance even though the ref/state bug above was the real cause. Also added
a `visibilitychange`/`focus` listener that polls immediately when the tab
becomes active again, since browsers throttle `setInterval` hard in a
backgrounded tab (exactly what happens when someone switches to a separate
dashboard tab to reply as a human, which is the normal way to use this
feature) -- belt-and-suspenders alongside the real fix.

**2. Sending a reply from the dashboard felt slow.** Measured precisely with
Playwright: 1796ms from click to the message appearing. Root cause: the
optimistic UI update (`setMessages(...)`) was called *before* `startTransition`,
which looks correct, but the whole handler was wired to `<form action={fn}>`
-- passing a function to a form's `action` prop hands the entire handler to
React's form-action machinery, which defers it until the pending
transition/server round-trip resolves, rather than committing synchronously.
Switched to a plain `onSubmit={(e) => { e.preventDefault(); ... }}` handler
(the same pattern the widget's own send button already used correctly) and
simplified `sendBusinessReply` to take plain `(sessionId, message)` args
instead of `FormData` (no more need for the form-action wiring at all).
Re-measured: 63-81ms.

**3. The visitor couldn't type or send a follow-up while the AI was still
replying to the previous message** (the input was `disabled={sending}`).
Removing the disable outright isn't safe on its own -- the backend processes
one message per request against shared conversation state (history,
quota, tool calls), so two `/api/chat` calls in flight at once for the same
session would race. Fixed with a small client-side queue instead: typing and
hitting send is never blocked; if a send happens while one is already in
flight, it's queued and dispatched automatically the moment the current one
finishes. Requests still go out one at a time; nothing about typing does.

**4. No way for the business to see which conversations have new visitor
activity vs. already read.** New `chat_sessions.last_visitor_message_at` /
`last_seen_by_business_at` columns (migration
`20260820000000_conversation_unread_tracking.sql`, backfilled so existing
conversations don't all retroactively show as unread the moment this
ships). `last_visitor_message_at` is stamped only on a *visitor* message
(not the business's own reply, so answering someone doesn't make their own
conversation look unread to the business again) in `respond.ts`, alongside
the existing `last_message_at`. `last_seen_by_business_at` is stamped by a
new `markConversationSeen` action, called once from an effect the moment the
conversation detail page actually mounts in a browser -- deliberately not
done during the page's own server render, since a Next.js link prefetch
only fetches the RSC payload and never runs client effects, so doing it
there would mark something "seen" before anyone looked at it. The
conversations list computes `unread = last_visitor_message_at >
last_seen_by_business_at` per row and shows a small dot + bold visitor name.

**5. Sound + minimize + close on the widget.** Clarified with the founder:
just the sound, keep the existing minimize (the X button already collapses
back to the bubble) and close behavior as-is. Added a short two-tone chime
synthesized with the Web Audio API (no hosted audio file needed) that plays
whenever a message arrives via polling -- deliberately not for the AI's
direct reply to the visitor's own message (they're already looking right at
it then), only for messages discovered independently, which is also
specifically the scenario where a notification is actually useful. Polling
itself was also extended to keep running while the panel is minimized (it
previously stopped entirely when closed), which is what makes the sound
able to fire while minimized at all.

**Decisions made (not explicit in system_design.md):**

- Unread tracking distinguishes "seen by the business" from the AI's own
  `needs_handoff` flag -- they answer different questions (new customer
  activity vs. "the AI explicitly got stuck") and both stay visible
  independently on the conversations list.
- The notification sound only fires for messages surfaced via polling, not
  every single incoming message -- confirmed this reads as the intended
  behavior (only "unprompted" messages need a sound; a direct reply to your
  own just-sent message doesn't).

**Verified (real dev server, real Supabase, real browser):**

- `scripts/verify-chat-fixes.mjs` (new) -- drives a real fresh conversation
  through the real widget with **zero reloads**, an admin takeover + reply,
  and confirms all five fixes end-to-end in one flow: input stays enabled
  and a queued follow-up actually sends while the AI is still replying to
  the first message; the conversations list shows unread before the
  conversation is opened and clears after; the admin's reply appears in
  under 100ms; the visitor's still-open, never-reloaded page picks up the
  reply via polling alone; a notification sound (`AudioContext`) fires when
  it arrives; zero uncaught client-side errors throughout. **8/8 passed,
  confirmed reliably repeatable (ran twice).**
- Re-ran the full existing regression suite after these changes:
  `verify-phase6-dashboard.mjs` (11/11, conversations list still renders and
  RLS isolation is intact with the new columns selected).
- `scripts/verify-takeover-and-history.mjs` (the older, narrower script this
  session started from) intermittently failed while re-verifying -- root
  cause confirmed to be `next dev`/Turbopack lazily recompiling a route and
  pushing a Fast Refresh mid-request, which can drop an in-flight fetch's
  continuation. This is purely a dev-server artifact (production has no
  on-demand compilation or HMR at all) that got more likely to trigger after
  a long day of many consecutive test runs against one long-running `next
  dev` process, not a regression -- confirmed by reproducing the exact same
  flow in isolation both with and without the timing collision. Added a
  settle wait to that script as a mitigation, but `verify-chat-fixes.mjs`
  above is the more reliable, more thorough replacement for validating this
  flow going forward.

**Still incomplete / next step:** none for these five items. Phase 7 (launch
prep) and the Google OAuth verification process (see 2026-08-19 entry below
about the redirect URI) remain the open next steps whenever the founder wants
to pick them up.

## 2026-08-19 — Fixed: bookings made with a bare time were treated as literal UTC

Closes the "Known gaps" item logged 2026-08-18: a real Wallxer test booking
where the visitor said "10AM" (no timezone -- how real customers actually
talk) got booked 6 hours off, since nothing in the system knew the business's
real local timezone.

**What was built:**

- `businesses.timezone` (text, defaults to `'UTC'` so no existing business's
  behavior silently changes) -- new migration
  `20260819000000_business_timezone.sql`, same column-level grant pattern as
  the other owner-editable persona fields.
- A new **Timezone** card on `/dashboard/onboarding`, a dropdown of every IANA
  timezone name (`Intl.supportedValuesOf("timeZone")`, built into Node 18+ --
  no timezone-data package needed), owner-only, same save-and-confirm pattern
  as the existing persona/prompt forms.
- `respond.ts`'s date context now states the current date/time in the
  business's own timezone (not UTC), and explicitly tells Claude: when a
  customer gives a bare time with no timezone, assume the business's local
  time; when calling any booking tool, give times as a bare local wall-clock
  string with **no** UTC offset or "Z" suffix.
- `calendar.ts`'s `createCalendarEvent`/`patchCalendarEvent` now pass a
  `timeZone` field alongside `start`/`end` -- this is what makes a bare local
  string like `"2026-08-20T10:00:00"` actually mean 10AM in the business's own
  timezone on the real Google Calendar, instead of being silently treated as
  UTC (the original bug).
- New `resolveToUtcIso(raw, timeZone)` helper (`src/lib/timezones.ts`):
  converts a bare local wall-clock string into a real UTC instant (the
  standard two-pass `Intl.DateTimeFormat` trick, since Node has no stable
  Temporal API yet), or trusts an existing offset/"Z" as-is if Claude adds one
  anyway. Used for our own `bookings.start_time`/`end_time` (`timestamptz`
  columns) -- a bare string handed straight to Postgres would otherwise be
  parsed in the *server's* session timezone, not the business's, which is the
  exact same bug moved one layer down.

**A second real bug found while verifying, fixed before it shipped:** Google's
`freebusy.query` endpoint (used by `check_availability`) does **not** support
a bare local datetime the way `events.insert`/`events.patch` do -- confirmed
directly against the real API, a bare `timeMin`/`timeMax` with no offset is
rejected outright with a 400, even with a sibling `timeZone` field set. Fixed
by resolving `check_availability`'s times to a real UTC instant (via the same
`resolveToUtcIso`) before calling Google, inside `calendar.ts`'s
`checkAvailability` -- callers still just give the bare local time Claude
produced.

**Decisions made (not explicit in system_design.md):**

- No check constraint validating `timezone` against Postgres's own
  `pg_timezone_names` (a check constraint can't contain a subquery) --
  validated instead at the application layer, against the same
  `Intl.supportedValuesOf("timeZone")` list the dropdown is built from, so the
  UI and the validation can never drift apart.
- Did not add a timezone field to signup -- kept it in onboarding alongside
  the other business-level assistant settings, where an owner can change it
  any time. New businesses default to UTC until set.

**Verified (real dev server, real Supabase, real Wallxer Google Calendar):**

- `scripts/verify-booking-timezone-fix.mjs` (new) temporarily sets Wallxer's
  timezone to Asia/Dhaka, books a real meeting with a bare "10AM" through the
  real `/api/chat` endpoint, and confirms **both** the real Google Calendar
  event and our own `bookings.start_time` land at 10AM Asia/Dhaka -- not 10AM
  UTC -- then reschedules with another bare time ("3PM") and confirms the
  same on both sides. Restores Wallxer's timezone afterward. **8/8 passed.**
- `scripts/verify-timezone-setting.mjs` (new) drives the real onboarding page
  as a real signed-in owner, saves a timezone, confirms the banner, confirms
  it actually persisted to the database, and confirms it survives a reload.
  **4/4 passed.**
- Re-ran the full existing booking suite to confirm nothing regressed:
  `verify-phase4-booking.mjs` (12/12) and `verify-booking-date-fix.mjs` (3/3)
  both still pass unchanged (both scripts specify "UTC" explicitly in the
  test conversation, and Wallxer's own timezone is still UTC by default, so
  behavior for them is unaffected).
- Along the way, found that Wallxer's real connected Google Calendar (the
  founder's own, used since Phase 4) has a genuine recurring "Weekly Team
  Meeting" event that spans roughly two full days every week (e.g.
  2026-08-24 09:30 to 2026-08-26 10:15 Dhaka time) -- looks like an
  unintentional multi-day recurrence rather than a single ~45-minute weekly
  meeting. Not touched (real founder calendar data), just flagged here since
  it collided with this round of testing twice and is worth a look next time
  you're in that calendar.
- Full local `npm run build` passed clean before this was considered done.

**Still incomplete / next step:** none for this item -- the "Known gaps"
entry from 2026-08-18 is removed below. Google OAuth app verification and the
no-staging-environment gap remain open, tracked there.

## 2026-08-18 — Human takeover, and a real chat-history bug in the embed widget

Founder reported two things after testing live: (1) no way to actually reply
to a customer as a human once a conversation needs attention -- only a
notification, and (2) refreshing the browser as a visitor makes the chat
history disappear, even though the conversation clearly still continues
behind the scenes.

**Chat history bug (real, pre-existing):** the embed widget's visible
message list (`useState<Message[]>([])`) always started empty on mount --
only the session ID persisted in `localStorage`, never the messages
themselves. A returning visitor's *next* message would correctly continue
the same conversation server-side (the AI still had full context), but
nothing already said was ever redisplayed, so a refresh looked like the
conversation had been wiped even though it hadn't. **Fixed**: on mount, if a
session ID already exists in `localStorage`, the widget now fetches and
redisplays the real history via the new `/api/chat/messages` endpoint before
showing anything.

**Human takeover -- built as fully specified:** take over a conversation
(AI stops replying automatically), reply directly as yourself, and hand
control back to the AI whenever you want -- which then reads through
everything said while a human was in charge before continuing, not just
picking up as if nothing happened.

- **Schema**: `chat_sessions.controlled_by` (`'ai' | 'human'`, default
  `'ai'`), and `chat_messages.role` now also allows `'business'` for a
  human's own replies.
- **`respond.ts`** skips calling Claude entirely once `controlled_by =
  'human'` for a session -- no AI reply, no quota consumed (there's no AI
  cost to charge against), just records the visitor's message for the human
  to see and reply to.
- **Handing control back needed no new "resume" logic** -- the history
  builder already treats any non-visitor role as "the business side" of the
  conversation for Claude's context, so a mix of AI and human messages just
  reads as one continuous conversation once the AI takes over again.
- **New `/api/chat/messages`** (public, keyed by the same unguessable
  session ID used everywhere else): lets the widget discover a human's reply
  it wasn't the one to trigger, and lets the dashboard's conversation view
  stay live without a manual refresh. Both poll every 4 seconds while open.
- **`/dashboard/conversations/[sessionId]`**: a "Take over" / "Hand back to
  AI" button and a reply box, live-updating as new messages come in either
  direction.

**Decisions made (not explicit in the request):**

- **Polling, not a live subscription.** The widget is fully anonymous/public;
  giving it real-time Supabase access would need a real RLS story for
  unauthenticated visitors, which the current architecture (all writes via
  the service-role client) deliberately avoids. A 4-second poll is a
  reasonable trade for not opening that surface.
- **The widget must poll continuously once open, not only after it already
  knows a human has taken over** -- there's no other way for it to discover
  a takeover it didn't trigger itself (an owner can take over while a
  visitor is just sitting there, mid-silence). Found this the hard way: the
  first version only started polling *after* learning `controlledBy ===
  "human"` from one of the visitor's own requests, which never happens if
  they never send another message.
- **A message a browser tab just sent is never re-added from its own poll.**
  Found a real duplication bug while verifying this: a poll tick landing
  while a send request was still in flight (using a timestamp cursor from
  before that message existed) could re-fetch and re-display a visitor's or
  owner's own just-sent message a second time. Fixed by having each side's
  poll simply skip messages carrying its own role, since nothing legitimately
  needs to be "discovered" that way -- it's always already shown optimistically.
- **`chat_sessions.controlled_by` uses the same RLS + column-grant pattern**
  already established for `business_users.invite_token` (row policy scoped
  to the caller's own business, `revoke`/`grant` limited to the one column
  members should touch) -- the reply/take-over/hand-back actions
  additionally verify session ownership in the server action itself, using
  the admin client, since chat_messages has never had a client-facing insert
  policy (every write to it, by any actor, has always gone through the
  service role).

**Verified end-to-end** (real Claude calls, real Playwright browser, two
separate real users -- a visitor and an owner) via
`scripts/verify-takeover-and-history.mjs`: **7/7 checks passed**, run
consistently multiple times. Confirmed: history survives a real page
refresh; taking over sets `controlled_by` and clears `needs_handoff`; the
reply saves as a real `role='business'` row; the visitor sees it purely via
polling, having sent nothing themselves; the AI generates zero replies while
a human is in control; handing back flips control; and the AI's next reply
after that genuinely has context of what the human said. Re-ran the entire
existing regression suite (RLS, booking, dashboard, embed widget, account,
onboarding, knowledge, leads) -- all still passing.

**Known limitation, not asked for:** if two different staff members reply
from two different browser tabs at the same time, each tab's poll currently
filters out *all* `business`-role messages (to avoid the duplication bug
above), so a second staff member's reply from another tab wouldn't show up
live in the first tab without a manual refresh. Fine for the current
single-person-replying use case; would need a per-tab identity to fix
properly if multi-staff-simultaneous-reply ever becomes a real need.

**Environment note, not code-related but worth recording:** discovered
mid-session that this machine's C: drive (~100GB total) was completely
full, which was very likely the real cause of a lot of today's unrelated
flakiness (random OOM crashes, orphaned dev-server processes, intermittent
timeouts) -- a full disk causes cascading OS-level issues well beyond
explicit "no space" errors. Freed ~5GB by clearing the npm cache (safe,
just re-downloads packages as needed); confirmed `next dev --turbopack`
itself temporarily uses several more GB while actively running, released
on stop. The rest of the disk is Windows system files and the founder's own
documents -- recommend running Windows' own Disk Cleanup / Storage Sense,
or moving to a larger drive, since ~100GB is genuinely tight for active
development alongside everything else already on this machine.

## 2026-08-18 — Deployed leads feature; caught a real gap in the verification process

Redeployed the lead capture work to production. The first deploy attempt
failed the build: an unescaped apostrophe in `leads/page.tsx` tripped
Next's `react/no-unescaped-entities` ESLint rule, which `tsc --noEmit`
(what's been run before every deploy so far) never catches -- it only
checks types, not lint rules, and Next's production build enforces both.
Fixed the apostrophe, then ran a full local `npm run build` to confirm
before redeploying rather than relying on `tsc` alone. **Decision:** a real
production build (not just `tsc --noEmit`) is now part of pre-deploy
verification going forward, not only the type-check.

Redeployed successfully; confirmed live: a real `/api/chat` call against
`chatx-rust.vercel.app` returns a real Claude reply, and the new intake form
actually renders on the live widget.

## 2026-08-18 — Lead capture before chat starts

Founder asked for lead capture: a visitor gives their name, email, and an
initial message before the chat actually starts, so the business can follow
up later even if the AI couldn't fully help or the visitor never returns.
Asked explicitly to check `system_design.md` and this changelog first and
make sure it's scalable and doesn't break anything -- confirmed this isn't
covered by (or in conflict with) the original spec; it's a genuinely new
capability, distinct from the "lead scoring" differentiator already noted
there as a future idea.

**What was built:**

- **`leads` table** (new migration): `business_id`, `session_id` (nullable,
  set null if the session is ever deleted), `name`, `email`, `message`,
  `created_at`. Same RLS pattern as `bookings` -- members can `select` their
  own business's leads; all writes go through the service-role client from
  the chat pipeline, same trust model as `chat_sessions`/`bookings`.
- **The intake form gates the embed widget**: opening the bubble shows a
  small form (name, email, message) instead of an empty chat panel. A
  returning visitor (an existing session already in `localStorage`) skips
  straight to the chat panel -- the form is only for starting a brand new
  conversation, not shown again on every visit.
- **One request does both jobs**: submitting the form calls the existing
  `/api/chat` endpoint with `leadName`/`leadEmail` alongside the visitor's
  first message, rather than a separate lead-creation round trip.
  `respondToVisitorMessage` inserts the lead row (guarded against a
  duplicate insert per session) and then proceeds through the exact same
  pipeline as any other message -- quota enforcement, retrieval, booking/
  handoff tools all apply identically, since a lead's first message is a
  real message like any other.
- **The AI is told the visitor's name/email on every turn**, not just the
  one that submitted the form -- fetched fresh from the `leads` table each
  time (by `session_id`), so it still knows the name on turn 5 of a
  conversation, not only turn 1. Verified: asking "what's my name again?"
  three turns in gets answered correctly.
- **`/dashboard/leads`**: new page (and new "Leads" sidebar entry, in the
  Main section alongside Conversations/Bookings) listing name, email,
  message, received time, and a link to the full conversation when one
  exists.
- **Server-side email validation** on `/api/chat` -- `leadName`/`leadEmail`
  are optional, but if either is present both are validated (non-empty name,
  a real email shape) before ever reaching the database, since this is a
  public, unauthenticated endpoint and the widget's own client-side
  validation isn't something to trust alone.

**Decisions made (not explicit in the request):**

- **Scoped to the public embed widget only, not the dashboard's Test Chat
  page.** Test Chat is the founder's own internal tool for trying out their
  assistant, not a real visitor -- gating it behind a fake name/email every
  time would add friction to the founder's own workflow for no real benefit.
- **No per-business toggle to turn this off.** Not asked for, and the
  request describes an unconditional flow ("the chat will ask for
  name/email/message, then start the chat") -- adding configurability now
  would be building for a requirement that hasn't been stated. Straightforward
  to add later (a boolean column + a conditional in the widget) without
  touching this design if the founder wants it.
- **Message is required, not optional**, on the intake form -- the form's
  purpose is to start the actual conversation, and an empty first message
  would mean submitting the form does nothing visible until the visitor
  types something anyway.

**Verified end-to-end** with two real businesses (Playwright, real Claude +
Voyage calls) via `scripts/verify-leads-feature.mjs`: **8/8 checks passed**.
Confirmed the real intake form submission actually reaches the database with
the right name/email/message, the lead is linked to a real `chat_session`,
the AI correctly recalls the visitor's name on a later turn ("Your name is
Priya Sharma!"), business B's owner cannot see business A's lead (RLS), and
a returning visitor with an existing session skips the form. Re-ran the
full existing regression suite (RLS, Phase 4 booking, Phase 6 dashboard,
embed widget) to confirm nothing broke, since this touched the shared
`respond.ts`/`/api/chat` pipeline every other feature also runs through.

## 2026-08-18 — Account/profile/password page, Manrope font, shared shell, real logo, and a real bug found in three existing pages

Founder asked for four things at once: an account page (edit profile, change
photo, change password -- there was no way to do any of this before), the
Manrope font app-wide, a page-transition animation and faster-feeling
navigation, and the `/plans` page showing the sidebar with each plan's real
features listed. Explicitly asked that nothing existing break in the
process -- worth calling out since that carefulness is exactly what surfaced
a real, pre-existing bug below.

**What was built:**

- **`/dashboard/account`**: a new page + `actions.ts` (`updateProfile`,
  `uploadAvatarPhoto`, `changePassword`). Display name and avatar photo are
  stored in Supabase Auth's `user_metadata` (not a table), since they belong
  to the person, not any one business membership -- the same person could
  belong to more than one business. New `user-avatars` storage bucket
  (public, mirrors the existing `assistant-photos` bucket pattern). The
  header avatar now shows the signed-in person's own initials/photo (falls
  back to business initials until they set one) and links to this page.
- **Manrope** (`next/font/google`) replaces Geist Sans app-wide. Found a
  latent bug while wiring it up: `globals.css`'s `body` rule had a hardcoded
  `font-family: Arial, Helvetica, sans-serif` that silently won over the
  Geist Sans variable, which was never actually referenced anywhere -- the
  whole app has been rendering in plain Arial since Phase 0. Fixed at the
  same time.
- **`src/components/dashboard-shell.tsx`**: the sidebar+header shell
  extracted into a shared component, used by both `dashboard/layout.tsx`
  and the standalone `/plans` page -- `/plans` now has the full sidebar
  without moving its route (see the earlier decision log for why moving it
  was rejected: `/api/checkout`'s redirect and several hardcoded links point
  at it).
- **`/plans`** now lists each plan's real features (from `plan_limits` and
  what's actually plan-gated in the code -- messages/month and booking
  only), not invented marketing copy.
- **`PageTransition`**: a small fade+slide-in on navigation (CSS keyframe,
  keyed on pathname) -- no animation library added.
- **`src/app/dashboard/loading.tsx`**: a skeleton shown instantly on
  navigation while the target route's data loads, which is most of what
  "the page feels slow" actually was -- every dashboard page fetches its
  data synchronously with no streaming, so previously the user saw nothing
  until every query resolved.
- **Real logo wired in** (`logo-mark.tsx`): checks for `public/logo.webp` (or
  `.png`/`.svg`) at request time and renders it via `next/image`, falling
  back to a plain icon square otherwise. The founder's file arrived named
  `Logo.webp` (capital L) -- renamed to lowercase before wiring it in, since
  Vercel's production filesystem is case-sensitive and would 404 on the
  capitalized name even though it works fine locally on Windows.
- **Stat cards redesigned compact**: founder flagged too much blank vertical
  space between the icon/label row and the value row. Changed from a
  stacked layout to a single horizontal row (icon badge, bigger now, next to
  label+value stacked tightly, action button at the end) -- same
  information, much less empty space.

**A real, pre-existing bug found and fixed, affecting three pages:**
Building the account page's photo upload surfaced a genuine bug that has
been live since Phase 1/2, well before today: **a page whose Server
Component reads the `searchParams` prop, and which also contains an
`<input type="file">` form, silently fails to submit that form** (zero
network request ever fires) once the URL already carries a query string
from an earlier action's redirect -- e.g. a user submits one form, gets
redirected to `?saved=x`, then tries a second form (or retries the same one
after an error) without reloading the page first. Confirmed this affected:
- **`/dashboard/onboarding`** (photo upload, after saving the persona
  questionnaire or system prompt) -- live since Phase 1/2.
- **`/dashboard/knowledge`** (document upload, after any earlier upload
  error) -- live since Phase 2.
- **`/dashboard/account`** (the new photo upload, discovered while building
  it today).

Root-caused by testing methodically rather than assuming: confirmed the
server action genuinely never runs (zero POST request), ruled out
hydration/redirect timing, ruled out it being file-upload-specific in
general (a plain text form on the same query-string-carrying page submits
fine), and isolated it specifically to the `searchParams`-prop +
file-input-form combination. **Fix**: moved every confirmation/error banner
into new `src/app/dashboard/confirm-banners.tsx` client components that read
the URL via `useSearchParams()` independently, instead of the Server
Component itself declaring a `searchParams` prop. All three affected pages
updated; no page still reads `searchParams` while also containing a file
input.

**Verified**: full existing regression suite re-run and passing
(`verify-rls.mjs` 8/8, `e2e-phase1.mjs` 7/7, `verify-phase6-dashboard.mjs`
11/11, `verify-embed-widget.mjs` 10/10) to confirm none of today's changes
broke anything. New `verify-account-page.mjs` (8/8) proves the account page
for real -- including logging back in with the changed password afterward,
and confirming the old password stops working. New
`verify-onboarding-photo-fix.mjs` (3/3) and `verify-knowledge-upload-fix.mjs`
(2/2) reproduce the exact bug trigger condition (a stale query string
already in the URL) and confirm the fix holds on both pre-existing pages.

## 2026-08-18 — Brand color system + redesigned every inner dashboard page

Founder shared the actual Falah Chat logo (a green stylized mark) and asked
for two things: (1) that green as the primary brand color with black as
secondary, and (2) the premium redesign extended to every inner page, not
just the dashboard home -- correctly pointed out the rest of the app
(conversations, bookings, embed, calendar, training, assistant setup, team,
test chat) still looked like the old plain-bordered style.

**What changed:**

- **Brand color tokens** added to `globals.css` via Tailwind v4's `@theme`
  (`brand-50` through `brand-900`), used everywhere a `violet`/`indigo`
  placeholder accent was previously used, plus extended to every primary
  button and link across the app (Save, Upload, Copy snippet, Connect
  Google Calendar, Invite, Send, "View details" links, etc.). Black stays
  the secondary/neutral accent -- active sidebar nav, avatar, dark hero
  cards, unchanged.
- **`src/app/dashboard/logo-mark.tsx`**: checks for `public/logo.png` at
  request time (`fs.existsSync`) and renders it via `next/image` if
  present, falling back to a plain brand-green icon square otherwise --
  nothing else needs touching once the real logo file is dropped in.
- **Every inner dashboard page redesigned** to the same card language as
  the dashboard home (shadow-based cards via new shared
  `src/app/dashboard/ui.tsx` `Card`/`PageHeader` components, rounded-2xl,
  generous padding, brand-colored buttons/inputs/status badges):
  conversations (list + detail), bookings, embed, calendar, training,
  assistant setup, team, test chat. `/plans` (a separate top-level route,
  not moved under the sidebar shell -- see decision below) got matching
  card styling too, without changing its URL.

**Decisions made (not explicit in any spec):**

- **Color extracted by eye, not by pixel sampling** -- the logo arrived as
  a pasted image with no accessible file path, so there was no way to
  programmatically sample its exact color. Picked `#25D366`-ish (visually
  close to the logo, in WhatsApp-green territory) and centralized it as a
  single CSS variable specifically so it's a one-line fix if it's off once
  the real file is available.
- **`/plans` was not moved under `/dashboard`** despite being linked from
  the sidebar -- it's referenced by `/api/checkout`'s redirect and several
  hardcoded `href="/plans"` links elsewhere; moving it would have meant
  updating all of those for a cosmetic-only change. Restyled its content in
  place instead.
- **The public embed widget's own button/bubble colors were left black,
  not switched to brand green.** That widget represents each individual
  business's assistant to their own customers, not Falah Chat itself --
  bleeding our own brand color into every customer's chat experience would
  look like white-labeling gone wrong. Brand green is reserved for surfaces
  that are actually ours (the dashboard).

**Two real bugs found while doing this pass, both by looking at rendered
screenshots rather than trusting the code:**

1. **Flex children need `min-h-0` to scroll internally instead of forcing
   the whole panel taller than the viewport.** Any page whose content
   exceeded one screen's height (e.g. `test-chat`, with its fixed 500px
   widget) pushed the entire floating panel shell out of bounds instead of
   scrolling within it. Fixed by adding `min-h-0` to the two intermediate
   flex containers in `layout.tsx`'s scroll chain.
2. **`scrollIntoView({ behavior: "smooth" })` firing on mount with an empty
   message list** (both `chat-widget.tsx` and the public `embed-widget.tsx`)
   raced the page's own layout as it settled, landing the entire dashboard
   shell at the wrong final scroll position -- looked exactly like a broken
   layout (header and sidebar logo scrolled off-screen) but was actually a
   scroll-position bug with `window.scrollY` reporting the wrong resting
   state. Fixed by skipping the call when there are no messages yet.

**Verified**: screenshotted all 11 inner pages with realistic seeded data
(Playwright), caught and fixed both bugs above by comparing screenshots
before/after, then re-ran both full regression suites --
`verify-phase6-dashboard.mjs` (11/11) and `verify-embed-widget.mjs` (10/10)
-- to confirm the visual pass broke nothing real.

**Still needed from the founder:** the actual `logo.png` file, saved into
`public/logo.png` (or a file path on their machine) -- `logo-mark.tsx` is
already wired to pick it up automatically once it's there.

## 2026-08-18 — Dashboard UI redesign, round 2: "premium" pass

Founder compared a live screenshot of the first redesign against the
reference again and said it wasn't close enough -- correctly identified
that the missing piece wasn't colors or icons, it was the overall *feel*:
a floating panel on a soft background, shadow-based cards instead of thin
borders, generous spacing, pill-style trend badges, and a filled-out header.

**What changed:**

- **Floating panel shell**: the whole app (sidebar + content) is now one
  rounded, shadowed white panel inset on a soft gradient background
  (indigo-to-violet, with two large blurred color blobs), rather than a flat
  edge-to-edge page. This was the single biggest visual gap versus the
  reference.
- **Shadow-based cards** (`border-gray-100` + `shadow-sm`) replaced plain
  1px borders throughout, with more generous padding (p-6 instead of p-4/5).
- **Trend indicator is now a colored pill badge** (green/red rounded-full
  chip) instead of plain gray text, matching the reference's "+15% vs last
  week" chip.
- **"View details" links are real blue hyperlinks** (`text-blue-600`) instead
  of muted gray text -- reads as an actual link, not inert text.
- **Added a functional header search** (`command-search.tsx`): filters and
  jumps to any dashboard page, focusable with Cmd/Ctrl+K (matching the
  reference's "⌘F" hint) -- a real quick-nav feature, not decoration, since
  building a fake non-functional search box would leave a half-finished
  element sitting in the header.
- **Chart got a real period selector** (3/6/12 months, `usage-chart-panel.tsx`)
  instead of a fixed "last 6 months" label -- fetches 12 months of usage_logs
  once and slices client-side, so switching ranges needs no extra request.
  Also added a connecting-line callout on the current month's bar, matching
  the reference's tooltip-with-pointer detail.

**Bug caught twice, worth noting explicitly:** the chart's outer flex
container needs `items-stretch` (the default), not `items-end` -- `items-end`
collapses each bar's column to its own content height instead of the
chart's full height, so percentage-height bars have nothing to compute
against and silently don't render. Got this right, then reintroduced it by
accident while rewriting the component for round 2, caught it again by
actually looking at the rendered screenshot rather than trusting the code
read. If this component gets touched again, watch for this specifically.

**Verified**: re-screenshotted the dashboard, bookings, and embed pages with
realistic seeded data (Playwright, self-cleaning). Re-ran the full Phase 6
functional regression suite (`verify-phase6-dashboard.mjs`) to confirm the
visual pass didn't break any real functionality -- 11/11 passed (one
assertion needed updating since it checked for now-removed "Bookings this
month" wording; the underlying data and RLS isolation were never at risk).

## 2026-08-18 — Dashboard UI redesign

Founder asked for a cleaner, more minimalist/professional look for the
dashboard, with a reference screenshot of a sidebar-based SaaS dashboard
(pastel stat cards, a dark hero stat card, a rounded bar chart, a table with
colored status text, an insights panel with icon badges). Purely a visual
pass -- no new functionality, all numbers shown are the same real Phase 6
data, just presented differently.

**What changed:**

- **Sidebar shell** (`src/app/dashboard/layout.tsx` + new `sidebar-nav.tsx`)
  replaces the old top-nav header: icon + label nav items (grouped "Main" /
  "Setup"), active route highlighted, a notification bell in the top bar
  showing a real badge count of conversations flagged `needs_handoff`
  (linking to Conversations), and an initials avatar.
- **Dashboard home** (`page.tsx`) rebuilt with: three pastel stat cards
  (Conversations, Bookings, Resolution rate -- the last computed as
  `(total - needs_handoff) / total`, a real analog to "accuracy" from the
  reference), a dark "Messages this month" hero card with real month-over-
  month % change, an upgrade CTA card (only shown below Pro), the 6-month
  usage chart restyled as rounded violet bars with a floating count label on
  the current month, a real "Highlights" panel (handoff status, usage
  status, next upcoming booking -- all real data, not placeholder copy), and
  a "Recent bookings" table with colored status text.
- Added `lucide-react` (small, tree-shakeable icon set, no other runtime
  deps) -- the project had no icon library before this.

**Decisions made (not explicit in any spec):**

- **Kept black as the primary accent** (buttons, active nav state) rather
  than adopting the reference's purple as a global rebrand -- the reference
  itself uses black for its primary actions too (arrow buttons, active nav,
  the hero card), purple only appears as a sparing brand-logo/chart accent.
  Changing every button color app-wide (login, signup, checkout, etc.) was
  out of scope for "clean up the dashboard UI" and would have been a much
  bigger, riskier change than asked for.
- **Scope limited to the dashboard shell + dashboard home page.**
  Conversations/bookings/embed/calendar/etc. inherit the new sidebar shell
  automatically (confirmed all still render with zero errors) but weren't
  individually redesigned card-by-card -- reasonable given the reference was
  one dashboard-home screenshot, not a full app redesign brief.
- Fixed a real layout bug while building the chart: the bar container's
  `items-end` was collapsing each column to its own content height instead
  of the chart's full height, so percentage-height bars had nothing to
  compute against and rendered invisibly. Caught by actually looking at the
  rendered screenshot, not just reading the code -- exactly the kind of bug
  that's invisible in a code review.

**Verified**: seeded a real business with realistic data (6 conversations, 2
flagged for handoff, 5 bookings in various statuses, 6 months of usage) and
screenshotted the real rendered dashboard, bookings, and conversations pages
via Playwright. Confirmed the chart bars actually render, the handoff badge
count matches between the bell and the conversations list, and status colors
render correctly. Added `scripts/screenshot-dashboard.mjs` (self-cleaning) as
a reusable tool for previewing future UI changes with realistic data, and
`scripts/check-other-pages.mjs` as a quick smoke test that the rest of the
dashboard still renders under the new shell.

## 2026-08-18 — Phase 6: dashboard and analytics (done)

**Area:** Conversation history, booking list, usage/analytics charts, and
human handoff notifications.

**What was built:**

- **`/dashboard/conversations`** + **`/dashboard/conversations/[sessionId]`**:
  every conversation a business's assistant has had, with a "Needs your
  help" badge on flagged ones; clicking in shows the full real message
  thread, read-only.
- **`/dashboard/bookings`**: every booking made through the assistant, with a
  status badge (confirmed/rescheduled/cancelled).
- **Usage/analytics section on `/dashboard`**: messages used this month vs
  the plan's limit (a progress bar that turns yellow at 80%, red at the
  limit; "Unlimited" on Pro), bookings made this month, and a 6-month bar
  chart of message volume.
- **`src/lib/ai/handoff-tool.ts`**: a new `flag_for_human_handoff` tool,
  available to Claude on every conversation regardless of plan (unlike
  booking, this isn't a calendar integration -- it's a "notify the owner"
  signal). Sets `chat_sessions.needs_handoff` + `handoff_reason` and emails
  the business owner via Resend, reusing the same pattern as the existing
  invoice-reminder email.
- **`supabase/migrations/20260818000000_handoff_flag.sql`**: adds
  `needs_handoff` (bool) and `handoff_reason` (text) to `chat_sessions`.

**Decisions made (not explicit in system_design.md):**

- **Handoff detection is a tool call, not keyword matching.** Claude decides
  for itself when it's genuinely stuck (a complaint, an explicit request for
  a human, something outside its knowledge) rather than pattern-matching
  phrases like "human" or "agent," which would both over-trigger (visitor
  says "are you human?") and under-trigger (frustration that never uses
  those words). Consistent with how booking already uses tool calling
  instead of parsing free text.
- **Handoff only fires once per conversation** (checked via
  `needs_handoff` before re-flagging) -- otherwise a visitor who stays
  frustrated for several more messages would re-email the owner on every
  turn.
- **No new charting library added.** The 6-month usage bar chart is
  hand-rolled HTML/CSS (single-hue magnitude bars) rather than pulling in
  Recharts/Chart.js for one simple chart -- consistent with this project's
  lean-dependency approach so far, and there's no multi-series/categorical
  need that would justify a library.
- **"Bookings this month" counts by `created_at`** (when the booking was
  made), not `start_time` (when the meeting happens) -- matches the spec's
  wording ("bookings made") and usage_logs' own convention of counting
  activity by the month it occurred in, not some future date.

**Verified end-to-end** (real dev server, two real businesses, Playwright)
via `scripts/verify-phase6-dashboard.mjs`: **11/11 checks passed**. A
genuinely frustrated real conversation ("your product broke, I've emailed
three times, I need a real human") correctly triggered the handoff flag
*without* any booking tools available, proving handoff works independent of
the booking feature. The dashboard's usage number matched a seeded
`usage_logs` row exactly. Critically, confirmed **RLS isolation**: logged in
as business A's owner, direct navigation to business B's conversation URL
returned a 404, not another business's private conversation. Cleaned up all
test businesses/users/data afterward.

**Still incomplete / next step:**

- No pagination on conversations/bookings lists (capped at 100/200 rows) --
  fine at current volume, revisit if a business's history grows large.
- Next up: Phase 7 (launch prep) -- pricing/landing page, onboarding docs, a
  real pilot business onboarded fully end to end, public launch.

## 2026-08-18 — Real-world confirmation: widget live on an actual customer site

Founder pasted the real snippet on a real live WordPress site
(`fastrock.ae`) via the Theme File Editor's `<head>` section. First check
showed nothing -- turned out the founder was checking a *different* site
(`wallxer.com`) than the one they'd actually edited, which cost some time
chasing a non-issue. Once pointed at the right domain
(`fastrock.ae`), confirmed independently with a fresh, logged-out
Playwright browser session (not the founder's own WP-admin-logged-in view,
which caching plugins typically exempt from the cache and so isn't proof of
what a real visitor sees): the script tag is present, correctly pointing at
`chatx-rust.vercel.app` with the right business ID, and the widget iframe
renders at the expected position.

Added `scripts/check-widget-live.mjs <url>` -- a small reusable diagnostic
(not tied to one business) for the next time a business reports "the widget
isn't showing," since a stale cache serving admins one page and visitors
another is likely to recur with any WordPress-hosted business.

## 2026-08-18 — Fixed: embed.js could fail if pasted in `<head>`

Founder asked about pasting the snippet into the WordPress Theme File
Editor's `<head>` section (before `</head>`) instead of a footer plugin.
Technically fine either way, but it surfaced a real gap in `public/embed.js`:
it called `document.body.appendChild(iframe)` unconditionally, and with the
snippet's `async` attribute, a `<head>` placement could execute before
`<body>` exists in the DOM at all -- `document.body` would be `null` and the
widget would silently fail to appear (no crash, no visible error, just a
missing bubble). Footer placement never triggered this since `<body>`
already exists by the time a footer script runs, so `scripts/verify-embed-widget.mjs`
never caught it.

**Fix:** `embed.js` now checks for `document.body` and falls back to a
`DOMContentLoaded` listener if it isn't there yet -- safe regardless of where
the snippet is pasted.

**Verified:** new `scripts/verify-embed-head-placement.mjs` loads a real
page with the script placed in `<head>`, before `<body>`, in a real browser
-- widget mounts with zero errors. Re-ran the full `verify-embed-widget.mjs`
suite too (footer placement): still 10/10, no regression. Redeployed to
production (https://chatx-rust.vercel.app) and confirmed the fix is live.

**Practical note passed to the founder:** editing the Theme File Editor
directly changes the theme's actual files -- a theme update can silently
wipe that edit out. A plugin like WPCode (footer section) survives theme
updates; editing `header.php`/`footer.php` directly is only durable on a
child theme.

## 2026-08-18 — First public deployment (preview, ahead of Phase 7)

Founder wanted to test the real embed snippet on their real WordPress site,
which surfaced a real gap: the app had only ever run on `localhost`, so a
real visitor's browser had nothing reachable to load. system_design.md puts
public launch at Phase 7, but nothing about testing the widget on a real
site required waiting that long -- deployed a working preview now instead of
blocking on the rest of the phase order, with the founder's explicit sign-off
before the deploy went live (Vercel's free Hobby tier, no cost).

- Linked the repo to a new Vercel project (`chatx`, under the founder's
  existing Vercel account). GitHub auto-deploy-on-push isn't connected yet
  (Vercel needs a GitHub login connection added on the founder's account
  first) -- deploys are manual (`vercel --prod`) until that's set up.
- Pushed every secret from `.env.local` into Vercel's Production environment
  variables (never printed to a terminal or committed anywhere).
- Production URL: **https://chatx-rust.vercel.app**. Set
  `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` specifically for the
  Production environment to match this real domain (local dev keeps using
  `localhost:3000` in `.env.local`, untouched).
- **Verified live**: a real `/api/chat` request against the production URL
  returned a real Claude reply; `/embed.js` and `/widget/<businessId>` both
  return 200 on the live domain. Cleaned up the test chat session afterward.

**Known gap, needs founder action before those specific features work on
this URL:**

- Google Calendar OAuth will fail on this domain until
  `https://chatx-rust.vercel.app/api/google/callback` is added to the
  authorized redirect URIs in Google Cloud Console (chat itself works fine
  without this).
- Stripe billing needs a new webhook endpoint pointed at
  `https://chatx-rust.vercel.app/api/webhooks/stripe` with its own signing
  secret set as `STRIPE_WEBHOOK_SECRET` in Vercel -- the value currently
  there is copied from the local `stripe listen` session and won't receive
  real events.

## 2026-08-18 — Phase 5: embeddable widget (done)

**Area:** Public embed snippet + the actual floating chat widget businesses
put on their own website.

**What was built:**

- **`src/lib/business/public-profile.ts`**: a public, no-auth lookup that
  returns only what an anonymous website visitor is allowed to see (id, name,
  assistant name/photo) -- never plan, billing status, system prompt, or
  calendar info. Same trust model as `/api/chat` (businessId is public,
  untrusted input, scoped service-role query).
- **`src/app/widget/[businessId]/page.tsx` + `embed-widget.tsx`**: the actual
  widget -- a floating bubble that expands into a chat panel with the
  business's persona name/photo, message bubbles, and a typing-dots
  indicator, reusing the same `/api/chat` pipeline and message-pacing
  behavior as the dashboard's test-chat page. Visitor identity persists
  across page reloads via `localStorage`, keyed per business ID.
- **`public/embed.js`**: the actual snippet businesses paste onto their site
  -- a single dependency-free `<script>` tag (`data-business-id="..."`) that
  creates a fixed-position iframe pointing at `/widget/<businessId>` and
  listens for `postMessage` size reports to resize the iframe between
  bubble-sized (collapsed) and panel-sized (open).
- **`/dashboard/embed`**: a new dashboard page generating the exact snippet
  for the logged-in business, with a copy-to-clipboard button.

**Decisions made (not explicit in system_design.md):**

- **Iframe isolation, not Shadow DOM**, even though the spec allowed either.
  Shadow DOM still inherits CSS properties like `color`/`font-family` across
  its boundary by default -- the same category of bug that caused the
  earlier "unreadable chat text" incident on the dashboard's own test-chat
  page. An iframe is a fully separate document: nothing the host site does
  (resets, dark themes, `* { all: unset }`) can reach in, and nothing our
  widget does can leak out. This also means `/api/chat` needed zero CORS
  changes -- the iframe is same-origin to our own app; only the parent
  page's `<script>` tag is cross-origin, and that only ever talks to the
  iframe via `postMessage`, never touches our API directly.
- **Iframe size is measured, not hardcoded.** A `ResizeObserver` on the
  widget's own root element reports its real rendered size to the parent
  page on every change, instead of two hand-picked pixel constants living in
  two different files (`embed-widget.tsx` and `embed.js`) that could drift
  out of sync.
- **`devIndicators: false`** added to `next.config.ts`. Next's own dev-mode
  indicator badge anchors to the same bottom-right corner our bubble does,
  inside the same small iframe viewport, and was intercepting clicks during
  verification. Dev-only setting, no effect on production builds.
- **`src/middleware.ts`** now excludes `/widget` and `/embed.js` from the
  Supabase session-refresh pass -- both are fully anonymous, cookie-free
  surfaces that could be loaded at real volume across many third-party
  sites, with no reason to pay for an auth-cookie refresh on every load.
  (`/api/chat` was left as-is; that's pre-existing Phase 3/4 behavior, out of
  scope here.)

**Verified end-to-end with a real browser (Playwright) against a plain
static HTML host page with deliberately hostile, conflicting global CSS**
(`* { all: unset }`, forced dark background, forced Comic Sans, `!important`
everywhere) via `scripts/verify-embed-widget.mjs`: **10/10 checks passed**.
Confirmed: the host page's own styling is untouched by us; the iframe loads
the exact business ID from the snippet; the widget starts bubble-sized and
correctly loads *that* business's real persona name; opening the panel
resizes the iframe live via the postMessage protocol; the widget's own
button styling survived the host's `all: unset` reset completely intact
(true isolation, not luck); a real message got a real reply through the live
`/api/chat` pipeline; closing collapses it back down; no console errors.
Cleans up its own test chat session afterward.

**Still incomplete / next step:**

- No visual customization yet (widget color/position aren't configurable) --
  not in the Phase 5 spec, a possible Phase 6+ differentiator.
- Next up: Phase 6 (dashboard and analytics) -- conversation history,
  booking list, usage charts, and human-handoff notifications.

## 2026-08-18 — Fixed: bookings confirmed for the wrong year

Founder manually tested booking via `/dashboard/test-chat` (Wallxer) and
reported: "the AI said it's confirmed, but didn't find the booking in the
calendar." The automated Phase 4 script had passed 12/12 the day before, so
this needed a fresh look rather than assuming the script's coverage still
held.

**Root cause found by reading the actual conversation and cross-checking the
real calendar (not just our own `bookings` table):** the booking was 100%
real — a genuine event existed on Wallxer's connected Google Calendar with a
working Meet link — but dated **2025-08-18**, over a year in the past. The
visitor had said "18th August at 6PM Dhaka time" with no year. Claude had no
way to know what today's actual date is (nothing in the system prompt told
it), so it resolved the bare date to 2025 instead of 2026. The founder wasn't
wrong that it "wasn't in the calendar" — it was, just parked somewhere nobody
would think to look.

**Fix:** `respond.ts` now prepends the real current date/time (`Date.now()`
at request time, `toUTCString()`) to every system prompt, with an explicit
instruction to resolve a bare date to its next upcoming occurrence, never the
past.

**Verified:** new regression script `scripts/verify-booking-date-fix.mjs`
drives the same "bare date, no year" phrasing through the real `/api/chat`
endpoint against Wallxer's real calendar and asserts the resulting booking's
year matches the actual current year. **3/3 checks passed** after the fix
(booking landed on 2026-09-05, not 2025). Cleans up its own test data
(database row + real calendar event) afterward.

**Cleanup:** with the founder's confirmation, the original test booking
(Bappi Ahmed, 2025-08-18, event ID `rmbjkqt8e5fmeptndd8vp1s5kg`) was removed
from both Wallxer's real calendar and the `bookings` table.

## 2026-08-17 — Phase 4: booking system (done)

**Area:** Google Calendar OAuth, the four booking tools, real-calendar
integration with the Phase 3 chat engine.

**What was built:**

- **`src/lib/crypto/encryption.ts`**: AES-256-GCM encrypt/decrypt, used
  specifically for `businesses.google_refresh_token` at rest, per
  system_design.md.
- **`src/lib/google/oauth.ts`**: auth URL generation + code-for-tokens
  exchange (`googleapis`'s `OAuth2` client, `access_type: offline` +
  `prompt: consent` so reconnecting after a disconnect still gets a fresh
  refresh token).
- **OAuth connect/callback flow** (`/dashboard/calendar` → connect action →
  `/api/google/callback`): CSRF-protected with a per-flow nonce cookie set
  before redirecting to Google and checked on return, *plus* a same-session
  ownership re-check on callback (the nonce alone only proves "same browser
  session that started this flow" -- not "still logged in as the same
  user," if someone logged out and a different account logged in mid-flow).
- **`src/lib/google/calendar.ts`**: `checkAvailability` (via `freebusy.query`),
  `createCalendarEvent` (with `conferenceDataVersion: 1` for a real Google
  Meet link, `sendUpdates: "all"` so the customer gets a real email invite),
  `deleteCalendarEvent`, `patchCalendarEvent`.
- **`src/lib/google/booking-tools.ts`**: the four tool definitions
  (`check_availability`, `create_booking`, `cancel_booking`,
  `reschedule_booking`) plus their executor. Every booking lookup is scoped
  by `business_id`, not just `booking_id` -- a booking ID is just a UUID a
  visitor could guess or reuse, and one business's chat must never be able
  to touch another business's calendar.
- **`src/lib/ai/claude.ts`**: extended `generateReply` with a manual agentic
  tool-use loop (call Claude → execute any `tool_use` blocks → feed results
  back → repeat until `end_turn` or a 5-iteration cap) -- a manual loop
  rather than the SDK's beta Tool Runner, since four well-defined tools
  don't need its extra machinery.
- **`respond.ts`**: booking tools are only handed to Claude when *both*
  `plan_limits.booking_enabled` is true for the business's plan *and* the
  business has actually connected a calendar (`google_refresh_token` +
  `google_calendar_id` both set) -- plan alone isn't enough if there's
  nothing to book against.

**Decisions made (not explicit in system_design.md):**

- **OAuth scope widened from `calendar.events` to the full `calendar`
  scope**, discovered during live testing: `freebusy.query` (used by
  `check_availability`) returns 403 "insufficient authentication scopes"
  under `calendar.events` alone -- free/busy lookups are gated separately
  from event CRUD. Rather than chasing down a second narrow scope
  (`calendar.freebusy`) and asking the founder to configure yet another
  scope in Google Cloud Console, standardized on the one broader scope that
  covers everything the four tools need.
- **`cancel_booking`/`reschedule_booking` no longer require `booking_id`.**
  Originally required, but live testing surfaced a real design gap: our
  chat history is reconstructed from stored message *text* between separate
  `/api/chat` requests, not raw tool-call data -- so a `booking_id` Claude
  saw in one turn's tool result isn't visible in a later turn's history
  unless it was actually spoken aloud in a reply (it wasn't). A real
  customer in a live chat doesn't carry a booking ID around anyway ("cancel
  that" is how people actually talk). Made `booking_id` optional on both
  tools; when omitted, the executor resolves to the most recent
  `confirmed`/`rescheduled` booking for the current chat session --
  scoped by `business_id` *and* `session_id`, so it can only ever resolve to
  a booking from this same conversation.
- `google_calendar_id` is always stored as the literal string `"primary"` at
  connect time (Google's alias for the authenticated user's primary
  calendar), not a specific secondary calendar. Multi-calendar/staff-specific
  calendars is explicitly a system_design.md "differentiator, not required
  for MVP" -- not built now.

**Verified end-to-end against a real Google Calendar** (real dev server,
real conversations through the real `/api/chat` endpoint -- matching the
spec's own wording, "after a test conversation" -- real Claude API, and
independent verification via direct Google Calendar API calls, not just our
own database) via `scripts/verify-phase4-booking.mjs`: **12/12 checks
passed**. A real conversation asked about availability, booked a meeting,
and the resulting event was confirmed as a real event on the connected
calendar with a **real, working Google Meet link** (`meet.google.com/...`,
independently fetched via `events.get`); a follow-up availability check in
the same conversation correctly reflected the new booking (no
double-booking); "move my booking" (with no ID given) correctly resolved to
that same booking via the session-based fallback and the **real** calendar
event's time actually changed (verified with a timezone-aware instant
comparison -- Google returns event times in the calendar's local offset, not
UTC, which tripped up the test script itself before being fixed); "cancel
that" correctly cancelled it, and the **real** calendar event's status
changed to `cancelled`. Cleaned up all test data (database rows *and* the
real calendar event) afterward.

**Two real bugs found and fixed during this verification, not just
config**: the scope-widening decision above, and the `booking_id`
resolution redesign above -- both surfaced only because this was tested
against a real calendar through real conversation, not by reading the code.

**Still incomplete / next step:**

- Google's OAuth consent screen is still in "Testing" publishing status
  (only the founder's own test-user email can connect a calendar). Fine for
  now; real public launch will need Google's app verification process for
  the Calendar scope -- a Phase 7 concern.
- Next up: Phase 5 (embeddable widget) -- the actual public-facing chat
  widget and embed snippet, since `/dashboard/test-chat` was always meant as
  an internal stand-in until this existed.

## 2026-08-17 — Founder testing: fixed real bugs on the test-chat page

Founder tried `/dashboard/test-chat` after Phase 3 shipped and found three
real problems, none of them caught by the automated verification since it
only inspects the API response, not the rendered page.

- **Assistant reply text was unreadable** -- light gray text on a light gray
  bubble. Root cause was systemic, not local to the chat widget:
  `globals.css` flips `body`'s text color to light gray under
  `prefers-color-scheme: dark`, but no component in this app was built with
  dark-mode-aware colors (no `dark:` variants anywhere). On a system in dark
  mode, that leaves every colored panel -- the chat bubble, but also every
  banner on `/dashboard`, `/plans`, `/dashboard/onboarding`, etc. -- with a
  light background inheriting light foreground text. Fixed by removing the
  dark-mode media query entirely rather than patching the chat widget alone;
  forcing light mode is correct until an actual dark theme gets built with
  matching component styles.
- **Assistant name and photo weren't shown at all** -- the widget never
  displayed persona info in the first place. Added a header bar with the
  photo (or an initial-letter placeholder) and name, sourced from the same
  `current-business` context every other dashboard page already uses.
- **No visible typing indicator** -- the pacing delay was real (verified in
  Phase 3's automated run) but invisible; the UI just went silent for the
  delay's duration before the message appeared. Added an animated three-dot
  indicator shown for the delay's duration before each reply chunk renders.

## 2026-08-17 — Phase 3: chat engine (done)

**Area:** Claude integration, RAG retrieval injection, human-like reply
pacing, message quota enforcement, chat session/message storage.

**What was built:**

- **`src/lib/ai/claude.ts`**: one function, `generateReply({systemPrompt,
  history})`, calling `claude-sonnet-5` (system_design.md: "Sonnet for
  quality, Haiku as a cost option on high-volume plans" -- Haiku tiering
  isn't wired up yet, nothing calls for it this phase). Thinking disabled and
  `effort: "low"` -- this is short conversational Q&A, not a reasoning task,
  and latency matters for a live chat widget. Handles `stop_reason:
  "refusal"` (Sonnet 5's safety classifiers) with a graceful fallback message
  instead of crashing.
- **`src/lib/chat/respond.ts`**: the actual orchestration, in order --
  resolve/create the `chat_sessions` row, record the visitor's message
  regardless of what happens next, check `isBusinessRestricted` (billing
  takes priority over quota), atomically check-and-consume the message quota
  via `try_consume_message_quota` (new Postgres function, same
  UPDATE-WHERE-RETURNING atomicity pattern as the RLS/search helper
  functions -- prevents two concurrent messages from both slipping past the
  limit), retrieve matching chunks via `match_knowledge_chunks`, inject them
  into a fresh system prompt each turn, call Claude with the full session
  history, split the reply, store each chunk as its own `chat_messages` row.
- **`src/lib/chat/pacing.ts`**: `splitIntoMessages` groups sentences into
  chat-bubble-sized chunks (paragraph breaks always split); `computeTypingDelayMs`
  scales delay to chunk length (`300 + 30ms/char`, clamped 500-3500ms) --
  "visibly proportional, not fixed" per the Phase 3 spec.
- **`POST /api/chat`**: the public endpoint (no auth -- visitors are
  anonymous, not Supabase-authenticated business users). Creates a
  `visitor_id` if none is supplied, returns `{sessionId, visitorId, blocked,
  blockedReason?, replies}`. This is what Phase 5's embed widget will call.
- **`/dashboard/test-chat`**: a minimal authenticated chat UI (the first
  genuinely client-interactive page in the app -- `useState`/`useEffect`,
  not a server action) so the founder can try their own assistant before the
  real widget exists in Phase 5. Explicitly *not* a separate sandbox --
  it calls the same `/api/chat` endpoint and counts against the same
  monthly quota a real visitor would.

**Decisions made (not explicit in system_design.md):**

- Every plan uses Sonnet for now (Haiku cost-tiering deferred -- see above).
- Thinking disabled, `effort: "low"` for every chat turn -- short
  conversational replies don't need deep reasoning, and low latency matters
  more here than on, say, the onboarding questionnaire.
- A business already blocked by billing (`isBusinessRestricted` -- cancelled,
  or past_due beyond the grace period) can't use chat at all, checked
  *before* the message quota. Not explicitly called out as Phase 3 scope, but
  a natural extension of the Phase 1 billing gate -- reuses that same helper
  rather than inventing a second concept.
- The visitor's own message is always recorded, even when the turn gets
  blocked (quota or billing) -- the transcript should reflect what was
  actually sent, only the AI-generated half is what's withheld.

**Verified end-to-end** (real dev server, real browser-equivalent HTTP calls,
real Voyage API, real Claude API, real Supabase project) via
`scripts/verify-phase3-chat.mjs`: **13/13 checks passed** -- a real
conversation against real trained content (business hours, walk-in policy)
produced replies that actually contained those facts and contained no AI
disclaimer language; the same session correctly carried context across
turns; asked about a second business's secret off-menu dish, the reply
didn't leak it (cross-tenant isolation holds through the *full* chat
pipeline, not just the raw retrieval function already proven in Phase 2);
seeding a free-plan business's usage to 20 and sending a 21st message
returned `blocked: true` with **zero** Claude calls and the quota count
never incremented past 20 (verified by counting `chat_messages` rows before
and after -- the visitor's message was still recorded, no assistant reply
was); a cancelled business was blocked immediately with a billing-specific
message and never even touched the quota table; every reply chunk's
`delayMs` matched the pacing formula exactly, confirming it scales with
length rather than being fixed. Cleaned up all test data afterward.

**Still incomplete / next step:**

- "Replies read as short and conversational... when reviewed manually" is
  the one Phase 3 done-condition that's inherently a human judgment call, not
  something a script can assert. The automated run's actual reply text is
  quoted above for a first read; founder should also try `/dashboard/test-chat`
  directly for a final gut check before considering this fully signed off.
- Next up: Phase 4 (booking system) -- Google Calendar OAuth, availability/
  booking/cancel/reschedule tools, gated to plans with `booking_enabled`.

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
  if it causes confusion later, that's why. Also now on the Pro plan
  (upgraded directly in the database to test Phase 4's booking tools,
  bypassing real Checkout for that one test) and has a real Google Calendar
  connected -- both intentional, not accidents.
- **Google OAuth app is still in "Testing" publishing status** -- only the
  founder's own test-user email can connect a calendar right now. Needs
  Google's app verification process before any real business can connect
  their own calendar. Not needed until Phase 7 (public launch).
- ~~No concept of a business's timezone anywhere in the system~~ -- **fixed
  2026-08-19**, see that entry above.

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
