import "server-only";
import { createClient } from "@/lib/supabase/server";

type Business = {
  id: string;
  name: string;
  plan: "free" | "starter" | "pro";
  status: "active" | "past_due" | "cancelled";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  assistant_name: string | null;
  assistant_photo_url: string | null;
  assistant_bio: string | null;
  system_prompt: string | null;
  google_calendar_id: string | null;
  past_due_at: string | null;
  timezone: string;
  created_at: string;
};

export type CurrentBusinessContext = {
  userId: string;
  email: string;
  role: "owner" | "staff";
  business: Business;
};

/**
 * Resolves the signed-in user's business membership, or null if there is no
 * session or no accepted membership. Runs as the signed-in user (subject to
 * RLS), not the service role -- this only ever returns data that user is
 * already allowed to see.
 */
export async function getCurrentBusinessContext(): Promise<CurrentBusinessContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Nothing in the schema prevents one auth user from having accepted
  // memberships in more than one business (e.g. invited to a second one).
  // There's no business-switcher UI yet, so this just picks the earliest --
  // .single() here would throw on more than one row and lock the user out
  // of a dashboard they're entitled to see.
  const { data: memberships } = await supabase
    .from("business_users")
    .select("role, businesses(*)")
    .eq("auth_user_id", user.id)
    .eq("status", "accepted")
    .order("created_at", { ascending: true })
    .limit(1);

  const membership = memberships?.[0];
  if (!membership || !membership.businesses) return null;

  return {
    userId: user.id,
    email: user.email!,
    role: membership.role as "owner" | "staff",
    business: membership.businesses as unknown as Business,
  };
}
