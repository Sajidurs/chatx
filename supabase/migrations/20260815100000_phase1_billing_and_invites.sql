-- Phase 1: business onboarding and billing.

-- 1. Staff invites: a business owner needs to be able to invite a staff member
--    who does not have an account yet. auth_user_id must become nullable, with
--    a status/token pair driving the invite-then-accept flow.
alter table business_users alter column auth_user_id drop not null;

alter table business_users
  add column status text not null default 'accepted' check (status in ('pending', 'accepted')),
  add column invite_token uuid unique;

-- Prevent inviting the same email twice while an invite is still pending.
create unique index idx_business_users_pending_email
  on business_users (business_id, email)
  where status = 'pending';

create index idx_business_users_invite_token
  on business_users (invite_token)
  where invite_token is not null;

-- 2. Grace period tracking for payment failures. status moves to 'past_due'
--    immediately on invoice.payment_failed; past_due_at records when that
--    happened so access can be restricted once the grace period elapses.
--    (Whether a business is currently restricted is a computed check at read
--    time -- see src/lib/billing/access.ts -- not a stored status value.)
alter table businesses add column past_due_at timestamptz;

-- 3. Webhook idempotency. Stripe can deliver the same event more than once;
--    record each processed event id so retried deliveries are a no-op instead
--    of double-applying billing state changes (e.g. resetting usage twice).
create table processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

alter table processed_stripe_events enable row level security;
-- No policies: nothing except the service role (which bypasses RLS) ever
-- touches this table.

-- 4. Column-level lockdown on businesses. The existing "owner can update their
--    business" RLS policy is row-scoped, not column-scoped -- as written, an
--    authenticated owner could UPDATE their own row's plan/status/
--    stripe_customer_id directly and grant themselves a paid plan for free.
--    Restrict which columns the authenticated role can write at the grant
--    level; billing/integration fields are only ever written by server code
--    using the service role (webhooks, OAuth callbacks, booking tools).
revoke update on businesses from authenticated;
grant update (assistant_name, assistant_photo_url, assistant_bio, system_prompt)
  on businesses to authenticated;
