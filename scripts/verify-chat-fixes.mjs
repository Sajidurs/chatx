// Verifies the five issues the founder reported after testing the human
// takeover + widget feature live:
// 1. A reply sent from the dashboard while a human has taken over didn't
//    show up on the widget until the visitor manually refreshed the page.
//    Root cause: the widget's polling effect keyed off `open`/`leadCaptured`,
//    but a session ID set asynchronously via a ref mutation (not state)
//    never actually triggered that effect to start for a brand-new
//    conversation -- only a full page reload (which re-mounts everything)
//    happened to paper over it. This test deliberately never reloads the
//    visitor's page, which is exactly what the old code got wrong.
// 2. Sending a reply from the dashboard felt slow. Root cause: the
//    optimistic UI update was wrapped inside <form action={fn}>, which
//    defers the whole handler until the server round-trip resolves instead
//    of committing synchronously.
// 3. The visitor couldn't type/send a follow-up while the AI was still
//    replying to the previous message (input was disabled).
// 4. No way for the business to see which conversations have new visitor
//    activity vs. already read -- new unread indicator on the list page.
// 5. Sound notification when a new message arrives while minimized/closed.
//
// Usage: node --env-file=.env.local scripts/verify-chat-fixes.mjs
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
const ownerEmail = `chatfix-owner-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = `Chat Fixes Test Co ${stamp}`;

const browser = await chromium.launch();
let bizId, ownerUserId;
const cleanupSessionIds = [];

try {
  const { data: owner } = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin.from("businesses").insert({ name: bizName, assistant_name: "Sage" }).select("id").single();
  bizId = biz.id;
  await admin.from("business_users").insert({ business_id: bizId, email: ownerEmail, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  // --- Visitor starts a brand-new conversation -- NEVER reloaded, on purpose ---
  const visitorPage = await browser.newPage();
  const audioCalls = [];
  await visitorPage.exposeFunction("__recordAudioCall", () => audioCalls.push(Date.now()));
  await visitorPage.addInitScript(() => {
    const OrigCtx = window.AudioContext;
    window.AudioContext = class extends OrigCtx {
      constructor(...args) {
        super(...args);
        window.__recordAudioCall();
      }
    };
  });
  const pageErrors = [];
  visitorPage.on("pageerror", (err) => pageErrors.push(err.message));

  await visitorPage.goto(`${BASE_URL}/widget/${bizId}`);
  await visitorPage.waitForLoadState("networkidle");
  await visitorPage.getByRole("button", { name: "Open chat" }).click();
  await visitorPage.getByPlaceholder("Your name").fill("Jordan Lee");
  await visitorPage.getByPlaceholder("Your email").fill(`jordan-${stamp}@mailinator.com`);
  await visitorPage.getByPlaceholder("How can we help?").fill("Hi, I have a question about your pricing.");
  const introSentAt = Date.now();
  await visitorPage.getByRole("button", { name: "Start chat" }).click();

  // --- Issue #3: can the visitor type/send a follow-up while the AI is still replying? ---
  const inputDisabledWhileSending = await visitorPage.getByPlaceholder("Type a message...").isDisabled().catch(() => null);
  check(
    "the message input is NOT disabled while the AI is still replying to the previous message",
    inputDisabledWhileSending === false,
    `isDisabled() returned: ${inputDisabledWhileSending}`
  );
  // Type and send a follow-up immediately -- should queue, not be dropped.
  await visitorPage.getByPlaceholder("Type a message...").fill("Also, do you offer discounts for non-profits?");
  await visitorPage.getByRole("button", { name: "Send" }).click();
  await sleep(20000); // let both AI turns fully resolve (each is a real Claude + Voyage call)

  const { data: lead } = await admin.from("leads").select("session_id").eq("business_id", bizId).single();
  const sessionId = lead.session_id;
  cleanupSessionIds.push(sessionId);

  const { data: visitorMessages } = await admin
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .eq("role", "visitor")
    .order("created_at", { ascending: true });
  check(
    "the queued follow-up message actually got sent (not dropped) while typed during the AI's reply",
    visitorMessages?.some((m) => m.content.includes("non-profits")),
    JSON.stringify(visitorMessages?.map((m) => m.content))
  );

  // --- Issue #4: conversations list shows this as unread before the owner ever opens it ---
  const ownerPage = await browser.newPage();
  await ownerPage.goto(`${BASE_URL}/login`);
  await ownerPage.fill('input[name="email"]', ownerEmail);
  await ownerPage.fill('input[name="password"]', password);
  await ownerPage.click('button[type="submit"]');
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.goto(`${BASE_URL}/dashboard/conversations`);
  await ownerPage.waitForLoadState("networkidle");
  const listHtmlBefore = await ownerPage.content();
  check(
    "conversations list shows an unread indicator before the owner has opened this conversation",
    listHtmlBefore.includes('aria-label="Unread"'),
    listHtmlBefore.includes('aria-label="Unread"') ? "found" : "not found"
  );

  await ownerPage.goto(`${BASE_URL}/dashboard/conversations/${sessionId}`);
  await ownerPage.waitForLoadState("networkidle");
  await sleep(1500); // let the markConversationSeen effect's server action land
  await ownerPage.goto(`${BASE_URL}/dashboard/conversations`);
  await ownerPage.waitForLoadState("networkidle");
  const listHtmlAfter = await ownerPage.content();
  check(
    "unread indicator clears after the owner actually opens the conversation",
    !listHtmlAfter.includes('aria-label="Unread"'),
    listHtmlAfter.includes('aria-label="Unread"') ? "still present" : "cleared"
  );

  // --- Owner takes over and replies -- back on the SAME conversation page ---
  await ownerPage.goto(`${BASE_URL}/dashboard/conversations/${sessionId}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.getByRole("button", { name: "Take over" }).click();
  await sleep(2000);

  const replyText = "Hi Jordan, yes -- we offer 30% off for registered non-profits!";
  const sendClickedAt = Date.now();
  await ownerPage.getByPlaceholder("Reply as yourself...").fill(replyText);
  await ownerPage.getByRole("button", { name: "Send" }).click();
  await ownerPage.waitForFunction((text) => document.body.innerText.includes(text), replyText, { timeout: 5000 });
  const bubbleDelayMs = Date.now() - sendClickedAt;
  check(
    `issue #2 -- the admin's own reply appears near-instantly, not after a multi-second delay (${bubbleDelayMs}ms)`,
    bubbleDelayMs < 1000,
    `${bubbleDelayMs}ms`
  );

  // --- Issue #1 -- does the VISITOR'S page (still open the whole time, NEVER reloaded) pick it up? ---
  await sleep(9000); // widget polls every 4s; give it two ticks
  const visitorText = await visitorPage.evaluate(() => document.body.innerText);
  check(
    "issue #1 -- the visitor's page (never reloaded) shows the human's reply via polling alone",
    visitorText.includes(replyText),
    visitorText.slice(-300)
  );

  // --- Issue #5 -- a notification sound actually fired for that reply ---
  check(
    "issue #5 -- a notification sound (AudioContext) was triggered when the reply arrived via polling",
    audioCalls.length > 0,
    `AudioContext constructed ${audioCalls.length} time(s)`
  );

  check("no uncaught client-side JS errors on the visitor's page throughout", pageErrors.length === 0, JSON.stringify(pageErrors));
} finally {
  await browser.close();
  for (const sid of cleanupSessionIds.filter(Boolean)) {
    await admin.from("chat_messages").delete().eq("session_id", sid);
    await admin.from("leads").delete().eq("session_id", sid);
    await admin.from("chat_sessions").delete().eq("id", sid);
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
  console.error("CHAT FIXES VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: all five reported issues are fixed.");
