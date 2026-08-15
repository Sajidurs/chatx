import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Marks a pending invite as accepted and links it to a real auth user. Guarded
 * by invite_token + status='pending' in the WHERE clause so an already-used or
 * unknown token is simply a no-op (0 rows affected) rather than an error.
 */
export async function acceptInvite(inviteToken: string, authUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("business_users")
    .update({ auth_user_id: authUserId, status: "accepted", invite_token: null })
    .eq("invite_token", inviteToken)
    .eq("status", "pending")
    .select("id")
    .single();

  return { accepted: !error && !!data };
}

export async function findPendingInvite(inviteToken: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_users")
    .select("email, businesses(name)")
    .eq("invite_token", inviteToken)
    .eq("status", "pending")
    .single();

  if (!data) return null;
  return { email: data.email, businessName: (data.businesses as unknown as { name: string })?.name };
}
