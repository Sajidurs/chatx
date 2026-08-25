import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedQuery } from "@/lib/ai/voyage";
import { generateReply, type ChatTurn } from "@/lib/ai/claude";
import { splitIntoMessages, computeTypingDelayMs } from "@/lib/chat/pacing";
import { isBusinessRestricted } from "@/lib/billing/access";
import { BOOKING_TOOLS, createBookingToolExecutor } from "@/lib/google/booking-tools";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant for this business. Answer naturally and conversationally, like a real staff member. Keep replies short. Never mention that you are an AI or a bot.";

const MATCH_COUNT = 5;

export type ChatReply = { id: string; content: string; delayMs: number };

export type RespondResult =
  | { sessionId: string; blocked: true; blockedReason: string; replies: []; controlledBy: "ai" | "human" }
  | { sessionId: string; blocked: false; replies: ChatReply[]; controlledBy: "ai" | "human" };

export async function respondToVisitorMessage(params: {
  businessId: string;
  sessionId?: string;
  visitorId: string;
  message: string;
  imageUrl?: string;
  lead?: { name: string; email: string };
}): Promise<RespondResult> {
  const admin = createAdminClient();

  // The business fetch and the existing-session lookup don't depend on each
  // other's result -- running them together instead of one after another
  // saves a full round trip for the common case of a returning visitor
  // continuing an existing session (a real, measurable chunk of this
  // request's total latency, confirmed by profiling the live production
  // endpoint end to end).
  const [{ data: business }, { data: existingSession }] = await Promise.all([
    admin
      .from("businesses")
      .select("id, name, plan, status, past_due_at, system_prompt, google_refresh_token, google_calendar_id, timezone")
      .eq("id", params.businessId)
      .single(),
    params.sessionId
      ? admin
          .from("chat_sessions")
          .select("id, controlled_by")
          .eq("id", params.sessionId)
          .eq("business_id", params.businessId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!business) throw new Error("Business not found");

  // --- Resolve or create the chat session ---
  let sessionId = existingSession ? params.sessionId : undefined;
  let controlledBy: "ai" | "human" = existingSession?.controlled_by ?? "ai";
  if (!sessionId) {
    const { data: created, error } = await admin
      .from("chat_sessions")
      .insert({ business_id: params.businessId, visitor_id: params.visitorId })
      .select("id, controlled_by")
      .single();
    if (error || !created) throw new Error("Could not create chat session");
    sessionId = created.id;
    controlledBy = created.controlled_by;
  }
  // Non-null: the two blocks above guarantee sessionId is set by this point;
  // TS's control-flow narrowing doesn't carry that across the await points.
  const resolvedSessionId = sessionId!;

  // Lead capture: the widget only sends `lead` once, on the intake form
  // submission that starts the conversation -- guarded against duplicate
  // inserts (a retried request, etc.) rather than trusting the client only
  // ever sends it once.
  if (params.lead) {
    const { data: existingLead } = await admin
      .from("leads")
      .select("id")
      .eq("session_id", resolvedSessionId)
      .maybeSingle();
    if (!existingLead) {
      await admin.from("leads").insert({
        business_id: params.businessId,
        session_id: resolvedSessionId,
        name: params.lead.name,
        email: params.lead.email,
        message: params.message,
      });
    }
  }

  // Record the visitor's message regardless of quota/restriction outcome --
  // it's a real message that was sent, even if it doesn't get an AI reply.
  // Independent writes (neither reads the other's result), so they run
  // concurrently rather than as two sequential round trips.
  const nowIso = new Date().toISOString();
  await Promise.all([
    admin
      .from("chat_messages")
      .insert({ session_id: resolvedSessionId, role: "visitor", content: params.message, image_url: params.imageUrl ?? null }),
    admin.from("chat_sessions").update({ last_message_at: nowIso, last_visitor_message_at: nowIso }).eq("id", resolvedSessionId),
  ]);

  // Billing restriction takes priority over the message quota -- a
  // cancelled/grace-period-expired business shouldn't be able to use the
  // chat feature at all, regardless of how many messages they have left.
  if (isBusinessRestricted(business)) {
    return {
      sessionId: resolvedSessionId,
      blocked: true,
      blockedReason: "This business's assistant is temporarily unavailable. Please contact them directly.",
      replies: [],
      controlledBy,
    };
  }

  // A human has taken this conversation over -- no AI reply, no quota
  // consumed (there's no AI cost to charge against), just record the
  // visitor's message (already done above) and let the widget's polling
  // pick up whatever the human replies with.
  if (controlledBy === "human") {
    return { sessionId: resolvedSessionId, blocked: false, replies: [], controlledBy };
  }

  // Quota is checked (and, if allowed, consumed) before calling Claude at all
  // -- never generate a reply first and decide whether to count it after.
  // The cap is on distinct visitors per month, not total messages -- a
  // visitor already counted this month is always allowed through
  // regardless of how many messages they send; only a new 21st (etc.)
  // different person in the same month gets blocked.
  const { data: allowed, error: quotaError } = await admin.rpc("try_consume_message_quota", {
    p_business_id: params.businessId,
    p_visitor_id: params.visitorId,
  });
  if (quotaError) throw quotaError;

  if (!allowed) {
    return {
      sessionId: resolvedSessionId,
      blocked: true,
      blockedReason:
        "This business has reached its plan limit for the month. Please contact them directly for further help.",
      replies: [],
      controlledBy,
    };
  }

  // --- Retrieval, plus everything else needed for this turn ---
  // None of these four depend on each other's result, only on data already
  // in hand (resolvedSessionId, business.plan) -- confirmed via direct
  // production profiling that running them one after another (as this
  // originally did) was a real, measurable chunk of total reply latency.
  // The embed-then-match pair is still sequential internally (match needs
  // the embedding), but that pair now runs concurrently with the other
  // three lookups instead of blocking them.
  const [{ data: chunks }, { data: lead }, { data: planLimits }, { data: priorMessages }] = await Promise.all([
    // Voyage rejects an empty string -- an image sent with no caption has
    // nothing to embed, so there's no knowledge-base query to run for it.
    // The knowledge-base lookup is supplementary context, not essential to
    // replying at all -- a transient Voyage/Supabase failure here (e.g. a
    // 429 from Voyage's per-minute rate limit) must not take down the whole
    // turn. A real production incident: this used to be unguarded inside
    // the same Promise.all, so one Voyage rate-limit error failed the
    // entire request with a generic "Something went wrong," even though the
    // assistant could easily have answered from the system prompt and
    // conversation history alone, just without the extra document context.
    params.message.trim()
      ? embedQuery(params.message)
          .then((queryEmbedding) =>
            admin.rpc("match_knowledge_chunks", {
              p_business_id: params.businessId,
              p_query_embedding: JSON.stringify(queryEmbedding),
              p_match_count: MATCH_COUNT,
            })
          )
          .catch((err) => {
            console.error("Knowledge-base retrieval failed; continuing without it", err);
            return { data: null };
          })
      : Promise.resolve({ data: null }),
    admin.from("leads").select("name, email").eq("session_id", resolvedSessionId).maybeSingle(),
    admin.from("plan_limits").select("booking_enabled").eq("plan", business.plan).single(),
    admin
      .from("chat_messages")
      .select("role, content, image_url")
      .eq("session_id", resolvedSessionId)
      .order("created_at", { ascending: true }),
  ]);

  const knowledgeSection =
    chunks && chunks.length > 0
      ? `\n\nRelevant information from this business's own documents:\n${chunks
          .map((c: { content: string }) => `- ${c.content}`)
          .join("\n")}`
      : "";

  // Claude has no innate sense of "today" -- without this, a customer saying
  // a bare date like "18th August" (no year) gets resolved against whatever
  // date feels plausible from training, which can land in the past. This bit
  // caused a real booking to be confirmed for 2025 instead of 2026.
  //
  // Stated in the business's own local timezone, not UTC -- a customer near
  // midnight in one direction or the other would otherwise see "today" shift
  // by a day, and (the bigger bug this fixes) a bare customer-given time like
  // "10AM" needs a timezone to be meaningful at all. The booking tools below
  // are told to hand back local wall-clock times with no UTC offset for
  // exactly this reason -- see resolveToUtcIso and calendar.ts's `timeZone`
  // passthrough for how that's then turned into the right real instant.
  const now = new Date();
  const businessTimeZone = business.timezone || "UTC";
  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: businessTimeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  const dateContext = `Current date and time where this business operates (timezone: ${businessTimeZone}): ${localNow}. When a customer gives a date without a year (e.g. "August 18th"), assume the next upcoming occurrence of that date -- never a date in the past. When a customer gives a bare time with no timezone mentioned (completely normal in a live chat -- e.g. "10AM" or "does 3pm work?"), assume they mean ${businessTimeZone} local time; never treat it as UTC. When calling check_availability, create_booking, or reschedule_booking, always give times as a LOCAL wall-clock date/time in ${businessTimeZone} WITHOUT any UTC offset or "Z" suffix (e.g. "2026-08-20T10:00:00", not "2026-08-20T10:00:00Z") -- the system applies ${businessTimeZone} automatically.`;

  // The intake form already collected the visitor's name/email before this
  // conversation started -- fetched fresh each turn (not just read from
  // params.lead) so the AI still knows it on turn 2, 3, etc., not only the
  // turn that happened to submit it. (Fetched above, alongside retrieval.)
  const leadContext = lead
    ? `The visitor already gave their name (${lead.name}) and email (${lead.email}) on an intake form before this conversation started -- feel free to address them by name, and don't ask for this again.`
    : "";

  // Confirmed directly (reproduced, then fixed the message-structure half of
  // this above): even with a well-formed, alternating history, Claude would
  // still sometimes deflect ("I don't have that in front of me") on a fact
  // stated earlier in the SAME conversation, specifically right after a
  // stretch where a human agent had been replying instead of the AI. Nothing
  // told it those earlier turns were trustworthy, already-established parts
  // of THIS conversation rather than something to be newly cautious about --
  // this makes that explicit.
  const handoffContinuityContext =
    "Some earlier replies in this conversation may have been sent directly by a team member instead of generated by you (for example, while a human had taken over the chat). Treat everything already said earlier in this conversation -- by you or by a team member -- as established, trustworthy information you already know. If the customer asks you to repeat or confirm something already stated earlier (like an order detail, a time, or a reference number), just repeat it confidently -- never claim you don't have information that's already visible earlier in this chat.";

  // Only added when this specific turn actually has an image attached --
  // no need to spend tokens on this for the (large majority of) turns that
  // don't.
  const imageContext = params.imageUrl
    ? "The customer just sent a photo along with (or instead of) a text message. Look at it carefully and answer based on what's actually shown -- same short, conversational style as any other reply, not a formal image description."
    : "";

  // Applies regardless of what a business owner writes in their own
  // persona/tone -- a real customer's complaint about a real reply
  // ("How many services do you have?" answered with the full menu, all 9
  // items and every price, instead of just the count) is what this fixes.
  // Deliberately global rather than something each business has to
  // remember to configure themselves.
  const concisenessContext =
    "Keep every reply short -- one to three sentences is usually enough, like a real staff member quickly texting back, not an email. Never dump a full list of every service, price, or detail unless the customer specifically asked for the full list -- answer the actual question first, and only offer more (\"Want me to list them?\") if it's genuinely useful. Don't pad a reply with extra reassurance or restating what was just asked.";

  // Human handoff (flagging a conversation, someone taking it over) is
  // hidden for now -- see CHANGELOG 2026-08-20. Without this, a genuinely
  // stuck reply would still say things like "I'll flag this for our team"
  // out of habit, which is now a false promise: there's no mechanism left
  // to act on it, and a real frustrated customer would be told help is
  // coming when it isn't.
  const noHandoffContext =
    "If you genuinely can't resolve something for the customer, do not say you're flagging it, escalating it, or that a team member will follow up -- there is no one monitoring this chat to act on that right now. Instead, apologize for not being able to help further, and if you know how to reach this business directly (phone, email, etc. -- only if you actually know it from what you've been trained on), share that as the next step.";

  // Booking tools are only actually attached to `tools` further below, once
  // history/executor setup is done -- computed here, ahead of the system
  // prompt, so the AI is told the truth about whether it can book *before*
  // it starts responding. Without this, the AI has no booking tool AND no
  // idea it's missing one, so it keeps behaving as if a booking is in
  // progress (asking for a preferred date/time/service) right up until the
  // moment it would have called a tool that was never offered to it -- a
  // real bug a customer hit on a free-plan business's widget. (Fetched
  // above, alongside retrieval.)
  const bookingReady = Boolean(planLimits?.booking_enabled && business.google_refresh_token && business.google_calendar_id);
  const noBookingContext = !bookingReady
    ? "You cannot book, reschedule, or cancel appointments through this chat right now -- that capability isn't available for this business at the moment. If a customer asks to book, do not ask for their preferred date, time, or service as if a booking is in progress. Instead, let them know you can't book directly through chat, and if you know this business's phone number or email (only if you actually know it from what you've been trained on), share it as the way to book. If you don't know a phone number or email, just apologize and say you're not able to book directly right now."
    : "";

  const systemPrompt =
    [
      concisenessContext,
      dateContext,
      leadContext,
      handoffContinuityContext,
      noHandoffContext,
      noBookingContext,
      imageContext,
      business.system_prompt || DEFAULT_SYSTEM_PROMPT,
    ]
      .filter(Boolean)
      .join("\n\n") + knowledgeSection;

  // --- Conversation history, oldest first, mapped to Claude's roles ---
  // (Fetched above, alongside retrieval.)
  const rawHistory: ChatTurn[] = (priorMessages ?? []).map((m) => ({
    role: m.role === "visitor" ? "user" : "assistant",
    content: m.content,
    imageUrl: m.image_url ?? undefined,
  }));

  // Claude's Messages API expects strictly alternating user/assistant
  // turns -- both the AI's own replies and a human's replies map to
  // "assistant" here, so a few business messages sent in a row (no visitor
  // message between them, completely normal in a real support handoff)
  // produce several consecutive "assistant" turns. Confirmed directly this
  // makes Claude noticeably worse at recalling specifics from the middle of
  // that run (a fact stated in the last of three consecutive turns was
  // silently dropped after handing back to the AI, though the exact same
  // fact stated as a single prior turn was recalled correctly). Coalescing
  // consecutive same-role turns into one (joined by newlines) keeps the
  // actual conversation content identical while giving Claude the
  // well-formed alternating structure it's actually trained on.
  const history: ChatTurn[] = [];
  for (const turn of rawHistory) {
    const last = history[history.length - 1];
    // Never merges a turn carrying an image into the previous one (or vice
    // versa) -- the string-concatenation merge below only makes sense for
    // plain text, and an image turn already gets its own real content
    // blocks in generateReply, so it needs to stay a distinct turn.
    if (last && last.role === turn.role && !last.imageUrl && !turn.imageUrl) {
      last.content += `\n${turn.content}`;
    } else {
      history.push({ ...turn });
    }
  }

  // bookingReady (booking tools only exist for this turn if the plan
  // includes booking AND the business has actually connected a Google
  // Calendar) was already computed above, alongside noBookingContext.
  const bookingExecutor = bookingReady
    ? createBookingToolExecutor(
        {
          id: business.id,
          name: business.name,
          google_refresh_token: business.google_refresh_token!,
          google_calendar_id: business.google_calendar_id!,
          timezone: businessTimeZone,
        },
        resolvedSessionId
      )
    : undefined;

  // Human handoff (the AI flagging a conversation, and a business owner
  // taking it over) is hidden for launch -- "we will add these later if
  // needed." Not calling createHandoffToolExecutor/including HANDOFF_TOOL
  // here is the entire fix: the tool is simply never offered to Claude, so
  // it can't be called. The rest of the handoff/takeover code (the tool
  // definition itself, the dashboard UI, chat_sessions.controlled_by
  // handling below) is left intact and inert rather than deleted.
  const tools: Anthropic.Tool[] = bookingReady ? BOOKING_TOOLS : [];
  const executeTool = (name: string, input: Record<string, unknown>) => bookingExecutor!(name, input);

  const replyText = await generateReply({ systemPrompt, history, tools, executeTool });
  const chunksOut = splitIntoMessages(replyText);

  // Returning each inserted row's real id (not just content) is what lets
  // the widget dedupe against its own background poll -- see the matching
  // note in embed-widget.tsx's sendMessage for the exact duplicate-message
  // bug this fixes (a real customer hit it: an assistant reply shown once
  // via this direct response, then a second time moments later when a poll
  // tick landed before the client's timestamp-based "already seen" cursor
  // had been updated -- a real race on a slow reply, not a clock issue).
  let inserted: { id: string }[] = [];
  if (chunksOut.length > 0) {
    const { data } = await admin
      .from("chat_messages")
      .insert(chunksOut.map((content) => ({ session_id: resolvedSessionId, role: "assistant", content })))
      .select("id");
    inserted = data ?? [];
  }

  return {
    sessionId: resolvedSessionId,
    blocked: false,
    replies: chunksOut.map((content, i) => ({ id: inserted[i]?.id ?? "", content, delayMs: computeTypingDelayMs(content) })),
    controlledBy,
  };
}
