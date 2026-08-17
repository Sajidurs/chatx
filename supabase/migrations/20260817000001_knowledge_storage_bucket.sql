-- Private bucket for uploaded knowledge source documents. No client-facing
-- storage policies: uploads, downloads, and deletes all go through server
-- routes using the service-role client (same pattern as other sensitive
-- writes in this project), which validates business membership before
-- touching storage rather than relying on storage.objects RLS.
insert into storage.buckets (id, name, public)
values ('knowledge-sources', 'knowledge-sources', false)
on conflict (id) do nothing;
