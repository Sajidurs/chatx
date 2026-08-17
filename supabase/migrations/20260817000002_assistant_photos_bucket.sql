-- Public bucket for assistant persona photos -- these are meant to be shown
-- to website visitors on the embedded widget (Phase 5), so public read is
-- correct here (unlike knowledge-sources, which stays private). Writes still
-- go through a server route using the service-role client after validating
-- the caller owns the business, so no client-facing storage policy is needed.
insert into storage.buckets (id, name, public)
values ('assistant-photos', 'assistant-photos', true)
on conflict (id) do nothing;
