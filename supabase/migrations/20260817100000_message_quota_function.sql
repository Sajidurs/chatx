-- Atomically checks and consumes one message against a business's monthly
-- quota, so concurrent requests can't race past the limit (two requests both
-- reading count=19 and both proceeding as "message 20"). The UPDATE ... WHERE
-- ... RETURNING pattern relies on Postgres's row-level locking for this.
-- Looks up plan_limits itself so callers can't drift out of sync with a
-- separately-fetched limit value.
create or replace function public.try_consume_message_quota(p_business_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_month text := to_char(now(), 'YYYY-MM');
  v_limit int;
  v_new_count int;
begin
  select pl.monthly_messages into v_limit
  from businesses b
  join plan_limits pl on pl.plan = b.plan
  where b.id = p_business_id;

  insert into usage_logs (business_id, month, message_count)
  values (p_business_id, v_month, 0)
  on conflict (business_id, month) do nothing;

  if v_limit is null then
    -- unlimited plan -- still record usage for analytics, always allow
    update usage_logs set message_count = message_count + 1
      where business_id = p_business_id and month = v_month;
    return true;
  end if;

  update usage_logs
    set message_count = message_count + 1
    where business_id = p_business_id and month = v_month and message_count < v_limit
    returning message_count into v_new_count;

  return v_new_count is not null;
end;
$$;
