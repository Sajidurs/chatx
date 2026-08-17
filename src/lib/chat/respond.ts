import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedQuery } from "@/lib/ai/voyage";
import { generateReply, type ChatTurn } from "@/lib/ai/claude";
import { splitIntoMessages, computeTypingDelayMs } from "@/lib/chat/pacing";
import { isBusinessRestricted } from "@/lib/billing/access";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant for this business. Answer naturally and conversationally, like a real staff member. Keep replies short. Never mention that you are an AI or a bot.";

const MATCH_COUNT = 5;

export type ChatReply = { content: string; delayMs: number };

export type RespondResult =
  | { sessionId: string; blocked: true; blockedReason: string; replies: [] }
  | { sessionId: string; blocked: false; replies: ChatReply[] };

export async function respondToVisitorMessage(params: {
  businessId: string;
  sessionId?: string;
  visitorId: string;
  message: string;
}): Promise<RespondResult> {
  const admin = createAdminClient();

  const { data: business } = await admin
    .from("businesses")
    .select("id, name, plan, status, past_due_at, system_prompt")
    .eq("id", params.businessId)
    .single();

  if (!business) throw new Error("Business not found");

  // --- Resolve or create the chat session ---
  let sessionId = params.sessionId;
  if (sessionId) {
    const { data: existing } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("business_id", params.businessId)
      .maybeSingle();
    if (!existing) sessionId = undefined;
  }
  if (!sessionId) {
    const { data: created, error } = await admin
      .from("chat_sessions")
      .insert({ business_id: params.businessId, visitor_id: params.visitorId })
      .select("id")
      .single();
    if (error || !created) throw new Error("Could not create chat session");
    sessionId = created.id;
  }
  // Non-null: the two blocks above guarantee sessionId is set by this point;
  // TS's control-flow narrowing doesn't carry that across the await points.
  const resolvedSessionId = sessionId!;

  // Record the visitor's message regardless of quota/restriction outcome --
  // it's a real message that was sent, even if it doesn't get an AI reply.
  await admin
    .from("chat_messages")
    .insert({ session_id: resolvedSessionId, role: "visitor", content: params.message });
  await admin
    .from("chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", resolvedSessionId);

  // Billing restriction takes priority over the message quota -- a
  // cancelled/grace-period-expired business shouldn't be able to use the
  // chat feature at all, regardless of how many messages they have left.
  if (isBusinessRestricted(business)) {
    return {
      sessionId: resolvedSessionId,
      blocked: true,
      blockedReason: "This business's assistant is temporarily unavailable. Please contact them directly.",
      replies: [],
    };
  }

  // Quota is checked (and, if allowed, consumed) before calling Claude at all
  // -- never generate a reply first and decide whether to count it after.
  const { data: allowed, error: quotaError } = await admin.rpc("try_consume_message_quota", {
    p_business_id: params.businessId,
  });
  if (quotaError) throw quotaError;

  if (!allowed) {
    return {
      sessionId: resolvedSessionId,
      blocked: true,
      blockedReason:
        "This business has reached its message limit for the month. Please contact them directly for further help.",
      replies: [],
    };
  }

  // --- Retrieval ---
  const queryEmbedding = await embedQuery(params.message);
  const { data: chunks } = await admin.rpc("match_knowledge_chunks", {
    p_business_id: params.businessId,
    p_query_embedding: JSON.stringify(queryEmbedding),
    p_match_count: MATCH_COUNT,
  });

  const knowledgeSection =
    chunks && chunks.length > 0
      ? `\n\nRelevant information from this business's own documents:\n${chunks
          .map((c: { content: string }) => `- ${c.content}`)
          .join("\n")}`
      : "";

  const systemPrompt = (business.system_prompt || DEFAULT_SYSTEM_PROMPT) + knowledgeSection;

  // --- Conversation history, oldest first, mapped to Claude's roles ---
  const { data: priorMessages } = await admin
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", resolvedSessionId)
    .order("created_at", { ascending: true });

  const history: ChatTurn[] = (priorMessages ?? []).map((m) => ({
    role: m.role === "visitor" ? "user" : "assistant",
    content: m.content,
  }));

  const replyText = await generateReply({ systemPrompt, history });
  const chunksOut = splitIntoMessages(replyText);

  if (chunksOut.length > 0) {
    await admin
      .from("chat_messages")
      .insert(chunksOut.map((content) => ({ session_id: resolvedSessionId, role: "assistant", content })));
  }

  return {
    sessionId: resolvedSessionId,
    blocked: false,
    replies: chunksOut.map((content) => ({ content, delayMs: computeTypingDelayMs(content) })),
  };
}
