System design — AI chatbot SaaS for small and mid-sized businesses

This is the source of truth for what we are building and in what order. Read this fully before writing code. Each phase has a definition of done, if those conditions aren't met, the phase isn't finished, regardless of how much code has been written.

0. End goal, in one paragraph

A business signs up on our website, picks a plan, pays monthly through Stripe, uploads their own documents to train an AI assistant, sets an assistant name and photo, optionally connects their Google Calendar, and receives a code snippet to paste into their own website. From that point on, their website visitors chat with what feels like a real staff member, one who knows the business's own information and can check availability, book, cancel, and reschedule meetings on the business's real calendar, with a Google Meet link attached automatically.

1. Tech stack
Layer	Choice	Reason
Frontend/dashboard	Next.js 15 (App Router)	Familiar stack, SSR + API routes in one
Auth	Supabase Auth	Built-in, integrates with row-level security
Database	Supabase Postgres + pgvector	Multi-tenant data and embeddings together
AI	Claude API (Sonnet for quality, Haiku as a cost option on high-volume plans)	Tool calling for booking, strong RAG performance
Payments	Stripe Billing	Subscriptions, webhooks, invoice reminders built in
Calendar	Google Calendar API + Google Meet (conferenceData)	Bookings land on the business's own calendar
Hosting	Vercel	Matches existing stack, native cron support
Email	Resend or Postmark	Transactional emails (reminders, receipts)
2. Data model
businesses
  id, name, plan (free|starter|pro), status (active|past_due|cancelled)
  stripe_customer_id, stripe_subscription_id
  assistant_name, assistant_photo_url, assistant_bio
  system_prompt (auto-generated, editable by the business owner)
  google_refresh_token (encrypted), google_calendar_id
  created_at

business_users
  id, business_id, email, role (owner|staff), auth_user_id

knowledge_sources
  id, business_id, type (pdf|doc|text), file_url, status (processing|ready|failed)

knowledge_chunks
  id, business_id, source_id, content, embedding (vector)

chat_sessions
  id, business_id, visitor_id, started_at, last_message_at

chat_messages
  id, session_id, role (visitor|assistant), content, created_at

bookings
  id, business_id, session_id, google_event_id
  customer_name, customer_contact, start_time, end_time
  status (confirmed|cancelled|rescheduled)

usage_logs
  id, business_id, month (YYYY-MM), message_count

plan_limits
  plan, monthly_messages (20 | 1000 | null for unlimited), booking_enabled (bool)

Every table is scoped by business_id. Row-level security policies must check the authenticated user against business_users before allowing any read or write. This applies from phase 1 onward, not as a later hardening pass.

3. Build phases

Each phase lists: what to build, how it connects to the rest of the system, and what "done" means. Work through them in order. Do not start a phase before the previous one meets its definition of done.

Phase 0 — Foundation

Build:

Repo structure, environment variable setup, Supabase project, initial schema and RLS policies
Stripe account with three products/prices (Free, Starter, Pro)

Definition of done:

Schema from section 2 exists in Supabase with RLS enabled and tested (a query from one business cannot see another business's rows)
Stripe products exist and their price IDs are stored in environment config
CHANGELOG.md exists and has its first entry
Phase 1 — Business onboarding and billing

Build:

Signup/login (Supabase Auth)
Plan selection page → Stripe Checkout (subscription mode)
Webhook handler for: checkout.session.completed, invoice.upcoming, invoice.paid, invoice.payment_failed, customer.subscription.deleted
Usage counter reset on invoice.paid
Reminder email on invoice.upcoming
Access downgrade/restriction after payment failure (grace period, then restrict)

Definition of done:

A test signup can complete Stripe Checkout in test mode and the business record reflects the correct plan and status
All five webhook events are handled and verified with Stripe's signing secret
A simulated invoice.payment_failed correctly restricts access after the grace period
Reminder email actually sends (test inbox confirms) before renewal
Phase 2 — AI training (RAG)

Build:

File upload for PDF, doc, and text
Background job: extract text, chunk it, generate embeddings, store in knowledge_chunks
Auto-generated system_prompt from an onboarding questionnaire (business type, services, tone, booking rules, FAQs), editable afterward
Persona setup: assistant name, photo, short bio

Definition of done:

Uploading a real PDF results in searchable chunks scoped to the correct business_id
A similarity search for a test query returns relevant chunks from that business's own documents only
The generated system prompt visibly reflects the answers given in onboarding, and is editable and saved correctly
Phase 3 — Chat engine

Build:

Claude API integration: retrieve top matching chunks, inject with system prompt and persona, return reply
Human-like reply behavior: typing delay scaled to reply length, replies split into short consecutive messages, no AI disclaimers in the conversation itself
Message quota enforcement per plan, checked before every AI call (not after)
Chat session and message storage

Definition of done:

A test conversation stays on-topic using only that business's trained content
Free plan blocks the 21st message that month with a clear message, without calling the AI
Replies read as short and conversational, not like a formal AI response, when reviewed manually
Typing delay is visibly proportional to reply length, not fixed
Phase 4 — Booking system

Build:

Google OAuth connection per business, refresh token stored encrypted
Tool: check_availability(date_range)
Tool: create_booking(datetime, customer_name, customer_contact) with Meet link
Tool: cancel_booking(booking_id)
Tool: reschedule_booking(booking_id, new_datetime)

Definition of done:

A connected test Google account's real calendar shows a created event with a working Meet link after a test conversation
Cancelling through the chat actually removes/updates the calendar event
Rescheduling actually moves the calendar event to the new time
Availability checks correctly reflect existing events on that calendar (no double-booking)
Booking tools are only available to businesses on a plan that includes booking
Phase 5 — Embeddable widget

Build:

Embed snippet generator, unique per business
Widget UI: floating bubble, persona name/photo, chat panel, typing animation
Widget isolated from host site's CSS (iframe or shadow DOM)

Definition of done:

Snippet pasted into a plain test HTML page renders the widget correctly with no visual conflicts with the host page's styles
Widget correctly loads the right business's persona and chat behavior based on the snippet's business ID
Phase 6 — Dashboard and analytics

Build:

Conversation history view
Booking list view
Usage/analytics charts (messages used, bookings made)
Human handoff notification for high-intent conversations the AI couldn't resolve

Definition of done:

A business owner can log in and see their own real conversations and bookings, and nothing from other businesses
Usage charts match the actual counts in usage_logs
Phase 7 — Launch prep

Build:

Sales/pricing landing page
Onboarding documentation for new businesses
One real pilot business fully onboarded end to end
Public launch

Definition of done:

One real business has completed the entire flow, signup through a live booking, with no manual intervention from us
All critical paths (signup, payment, training, embed, booking, billing renewal) have been tested end to end at least once
4. Plans
Plan	Messages/month	Booking integration
Free	20	No
Starter	1,000	No (or optional paid add-on later)
Pro	Unlimited	Yes
5. Differentiators to keep in mind (not required for MVP, but design should not block them later)
Industry-specific system prompt templates (clinics, salons, real estate, restaurants)
Same AI brain reused across Web, WhatsApp, and Messenger from one dashboard
Automatic appointment reminders to reduce no-shows
Lead scoring to flag high-intent conversations for the business owner
Multilingual support
Booking rules engine: buffer times, working hours, staff-specific calendars
White-label option for agencies to resell under their own brand