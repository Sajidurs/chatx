-- The "members can view their business's team" RLS policy on business_users
-- is row-scoped, not column-scoped: any team member (not just the owner who
-- created an invite) could read another member's invite_token directly via
-- the anon key, since RLS only gates rows. The app itself only ever selects
-- id/email/role/status, but that's not something RLS enforces. Lock it down
-- at the grant level, same pattern already used for businesses.
--
-- auth_user_id is included even though the app never displays it, because
-- Postgres column privileges also gate columns referenced in WHERE/filter
-- clauses, not just the SELECT list -- src/lib/auth/current-business.ts
-- filters .eq("auth_user_id", user.id) via the anon-key client.
revoke select on business_users from authenticated;
grant select (id, business_id, email, role, status, created_at, auth_user_id)
  on business_users to authenticated;
