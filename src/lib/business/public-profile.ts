import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type PublicBusinessProfile = {
  id: string;
  name: string;
  assistantName: string | null;
  assistantPhotoUrl: string | null;
};

/**
 * Looks up only the fields the embed widget is allowed to show an anonymous
 * website visitor -- no plan, billing status, system prompt, or calendar
 * info. businessId here is untrusted input from a public embed snippet, the
 * same trust model /api/chat already uses.
 */
export async function getPublicBusinessProfile(businessId: string): Promise<PublicBusinessProfile | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("businesses")
    .select("id, name, assistant_name, assistant_photo_url")
    .eq("id", businessId)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    assistantName: data.assistant_name,
    assistantPhotoUrl: data.assistant_photo_url,
  };
}
