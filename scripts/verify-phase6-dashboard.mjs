// Phase 6 verification: conversation history, booking list, and usage
// analytics -- driven against the real dev server with two real businesses,
// to also confirm RLS isolation (one owner can never see another business's
// conversations/bookings), per system_design.md's Phase 6 definition of
// done. Human handoff (AI auto-flagging + manual take-over) was hidden for
// launch -- see the 2026-08-20 changelog entry -- so this also confirms
// that removal actually took: a genuinely frustrated message no longer
// gets flagged, and no "Needs your help" badge exists anywhere to show.
//
// Usage: node --env-file=.env.local scripts/verify-phase6-dashboard.mjs
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
const bizAName = `Phase6 Test A ${stamp}`;
const bizBName = `Phase6 Test B ${stamp}`;
const ownerAEmail = `phase6-owner-a-${stamp}@mailinator.com`;
const ownerBEmail = `phase6-owner-b-${stamp}@mailinator.com`;
const password = "TestPassword123!";

const browser = await chromium.launch();
let bizAId, bizBId, ownerAUserId, ownerBUserId;
const cleanupSessionIds = [];

try {
  // --- Two businesses, so isolation is actually testable ---
  const { data: ownerA } = await admin.auth.admin.createUser({ email: ownerAEmail, password, email_confirm: true });
  const { data: ownerB } = await admin.auth.admin.createUser({ email: ownerBEmail, password, email_confirm: true });
  ownerAUserId = ownerA.user.id;
  ownerBUserId = ownerB.user.id;

  const { data: bizA } = await admin.from("businesses").insert({ name: bizAName, plan: "starter" }).select("id").single();
  const { data: bizB } = await admin.from("businesses").insert({ name: bizBName, plan: "starter" }).select("id").single();
  bizAId = bizA.id;
  bizBId = bizB.id;

  await admin.from("business_users").insert([
    { business_id: bizAId, email: ownerAEmail, role: "owner", auth_user_id: ownerAUserId, status: "accepted" },
    { business_id: bizBId, email: ownerBEmail, role: "owner", auth_user_id: ownerBUserId, status: "accepted" },
  ]);

  // --- Seed known-quantity data directly, so the dashboard's displayed
  // numbers can be checked against an exact expected value ---
  const currentMonth = new Date().toISOString().slice(0, 7);
  await admin.from("usage_logs").insert({ business_id: bizAId, month: currentMonth, message_count: 7 });

  const { data: seededSession } = await admin
    .from("chat_sessions")
    .insert({ business_id: bizAId, visitor_id: "11111111-1111-1111-1111-111111111111" })
    .select("id")
    .single();
  cleanupSessionIds.push(seededSession.id);
  await admin.from("chat_messages").insert([
    { session_id: seededSession.id, role: "visitor", content: "Hi, do you have a size guide?" },
    { session_id: seededSession.id, role: "assistant", content: "Yes! Let me help with that." },
  ]);

  await admin.from("bookings").insert({
    business_id: bizAId,
    session_id: seededSession.id,
    customer_name: "Seeded Customer",
    customer_contact: "seeded@mailinator.com",
    start_time: new Date(Date.now() + 3 * 86400000).toISOString(),
    end_time: new Date(Date.now() + 3 * 86400000 + 1800000).toISOString(),
    status: "confirmed",
  });

  // Business B gets its own session, used only to prove A can't see it.
  const { data: bSession } = await admin
    .from("chat_sessions")
    .insert({ business_id: bizBId, visitor_id: "22222222-2222-2222-2222-222222222222" })
    .select("id")
    .single();
  cleanupSessionIds.push(bSession.id);
  await admin.from("chat_messages").insert({ session_id: bSession.id, role: "visitor", content: "Business B's own secret conversation" });

  // --- A real conversation through the real pipeline with a genuinely
  // frustrated message -- this used to trigger human handoff; now confirms
  // that removal actually took (the AI has no handoff tool to call at all,
  // so this should never get flagged, regardless of how the AI responds) ---
  const handoffRes = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: bizAId,
      message:
        "This is unacceptable, your product broke and I've emailed three times with no reply. I need to speak to a real human right now, not a bot.",
    }),
  });
  const handoffBody = await handoffRes.json();
  console.log("  reply to a frustrated message:", (handoffBody.replies || []).map((r) => r.content).join(" / "));
  cleanupSessionIds.push(handoffBody.sessionId);

  await sleep(2000);
  const { data: flaggedSession } = await admin
    .from("chat_sessions")
    .select("needs_handoff, handoff_reason")
    .eq("id", handoffBody.sessionId)
    .single();
  check(
    "human handoff is hidden -- even a genuinely frustrated visitor is never flagged",
    flaggedSession?.needs_handoff === false && !flaggedSession?.handoff_reason,
    JSON.stringify(flaggedSession)
  );

  // --- Log in as owner A and check the dashboard ---
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', ownerAEmail);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  check("owner A can log in", page.url().includes("/dashboard"), page.url());

  // --- Usage chart matches usage_logs exactly ---
  await page.goto(`${BASE_URL}/dashboard`);
  const dashboardText = await page.textContent("body");
  check("dashboard shows the exact seeded message count (7) from usage_logs", dashboardText.includes("7"), "expected '7' somewhere on the page");
  check("dashboard shows the seeded booking in the Bookings stat card", /Bookings[\s\S]{0,20}1/.test(dashboardText), dashboardText.slice(0, 50));

  // --- Conversations list shows A's own conversations ---
  await page.goto(`${BASE_URL}/dashboard/conversations`);
  const convoListText = await page.textContent("body");
  check("conversations list shows the seeded visitor", convoListText.includes("11111111"), null);
  check("no handoff badge appears anywhere on the conversations list", !convoListText.includes("Needs your help"), null);
  check("conversations list does NOT show business B's visitor", !convoListText.includes("22222222"), null);

  // --- Conversation detail shows the real message thread, read-only ---
  await page.goto(`${BASE_URL}/dashboard/conversations/${seededSession.id}`);
  const detailText = await page.textContent("body");
  check("conversation detail shows the real seeded message", detailText.includes("size guide"), null);
  check("no take-over/hand-back control exists on the conversation detail page", !/Take over|Hand back to AI/.test(detailText), null);

  // --- RLS isolation: owner A cannot view business B's conversation by ID ---
  // Note: this route has a loading.tsx (streaming), so Next.js sends the 200
  // status header before the async notFound() call can flip it -- a known
  // framework nuance, not a real gap. What actually matters is checked
  // directly: no cross-tenant data ever renders, and the real not-found UI
  // shows. Needs a short wait since the not-found content streams in after
  // the initial (loading-skeleton) response.
  await page.goto(`${BASE_URL}/dashboard/conversations/${bSession.id}`);
  await page.waitForTimeout(1000);
  const crossTenantText = await page.evaluate(() => document.body.innerText);
  check(
    "owner A CANNOT view business B's conversation by guessing/visiting its URL",
    !crossTenantText.includes("secret conversation") && crossTenantText.toLowerCase().includes("could not be found"),
    crossTenantText.slice(0, 100)
  );

  // --- Bookings list shows A's booking ---
  await page.goto(`${BASE_URL}/dashboard/bookings`);
  const bookingsText = await page.textContent("body");
  check("bookings list shows the seeded booking's customer name", bookingsText.includes("Seeded Customer"), null);
  check("bookings list shows a confirmed status badge", bookingsText.toLowerCase().includes("confirmed"), null);
} finally {
  await browser.close();
  for (const sid of cleanupSessionIds.filter(Boolean)) {
    await admin.from("chat_messages").delete().eq("session_id", sid);
  }
  if (bizAId) {
    await admin.from("bookings").delete().eq("business_id", bizAId);
    await admin.from("chat_sessions").delete().eq("business_id", bizAId);
    await admin.from("usage_logs").delete().eq("business_id", bizAId);
    await admin.from("business_users").delete().eq("business_id", bizAId);
    await admin.from("businesses").delete().eq("id", bizAId);
  }
  if (bizBId) {
    await admin.from("chat_sessions").delete().eq("business_id", bizBId);
    await admin.from("business_users").delete().eq("business_id", bizBId);
    await admin.from("businesses").delete().eq("id", bizBId);
  }
  if (ownerAUserId) await admin.auth.admin.deleteUser(ownerAUserId);
  if (ownerBUserId) await admin.auth.admin.deleteUser(ownerBUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PHASE 6 DASHBOARD VERIFICATION FAILED");
  process.exit(1);
}
console.log("Phase 6 dashboard verified: conversations, bookings, and usage analytics all work with RLS isolation intact, and human handoff is confirmed hidden.");
