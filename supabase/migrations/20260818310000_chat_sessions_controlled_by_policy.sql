-- Lets a business member take a conversation over / hand it back from the
-- dashboard. Row-scoped via RLS (their own business's sessions only) AND
-- column-scoped via grant (only controlled_by -- members should go through
-- the app's own logic for everything else on this table, e.g.
-- needs_handoff is the AI's own signal, not something to hand-edit).
create policy "members can update controlled_by on their sessions"
  on chat_sessions for update
  to authenticated
  using (business_id in (select public.get_my_business_ids()))
  with check (business_id in (select public.get_my_business_ids()));

revoke update on chat_sessions from authenticated;
grant update (controlled_by) on chat_sessions to authenticated;
