"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createAdminClient } from "@/lib/supabase/admin";

// All three actions use the admin client rather than the RLS-scoped one --
// sendBusinessReply needs to write chat_messages, which (like every other
// write to that table) has never had a client-facing insert policy, only
// the service-role path everything else already uses. Kept the same client
// for take-over/hand-back too so all three actions verify ownership the
// same explicit way, rather than splitting between RLS and admin for
// reasons that wouldn't be obvious later.

async function assertOwnedSession(businessId: string, sessionId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("chat_sessions").select("id").eq("id", sessionId).eq("business_id", businessId).maybeSingle();
  if (!data) redirect("/dashboard/conversations");
  return admin;
}

export async function takeOverConversation(sessionId: string) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  const admin = await assertOwnedSession(context.business.id, sessionId);

  // Taking over means you're handling it directly now -- clears the AI's
  // own "I'm stuck" flag along with switching who's in control.
  await admin
    .from("chat_sessions")
    .update({ controlled_by: "human", needs_handoff: false })
    .eq("id", sessionId)
    .eq("business_id", context.business.id);

  revalidatePath(`/dashboard/conversations/${sessionId}`);
}

export async function handBackToAI(sessionId: string) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  const admin = await assertOwnedSession(context.business.id, sessionId);

  await admin.from("chat_sessions").update({ controlled_by: "ai" }).eq("id", sessionId).eq("business_id", context.business.id);

  revalidatePath(`/dashboard/conversations/${sessionId}`);
}

export async function sendBusinessReply(formData: FormData) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const sessionId = String(formData.get("sessionId") || "");
  const message = String(formData.get("message") || "").trim();
  if (!sessionId) redirect("/dashboard/conversations");
  if (!message) redirect(`/dashboard/conversations/${sessionId}`);

  const admin = await assertOwnedSession(context.business.id, sessionId);

  await admin.from("chat_messages").insert({ session_id: sessionId, role: "business", content: message });
  await admin.from("chat_sessions").update({ last_message_at: new Date().toISOString() }).eq("id", sessionId).eq("business_id", context.business.id);

  revalidatePath(`/dashboard/conversations/${sessionId}`);
}
