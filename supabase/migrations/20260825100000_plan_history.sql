-- Records each real plan change as it happens, so the account page can show
-- an accurate "which plan did I start on, and what changed since" history.
-- Deliberately not reconstructed from Stripe invoices at display time --
-- confirmed directly that a single invoice can bundle proration line items
-- from several plan changes together (a customer changing plans more than
-- once before the next invoice is finalized), making "the plan for this
-- invoice" ambiguous to infer after the fact. Recording it at the exact
-- moment each webhook processes a real change has no such ambiguity.
create table plan_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  plan text not null check (plan in ('free', 'starter', 'pro')),
  changed_at timestamptz not null default now()
);

create index idx_plan_history_business_id on plan_history (business_id);

alter table plan_history enable row level security;

create policy "members can view their plan history"
  on plan_history for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));
