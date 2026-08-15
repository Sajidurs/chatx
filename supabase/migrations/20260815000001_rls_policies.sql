-- Row-level security. Every tenant-scoped table must ensure a user can only see
-- and touch rows belonging to a business they are a member of (business_users).
--
-- Helper function: returns the business_id(s) the calling user belongs to.
-- Defined as SECURITY DEFINER so it bypasses RLS internally -- this avoids the
-- infinite-recursion problem of a policy on business_users querying business_users
-- through another RLS-checked query.
create or replace function public.get_my_business_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select business_id from business_users where auth_user_id = auth.uid()
$$;

create or replace function public.is_business_owner(target_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from business_users
    where business_id = target_business_id
      and auth_user_id = auth.uid()
      and role = 'owner'
  )
$$;

alter table businesses enable row level security;
alter table business_users enable row level security;
alter table knowledge_sources enable row level security;
alter table knowledge_chunks enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table bookings enable row level security;
alter table usage_logs enable row level security;
alter table plan_limits enable row level security;

-- businesses: members can read; only the owner can edit business/persona settings.
-- Row creation happens server-side (service role) as part of signup, so there is
-- no INSERT policy for authenticated users.
create policy "members can view their business"
  on businesses for select
  to authenticated
  using (id in (select public.get_my_business_ids()));

create policy "owner can update their business"
  on businesses for update
  to authenticated
  using (public.is_business_owner(id))
  with check (public.is_business_owner(id));

-- business_users: members can see their own business's team list.
-- Invites/role changes go through a server route (service role) for now.
create policy "members can view their business's team"
  on business_users for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

-- knowledge_sources: members can manage the documents used to train their assistant.
create policy "members can view their knowledge sources"
  on knowledge_sources for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

create policy "members can add knowledge sources"
  on knowledge_sources for insert
  to authenticated
  with check (business_id in (select public.get_my_business_ids()));

create policy "members can update their knowledge sources"
  on knowledge_sources for update
  to authenticated
  using (business_id in (select public.get_my_business_ids()))
  with check (business_id in (select public.get_my_business_ids()));

create policy "members can delete their knowledge sources"
  on knowledge_sources for delete
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

-- knowledge_chunks: written by the background embedding job (service role only).
-- Members can read them (useful for debugging/inspection views later).
create policy "members can view their knowledge chunks"
  on knowledge_chunks for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

-- chat_sessions / chat_messages: written by the widget's API route (service role,
-- since visitors are anonymous, not Supabase-authenticated users). Members can
-- read their own conversations (Phase 6 dashboard).
create policy "members can view their chat sessions"
  on chat_sessions for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

create policy "members can view their chat messages"
  on chat_messages for select
  to authenticated
  using (
    session_id in (
      select id from chat_sessions
      where business_id in (select public.get_my_business_ids())
    )
  );

-- bookings: written by the booking tool calls (service role). Members can view
-- their own business's bookings (Phase 6 dashboard).
create policy "members can view their bookings"
  on bookings for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

-- usage_logs: written by the usage-counting logic (service role). Members can
-- view their own usage (Phase 6 analytics).
create policy "members can view their usage logs"
  on usage_logs for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

-- plan_limits: public reference data (needed for the plan-selection page),
-- read-only for everyone. Writes are admin-only via the service role.
create policy "anyone can view plan limits"
  on plan_limits for select
  to authenticated, anon
  using (true);
