// Reproduces and verifies the fix for a real production bug: a customer's
// message got "Something went wrong. Please try again." once, then worked
// fine on an identical retry. Root cause, confirmed from real Vercel
// production logs (`vercel logs app.falahchat.com --level error`):
//
//   Chat request failed i: Status code: 429 Body: { "detail": "You have not
//   yet added your payment method... reduced rate limits of 3 RPM..." }
//
// Voyage AI's embedding call (used for every turn's knowledge-base lookup)
// hit its free-tier rate limit. That call was unguarded inside the same
// Promise.all as everything else needed to reply, so its rejection failed
// the ENTIRE chat turn -- even though retrieved documents are supplementary,
// not essential to answering.
//
// This can't wait for the real Voyage account to rate-limit itself again
// (and shouldn't be triggered deliberately against it), so this instead
// makes EVERY Voyage call fail by running against a deliberately broken
// VOYAGE_API_KEY, and confirms respond.ts now degrades gracefully instead
// of failing the whole request.
//
// Usage:
//   VOYAGE_API_KEY=invalid-broken-key-for-testing npm run dev   (separate terminal)
//   node --env-file=.env.local scripts/verify-rag-failure-resilience.mjs
// (--env-file loads real values for everything else; the shell's exported
// VOYAGE_API_KEY on the dev server process is what actually matters here.)

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const stamp = Date.now();
const bizName = `RAG Resilience Test ${stamp}`;
let bizId;

try {
  const { data: biz } = await admin
    .from("businesses")
    .insert({ name: bizName, assistant_name: "Sage", system_prompt: "You are a helpful assistant for a small business. Keep replies short." })
    .select("id")
    .single();
  bizId = biz.id;

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: bizId,
      message: "Hi, what services do you offer?",
      visitorId: "rag-resilience-test-visitor",
    }),
  });
  const body = await res.json().catch(() => ({}));

  check("the request does NOT fail with a 500 when the knowledge-base lookup errors out", res.status === 200, `status=${res.status} body=${JSON.stringify(body).slice(0, 300)}`);
  check(
    "a real assistant reply still comes back, not the generic 'Something went wrong' error",
    Array.isArray(body.replies) && body.replies.length > 0 && body.replies.some((r) => r.content?.trim()),
    JSON.stringify(body.replies)
  );

  const { data: sessions } = await admin.from("chat_sessions").select("id").eq("business_id", bizId);
  check("a real chat session was created despite the Voyage failure", (sessions?.length ?? 0) === 1, JSON.stringify(sessions));

  if (sessions?.[0]) {
    const { data: messages } = await admin.from("chat_messages").select("role, content").eq("session_id", sessions[0].id);
    check(
      "both the visitor's message and the assistant's reply were actually stored",
      messages?.some((m) => m.role === "visitor") && messages?.some((m) => m.role === "assistant"),
      JSON.stringify(messages)
    );
  }
} finally {
  if (bizId) {
    const { data: sessions } = await admin.from("chat_sessions").select("id").eq("business_id", bizId);
    for (const s of sessions ?? []) {
      await admin.from("chat_messages").delete().eq("session_id", s.id);
      await admin.from("chat_sessions").delete().eq("id", s.id);
    }
    await admin.from("businesses").delete().eq("id", bizId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("RAG FAILURE RESILIENCE VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: a knowledge-base retrieval failure (Voyage down/rate-limited) no longer fails the whole chat turn.");
