-- Human handover: lets a business owner/staff member actually reply to a
-- visitor from the dashboard, pausing the AI for that conversation until
-- they hand control back.
alter table chat_sessions
  add column controlled_by text not null default 'ai' check (controlled_by in ('ai', 'human'));

-- A reply sent by a human, distinct from the AI's own replies -- both still
-- read into Claude's history as "the business side" of the conversation
-- when control returns to the AI (src/lib/chat/respond.ts already maps any
-- non-visitor role to Claude's "assistant" role, so no change needed there).
alter table chat_messages drop constraint chat_messages_role_check;
alter table chat_messages add constraint chat_messages_role_check check (role in ('visitor', 'assistant', 'business'));
