-- Phase: lead capture. A visitor gives their name/email/first message
-- before the chat actually starts, so the business can follow up later even
-- if the AI couldn't fully help or the visitor never comes back.
create table leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  session_id uuid references chat_sessions (id) on delete set null,
  name text not null,
  email text not null,
  message text,
  created_at timestamptz not null default now()
);

create index idx_leads_business_id on leads (business_id);
create index idx_leads_session_id on leads (session_id);

alter table leads enable row level security;

-- Written by the widget's API route (service role, since visitors are
-- anonymous). Members can view their own business's leads, same pattern as
-- bookings/chat_sessions.
create policy "members can view their leads"
  on leads for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));
