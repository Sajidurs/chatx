-- Fixes the timezone bug logged in CHANGELOG.md's "Known gaps": bookings made
-- with a bare, unqualified time (e.g. "10AM") were treated as literal UTC,
-- with no way to know the business's real local timezone anywhere in the
-- schema. Defaults to 'UTC' so existing businesses keep their current
-- (already-known-wrong-for-non-UTC businesses) behavior until the owner sets
-- their real timezone in onboarding, rather than silently shifting every
-- existing booking's interpretation.
alter table businesses add column timezone text not null default 'UTC';

-- Same column-level lockdown pattern as the other owner-editable persona
-- fields from the Phase 1 migration (assistant_name, assistant_photo_url,
-- assistant_bio, system_prompt) -- "update on businesses" was already
-- revoked from authenticated there, so this only needs the additive grant.
grant update (timezone) on businesses to authenticated;
