// End-to-end verification of Phase 3: a real conversation through the real
// /api/chat endpoint stays grounded in that business's own trained content
// (and doesn't leak a second business's content), free-plan quota blocks the
// 21st message without calling Claude, a restricted (cancelled) business is
// blocked outright, and replies are split into multiple short, humanly-paced
// messages. Uses the real running dev server, the real Voyage API, and the
// real Claude API. Cleans up everything it creates.
//
// Usage: node --env-file=.env.local scripts/verify-phase3-chat.mjs
// Requires: npm run dev already running on http://localhost:3000

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Voyage's free tier without a payment method on file caps at 3 req/min --
// space embedding calls out to stay under it (see Phase 2 changelog entry).
const VOYAGE_CALL_GAP_MS = 25000;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

async function embedAndStore(businessId, sourceId, text) {
  await sleep(VOYAGE_CALL_GAP_MS);
  const { VoyageAIClient } = await import("voyageai");
  const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
  const res = await voyage.embed({
    input: [text],
    model: "voyage-4-lite",
    inputType: "document",
    outputDimension: 1024,
  });
  const embedding = res.data[0].embedding;
  await admin.from("knowledge_chunks").insert({
    business_id: businessId,
    source_id: sourceId,
    content: text,
    embedding,
  });
}

async function createBusiness(name, plan, status) {
  const { data: biz } = await admin
    .from("businesses")
    .insert({ name, plan, status, system_prompt: `You are a helpful assistant for ${name}.` })
    .select("id")
    .single();
  const { data: source } = await admin
    .from("knowledge_sources")
    .insert({ business_id: biz.id, type: "text", file_url: "manual-test", status: "ready" })
    .select("id")
    .single();
  return { businessId: biz.id, sourceId: source.id };
}

async function chat(businessId, message, sessionId) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, message, sessionId }),
  });
  return { status: res.status, body: await res.json() };
}

let bizA, bizB, bizRestricted;

try {
  bizA = await createBusiness(`Chat Test Salon ${suffix}`, "free", "active");
  bizB = await createBusiness(`Chat Test Bistro ${suffix}`, "free", "active");
  bizRestricted = await createBusiness(`Chat Test Restricted ${suffix}`, "free", "cancelled");

  await embedAndStore(
    bizA.businessId,
    bizA.sourceId,
    "Glow Hair Salon is open Monday to Saturday, 9am to 6pm. We accept walk-ins but appointments are preferred. Haircuts are $30."
  );
  await embedAndStore(
    bizB.businessId,
    bizB.sourceId,
    "Luna Bistro's secret off-menu dish is the truffle mushroom risotto, only available if you ask for it by name."
  );

  // --- Grounded, multi-turn conversation for business A ---
  const turn1 = await chat(bizA.businessId, "What are your business hours?");
  check("turn 1 returns 200", turn1.status === 200, JSON.stringify(turn1.body).slice(0, 200));
  check("turn 1 is not blocked", turn1.body.blocked === false);
  const reply1 = turn1.body.replies?.map((r) => r.content).join(" ") ?? "";
  check(
    "turn 1 reply is grounded in trained content (mentions hours)",
    /9\s*am|9:00|monday/i.test(reply1),
    reply1.slice(0, 150)
  );
  check(
    "turn 1 reply avoids AI disclaimers",
    !/as an ai|i'?m an ai|language model|i don'?t have (personal )?feelings/i.test(reply1),
    reply1.slice(0, 150)
  );
  check(
    "turn 1 replies are split into multiple short messages with proportional delays",
    turn1.body.replies.length >= 1 &&
      turn1.body.replies.every((r) => {
        const expected = Math.max(500, Math.min(3500, 300 + r.content.length * 30));
        return r.delayMs === expected;
      }),
    JSON.stringify(turn1.body.replies.map((r) => ({ len: r.content.length, delayMs: r.delayMs })))
  );

  await sleep(VOYAGE_CALL_GAP_MS);
  const turn2 = await chat(bizA.businessId, "Do you take walk-ins?", turn1.body.sessionId);
  check("turn 2 reuses the same session", turn2.body.sessionId === turn1.body.sessionId);
  const reply2 = turn2.body.replies?.map((r) => r.content).join(" ") ?? "";
  check(
    "turn 2 reply is grounded (mentions walk-ins/appointments)",
    /walk-?in|appointment/i.test(reply2),
    reply2.slice(0, 150)
  );

  // --- Cross-tenant isolation through the full chat pipeline ---
  await sleep(VOYAGE_CALL_GAP_MS);
  const turn3 = await chat(bizA.businessId, "What's your secret off-menu dish?", turn1.body.sessionId);
  const reply3 = turn3.body.replies?.map((r) => r.content).join(" ") ?? "";
  check(
    "business A's reply never leaks business B's trained content",
    !/truffle mushroom risotto/i.test(reply3),
    reply3.slice(0, 150)
  );

  // --- Free-plan quota: seed usage to the limit, confirm the next message is blocked ---
  const month = new Date().toISOString().slice(0, 7);
  await admin
    .from("usage_logs")
    .upsert({ business_id: bizA.businessId, month, message_count: 20 }, { onConflict: "business_id,month" });

  const { count: messagesBeforeBlock } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", turn1.body.sessionId);

  const blockedTurn = await chat(bizA.businessId, "One more question", turn1.body.sessionId);
  check(
    "21st message is blocked without calling Claude",
    blockedTurn.body.blocked === true && blockedTurn.body.replies.length === 0,
    JSON.stringify(blockedTurn.body)
  );

  const { count: messagesAfterBlock } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", turn1.body.sessionId);
  check(
    "blocked turn still records the visitor's message but no assistant reply",
    messagesAfterBlock === messagesBeforeBlock + 1,
    `before=${messagesBeforeBlock} after=${messagesAfterBlock}`
  );

  const { data: usageRow } = await admin
    .from("usage_logs")
    .select("message_count")
    .eq("business_id", bizA.businessId)
    .eq("month", month)
    .single();
  check("quota count did not increment past the limit", usageRow.message_count === 20, usageRow.message_count);

  // --- Restricted (cancelled) business is blocked outright ---
  const restrictedTurn = await chat(bizRestricted.businessId, "Hello?");
  check(
    "cancelled business blocks chat with a billing message, not a quota message",
    restrictedTurn.body.blocked === true && /unavailable/i.test(restrictedTurn.body.blockedReason),
    JSON.stringify(restrictedTurn.body)
  );

  const { data: restrictedUsage } = await admin
    .from("usage_logs")
    .select("message_count")
    .eq("business_id", bizRestricted.businessId)
    .eq("month", month)
    .maybeSingle();
  check(
    "restricted business never even reaches the quota check",
    !restrictedUsage,
    JSON.stringify(restrictedUsage)
  );
} finally {
  for (const biz of [bizA, bizB, bizRestricted].filter(Boolean)) {
    await admin.from("businesses").delete().eq("id", biz.businessId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PHASE 3 CHAT ENGINE VERIFICATION FAILED");
  process.exit(1);
}
console.log("Phase 3 chat engine verified end-to-end.");
