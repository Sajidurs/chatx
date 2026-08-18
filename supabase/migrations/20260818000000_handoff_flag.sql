-- Phase 6: lets the AI flag a conversation it genuinely couldn't resolve, so
-- the business owner gets notified and can follow up as a real person.
alter table chat_sessions
  add column needs_handoff boolean not null default false,
  add column handoff_reason text;
