-- Public bucket for individual account-holder profile photos (distinct from
-- assistant-photos, which is the business's own persona photo shown to
-- website visitors). Public read so the photo can be displayed via a plain
-- URL; writes go through a server action using the service-role client
-- after confirming the caller owns the auth user ID in the storage path, so
-- no client-facing storage policy is needed.
insert into storage.buckets (id, name, public)
values ('user-avatars', 'user-avatars', true)
on conflict (id) do nothing;
