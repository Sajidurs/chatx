-- Lets the conversations list show which conversations have a new visitor
-- message the business hasn't looked at yet, like a typical inbox unread
-- indicator. Two columns rather than one: last_visitor_message_at tracks
-- only the visitor's side of the conversation (the business's own replies
-- shouldn't make a conversation look "unread" to itself), compared against
-- last_seen_by_business_at, stamped whenever someone actually opens the
-- conversation's detail page.
alter table chat_sessions add column last_seen_by_business_at timestamptz;
alter table chat_sessions add column last_visitor_message_at timestamptz;

-- Backfill so existing conversations don't all retroactively show as
-- unread the moment this ships -- only new visitor activity from here on
-- should count.
update chat_sessions set last_seen_by_business_at = now();

update chat_sessions cs
set last_visitor_message_at = (
  select max(cm.created_at) from chat_messages cm
  where cm.session_id = cs.id and cm.role = 'visitor'
);
