import "server-only";
import type { User } from "@supabase/supabase-js";

/**
 * Supabase's signUp() never errors for an email that already has an account
 * -- to prevent enumeration, it instead returns a user-shaped object. For an
 * already-confirmed email it's an obfuscated placeholder (identities: []),
 * which a foreign key constraint on business_users.auth_user_id happens to
 * reject downstream. But for an *unconfirmed* existing account, it returns
 * the real user (identities non-empty, real id) with no signal in the error
 * or identities array -- only the original created_at gives it away, since a
 * genuinely new signup's created_at is "now".
 *
 * Verified empirically against this project (see CHANGELOG.md): resubmitting
 * signUp for an existing unconfirmed email does NOT change that account's
 * password, so this isn't an account-takeover path -- but without this
 * check, it silently attaches a stranger's real, unconsented-to auth_user_id
 * as the owner of a new business.
 */
export function isFreshSignup(user: Pick<User, "identities" | "created_at">): boolean {
  if (!user.identities || user.identities.length === 0) return false;
  const ageMs = Date.now() - new Date(user.created_at).getTime();
  return ageMs < 60_000;
}
