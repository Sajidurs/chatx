-- Switches the plan quota metric from total AI messages per month to
-- distinct visitors (unique people chatting with the assistant) per month.
-- Message volume from a single visitor no longer matters -- a business on
-- Free can have one visitor send 200 messages and still be fine, but a 21st
-- different visitor in the same month is blocked.

alter table plan_limits rename column monthly_messages to monthly_visitors;

-- The set of visitor_ids already "seen" (and therefore already counted) for
-- a given business+month -- lets the quota function tell a returning
-- visitor (never blocked, doesn't consume a new slot) apart from a new one
-- (consumes a slot, blocked once the plan's visitor cap is reached).
create table monthly_active_visitors (
  business_id uuid not null references businesses (id) on delete cascade,
  month text not null, -- 'YYYY-MM'
  visitor_id text not null,
  first_seen_at timestamptz not null default now(),
  primary key (business_id, month, visitor_id)
);

alter table monthly_active_visitors enable row level security;

create policy "members can view their monthly active visitors"
  on monthly_active_visitors for select
  to authenticated
  using (business_id in (select public.get_my_business_ids()));

-- Kept purely informational going forward (no longer gates anything) -- a
-- business's raw message volume is still worth seeing, just not enforced.
alter table usage_logs add column visitor_count integer not null default 0;

-- Backfill from real historical chat data rather than resetting every
-- business's usage to zero on deploy -- a business mid-month when this ships
-- (e.g. a business already active this month) keeps an accurate count
-- instead of getting an unearned full reset of their quota.
insert into monthly_active_visitors (business_id, month, visitor_id, first_seen_at)
select distinct on (cs.business_id, to_char(cm.created_at, 'YYYY-MM'), cs.visitor_id)
  cs.business_id,
  to_char(cm.created_at, 'YYYY-MM'),
  cs.visitor_id,
  cm.created_at
from chat_messages cm
join chat_sessions cs on cs.id = cm.session_id
where cm.role = 'visitor'
order by cs.business_id, to_char(cm.created_at, 'YYYY-MM'), cs.visitor_id, cm.created_at asc
on conflict do nothing;

insert into usage_logs (business_id, month, message_count, visitor_count)
select v.business_id, v.month, 0, count(*)
from monthly_active_visitors v
group by v.business_id, v.month
on conflict (business_id, month) do update set visitor_count = excluded.visitor_count;

-- Replaces the single-parameter version (message-count-based) -- the
-- signature itself changes (now needs to know WHICH visitor is messaging),
-- so the old function is dropped rather than left behind unused.
drop function if exists public.try_consume_message_quota(uuid);

create or replace function public.try_consume_message_quota(p_business_id uuid, p_visitor_id text)
returns boolean
language plpgsql
as $$
declare
  v_month text := to_char(now(), 'YYYY-MM');
  v_limit int;
  v_already_seen boolean;
  v_new_visitor_count int;
begin
  select pl.monthly_visitors into v_limit
  from businesses b
  join plan_limits pl on pl.plan = b.plan
  where b.id = p_business_id;

  insert into usage_logs (business_id, month, message_count, visitor_count)
  values (p_business_id, v_month, 0, 0)
  on conflict (business_id, month) do nothing;

  -- Raw message count is informational only now -- always recorded,
  -- regardless of plan or whether this visitor is new or returning.
  update usage_logs set message_count = message_count + 1
    where business_id = p_business_id and month = v_month;

  if v_limit is null then
    -- Unlimited plan (Pro) -- still record the visitor for analytics, always allow.
    insert into monthly_active_visitors (business_id, month, visitor_id)
    values (p_business_id, v_month, p_visitor_id)
    on conflict do nothing;
    return true;
  end if;

  select exists(
    select 1 from monthly_active_visitors
    where business_id = p_business_id and month = v_month and visitor_id = p_visitor_id
  ) into v_already_seen;

  -- A visitor already counted this month is never blocked by the cap --
  -- the limit is on how many NEW distinct people show up in a month, not on
  -- how many messages an already-known visitor sends.
  if v_already_seen then
    return true;
  end if;

  -- New visitor this month: atomically claim a slot against the single
  -- usage_logs row for this business+month (Postgres's row-level locking on
  -- the UPDATE serializes concurrent callers here, same technique the
  -- previous message-based version relied on -- see that migration's
  -- comment). Only mark the visitor as seen if the claim succeeded.
  update usage_logs
    set visitor_count = visitor_count + 1
    where business_id = p_business_id and month = v_month and visitor_count < v_limit
    returning visitor_count into v_new_visitor_count;

  if v_new_visitor_count is null then
    return false;
  end if;

  insert into monthly_active_visitors (business_id, month, visitor_id)
  values (p_business_id, v_month, p_visitor_id)
  on conflict do nothing;

  return true;
end;
$$;
