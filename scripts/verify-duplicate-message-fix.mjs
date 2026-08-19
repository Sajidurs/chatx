// Regression check for a real bug a live customer hit: while a human had
// taken over a conversation, an assistant reply (generated before the
// takeover) appeared TWICE on the visitor's widget. Confirmed directly that
// the database only ever had ONE row for it -- this was a pure client-side
// rendering duplicate, caused by a race between the widget's own direct
// display of a reply (right after /api/chat responds) and its background
// poll (every 4s) discovering the same already-inserted row again before
// the timestamp-based "already seen" cursor had caught up. Fixed by
// tracking real message ids and never rendering the same id twice, instead
// of relying on timing.
//
// Usage: node --env-file=.env.local scripts/verify-duplicate-message-fix.mjs
// Requires: npm run dev already running on http://localhost:3000.

import { chromium } from "playwright";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
const ownerEmail = `dupfix-owner-${stamp}@mailinator.com`;
const password = "TestPassword123!";

const browser = await chromium.launch();
let bizId, ownerUserId, sessionId;

try {
  const { data: owner } = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin.from("businesses").insert({ name: `Dup Fix Test ${stamp}`, assistant_name: "Sage" }).select("id").single();
  bizId = biz.id;
  await admin.from("business_users").insert({ business_id: bizId, email: ownerEmail, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  const visitorPage = await browser.newPage();
  await visitorPage.goto(`${BASE_URL}/widget/${bizId}`);
  await visitorPage.waitForLoadState("networkidle");
  await sleep(4000); // let Turbopack's on-demand compile settle (see verify-takeover-and-history.mjs's note)
  await visitorPage.getByRole("button", { name: "Open chat" }).click();
  await visitorPage.getByPlaceholder("Your name").fill("Jahiud");
  await visitorPage.getByPlaceholder("Your email").fill(`jahiud-${stamp}@mailinator.com`);
  await visitorPage.getByPlaceholder("How can we help?").fill("Hi there, how are you today?");
  await visitorPage.getByRole("button", { name: "Start chat" }).click();

  let lead = null;
  for (let i = 0; i < 20 && !lead; i++) {
    await sleep(1000);
    ({ data: lead } = await admin.from("leads").select("session_id").eq("business_id", bizId).maybeSingle());
  }
  if (!lead) throw new Error("Lead was never created -- the intake form submission itself failed.");
  sessionId = lead.session_id;
  await sleep(10000);

  const { data: allEarly } = await admin.from("chat_messages").select("role, content, created_at").eq("session_id", sessionId).order("created_at");
  console.log("all messages after intake:", JSON.stringify(allEarly, null, 2));

  const { data: aiReply } = await admin
    .from("chat_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  check("the AI's own turn produced a real reply before takeover", !!aiReply, JSON.stringify(aiReply));

  // Owner takes over while the visitor's page stays open, polling -- the
  // exact real-world shape of the report.
  const ownerPage = await browser.newPage();
  await ownerPage.goto(`${BASE_URL}/login`);
  await ownerPage.fill('input[name="email"]', ownerEmail);
  await ownerPage.fill('input[name="password"]', password);
  await ownerPage.click('button[type="submit"]');
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.goto(`${BASE_URL}/dashboard/conversations/${sessionId}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.getByRole("button", { name: "Take over" }).click();
  await sleep(2000);

  const replyText = "Sure, you can pay half";
  await ownerPage.getByPlaceholder("Reply as yourself...").fill(replyText);
  await ownerPage.getByRole("button", { name: "Send" }).click();

  // Give the widget's poll several ticks to potentially re-render anything.
  await sleep(12000);

  const { data: businessRows } = await admin.from("chat_messages").select("id").eq("session_id", sessionId).eq("content", replyText);
  check("the human's reply was inserted exactly once in the database", businessRows?.length === 1, `${businessRows?.length} row(s)`);

  const visitorText = await visitorPage.evaluate(() => document.body.innerText);
  const aiReplyOccurrences = aiReply ? visitorText.split(aiReply.content).length - 1 : 0;
  const humanReplyOccurrences = visitorText.split(replyText).length - 1;
  check("the AI's earlier reply appears exactly once on the visitor's widget, not duplicated", aiReplyOccurrences === 1, `appeared ${aiReplyOccurrences} time(s)`);
  check("the human's reply appears exactly once on the visitor's widget", humanReplyOccurrences === 1, `appeared ${humanReplyOccurrences} time(s)`);
} finally {
  await browser.close();
  if (sessionId) {
    await admin.from("chat_messages").delete().eq("session_id", sessionId);
    await admin.from("leads").delete().eq("session_id", sessionId);
    await admin.from("chat_sessions").delete().eq("id", sessionId);
  }
  if (bizId) {
    await admin.from("business_users").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("DUPLICATE MESSAGE FIX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: no duplicate rendering of AI or human replies on the visitor's widget.");
