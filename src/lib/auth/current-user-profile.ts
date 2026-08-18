import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CurrentUserProfile = {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * The signed-in person's own account info -- display name and avatar photo,
 * stored in Supabase Auth's user_metadata rather than a table, since these
 * belong to the auth user itself, not any one business membership (the same
 * person could belong to more than one business).
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return {
    email: user.email!,
    displayName: (user.user_metadata?.display_name as string | undefined) || null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) || null,
  };
}

export function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
