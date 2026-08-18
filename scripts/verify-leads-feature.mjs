// Verifies lead capture end-to-end: a real widget conversation through the
// real intake form, real AI reply, the lead actually saved and visible on
// the dashboard, RLS isolation, personalization on a later turn, and that a
// returning visitor (existing session) skips the intake form.
//
// Usage: node --env-file=.env.local scripts/verify-leads-feature.mjs
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
const bizAName = `Leads Test A ${stamp}`;
const bizBName = `Leads Test B ${stamp}`;
const ownerAEmail = `leads-owner-a-${stamp}@mailinator.com`;
const ownerBEmail = `leads-owner-b-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const visitorName = "Priya Sharma";
const visitorEmail = `priya-${stamp}@mailinator.com`;
const visitorMessage = "Hi, do you offer weekend appointments?";

const browser = await chromium.launch();
let bizAId, bizBId, ownerAUserId, ownerBUserId;
const cleanupSessionIds = [];

try {
  const { data: ownerA } = await admin.auth.admin.createUser({ email: ownerAEmail, password, email_confirm: true });
  const { data: ownerB } = await admin.auth.admin.createUser({ email: ownerBEmail, password, email_confirm: true });
  ownerAUserId = ownerA.user.id;
  ownerBUserId = ownerB.user.id;

  const { data: bizA } = await admin.from("businesses").insert({ name: bizAName, assistant_name: "Riley" }).select("id").single();
  const { data: bizB } = await admin.from("businesses").insert({ name: bizBName }).select("id").single();
  bizAId = bizA.id;
  bizBId = bizB.id;

  await admin.from("business_users").insert([
    { business_id: bizAId, email: ownerAEmail, role: "owner", auth_user_id: ownerAUserId, status: "accepted" },
    { business_id: bizBId, email: ownerBEmail, role: "owner", auth_user_id: ownerBUserId, status: "accepted" },
  ]);

  // --- A real widget conversation through the intake form ---
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/widget/${bizAId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open chat" }).click();

  await page.getByPlaceholder("Your name").fill(visitorName);
  await page.getByPlaceholder("Your email").fill(visitorEmail);
  await page.getByPlaceholder("How can we help?").fill(visitorMessage);
  await page.getByRole("button", { name: "Start chat" }).click();
  await page.waitForTimeout(9000); // real Claude + Voyage round trip, plus dev-mode first-hit compile latency

  const bodyText = await page.evaluate(() => document.body.innerText);
  check("the visitor's own message appears in the chat after submitting the intake form", bodyText.includes(visitorMessage), null);

  const { data: lead } = await admin.from("leads").select("*").eq("business_id", bizAId).eq("email", visitorEmail).single();
  check("a lead row was created with the right name/email/message", lead?.name === visitorName && lead?.email === visitorEmail && lead?.message === visitorMessage, JSON.stringify(lead));
  check("the lead is linked to a real chat_session", !!lead?.session_id, lead?.session_id);
  if (lead?.session_id) cleanupSessionIds.push(lead.session_id);

  const { data: session } = await admin.from("chat_sessions").select("id").eq("id", lead.session_id).eq("business_id", bizAId).maybeSingle();
  check("that session genuinely belongs to business A", !!session, JSON.stringify(session));

  // --- A second message on the same session: does the AI still know the name? ---
  await page.getByPlaceholder("Type a message...").fill("What's my name again?");
  await page.getByRole("button", { name: "Send" }).click();
  await sleep(9000);
  const laterText = await page.evaluate(() => document.body.innerText);
  check(
    "the AI still knows the visitor's name on a LATER turn (not just the first)",
    laterText.toLowerCase().includes("priya"),
    laterText.slice(-300)
  );

  await browser.close();

  // --- RLS: owner A sees the lead on the dashboard, owner B does not ---
  const pageA = await (await chromium.launch()).newPage();
  await pageA.goto(`${BASE_URL}/login`);
  await pageA.fill('input[name="email"]', ownerAEmail);
  await pageA.fill('input[name="password"]', password);
  await pageA.click('button[type="submit"]');
  await pageA.waitForLoadState("networkidle");
  await pageA.goto(`${BASE_URL}/dashboard/leads`);
  const aText = await pageA.textContent("body");
  check("business A's owner sees the lead on the Leads page", aText.includes(visitorName) && aText.includes(visitorEmail), null);
  await pageA.context().browser().close();

  const pageB = await (await chromium.launch()).newPage();
  await pageB.goto(`${BASE_URL}/login`);
  await pageB.fill('input[name="email"]', ownerBEmail);
  await pageB.fill('input[name="password"]', password);
  await pageB.click('button[type="submit"]');
  await pageB.waitForLoadState("networkidle");
  await pageB.goto(`${BASE_URL}/dashboard/leads`);
  const bText = await pageB.textContent("body");
  check("business B's owner does NOT see business A's lead", !bText.includes(visitorEmail), null);
  await pageB.context().browser().close();

  // --- Returning visitor (existing session) skips the intake form ---
  const returningBrowser = await chromium.launch();
  const returningContext = await returningBrowser.newContext({ storageState: undefined });
  const returningPage = await returningContext.newPage();
  await returningPage.goto(`${BASE_URL}/widget/${bizAId}`);
  await returningPage.evaluate(
    ([sid, vid]) => {
      localStorage.setItem(`chatx_session_${sid.bizId}`, sid.sessionId);
      localStorage.setItem(`chatx_visitor_${vid.bizId}`, vid.visitorId);
    },
    [
      { bizId: bizAId, sessionId: lead.session_id },
      { bizId: bizAId, visitorId: "test-visitor-id" },
    ]
  );
  await returningPage.reload();
  await returningPage.waitForLoadState("networkidle");
  await returningPage.getByRole("button", { name: "Open chat" }).click();
  await returningPage.waitForTimeout(500);
  const returningVisible = await returningPage.evaluate(() => !!document.querySelector('input[placeholder="Type a message..."]'));
  check("a returning visitor (existing session) skips the intake form and sees the chat panel directly", returningVisible, null);
  await returningBrowser.close();
} finally {
  for (const sid of cleanupSessionIds.filter(Boolean)) {
    await admin.from("chat_messages").delete().eq("session_id", sid);
    await admin.from("leads").delete().eq("session_id", sid);
    await admin.from("chat_sessions").delete().eq("id", sid);
  }
  if (bizAId) {
    await admin.from("business_users").delete().eq("business_id", bizAId);
    await admin.from("businesses").delete().eq("id", bizAId);
  }
  if (bizBId) {
    await admin.from("business_users").delete().eq("business_id", bizBId);
    await admin.from("businesses").delete().eq("id", bizBId);
  }
  if (ownerAUserId) await admin.auth.admin.deleteUser(ownerAUserId);
  if (ownerBUserId) await admin.auth.admin.deleteUser(ownerBUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("LEADS FEATURE VERIFICATION FAILED");
  process.exit(1);
}
console.log("Leads feature verified end-to-end: intake form, real save, AI personalization, RLS isolation, returning-visitor skip.");
