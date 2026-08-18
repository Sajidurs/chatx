import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendHandoffNotification } from "@/lib/email/resend";

// Available to every business regardless of plan -- unlike booking, this is
// about conversation quality/lead capture, not a calendar integration.
export const HANDOFF_TOOL: Anthropic.Tool = {
  name: "flag_for_human_handoff",
  description:
    "Call this when you genuinely cannot help the visitor -- a complaint, a question outside what you know, or they explicitly ask for a real person. This notifies the business owner so they can follow up directly. Only call this once per conversation.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "A short summary of why a human needs to step in" },
    },
    required: ["reason"],
  },
};

export function createHandoffToolExecutor(business: { id: string; name: string }, sessionId: string) {
  const admin = createAdminClient();

  return async function executeHandoffTool(name: string, input: Record<string, unknown>): Promise<string> {
    if (name !== "flag_for_human_handoff") {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    const reason = String(input.reason ?? "No reason given");

    // Guard against re-flagging (and re-emailing) on every subsequent
    // message in a conversation that's already been flagged once.
    const { data: session } = await admin
      .from("chat_sessions")
      .select("needs_handoff")
      .eq("id", sessionId)
      .eq("business_id", business.id)
      .single();
    if (session?.needs_handoff) {
      return JSON.stringify({ flagged: true, note: "Already flagged earlier in this conversation." });
    }

    await admin
      .from("chat_sessions")
      .update({ needs_handoff: true, handoff_reason: reason })
      .eq("id", sessionId)
      .eq("business_id", business.id);

    const { data: owner } = await admin
      .from("business_users")
      .select("email")
      .eq("business_id", business.id)
      .eq("role", "owner")
      .eq("status", "accepted")
      .single();

    if (owner) {
      await sendHandoffNotification({
        to: owner.email,
        businessName: business.name,
        reason,
        sessionId,
      }).catch((err) => {
        // The flag itself already succeeded (visible in the dashboard) --
        // don't let a transient email failure surface as a tool error to
        // the visitor mid-conversation.
        console.error("Failed to send handoff notification email", err);
      });
    }

    return JSON.stringify({ flagged: true });
  };
}
