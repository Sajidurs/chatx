// Verifies that chat history survives a real page refresh on the embed
// widget (it used to always start blank even though the session persisted
// server-side -- see CHANGELOG 2026-08-18/19).
//
// This used to also verify human takeover end-to-end in the same script
// (hence the old filename, verify-takeover-and-history.mjs) -- that feature
// was hidden for launch (CHANGELOG 2026-08-20, "we will add these later if
// needed"), so those checks were removed rather than left failing against a
// UI that no longer exists. This still covers the history-on-refresh fix,
// which is unrelated to takeover and remains fully active.
//
// Usage: node --env-file=.env.local scripts/verify-widget-history-refresh.mjs
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
const bizName = `History Refresh Test Co ${stamp}`;

const browser = await chromium.launch();
let bizId;
const cleanupSessionIds = [];

try {
  const { data: biz } = await admin.from("businesses").insert({ name: bizName, assistant_name: "Sage" }).select("id").single();
  bizId = biz.id;

  // --- A real visitor conversation via the intake form ---
  const visitorPage = await browser.newPage();
  await visitorPage.goto(`${BASE_URL}/widget/${bizId}`);
  await visitorPage.waitForLoadState("networkidle");
  // next dev/Turbopack lazily (re)compiles a route on its first hit after
  // being idle, and pushes an HMR "Fast Refresh" to the page when it does --
  // if that lands while the intake form's /api/chat request is in flight, it
  // can drop that request's continuation entirely (confirmed directly).
  // Production has no on-demand compilation or HMR at all, so this is
  // purely a dev-server test artifact -- letting it settle here avoids it.
  await sleep(4000);
  await visitorPage.getByRole("button", { name: "Open chat" }).click();
  await visitorPage.getByPlaceholder("Your name").fill("Chris Diaz");
  await visitorPage.getByPlaceholder("Your email").fill(`chris-${stamp}@mailinator.com`);
  await visitorPage.getByPlaceholder("How can we help?").fill("I need help with a refund on my last order.");
  await visitorPage.getByRole("button", { name: "Start chat" }).click();
  // A fixed wait here raced the real Claude+Voyage round trip -- poll for
  // the actual DB effect instead of guessing a duration.
  let lead = null;
  for (let i = 0; i < 20 && !lead; i++) {
    await sleep(1000);
    ({ data: lead } = await admin.from("leads").select("session_id").eq("business_id", bizId).maybeSingle());
  }
  if (!lead) throw new Error("Lead was never created -- the intake form submission itself failed.");
  const sessionId = lead.session_id;
  cleanupSessionIds.push(sessionId);
  // The leads row is written early in the same request the widget is still
  // awaiting -- give the client's own fetch a moment to actually resolve
  // and write localStorage before reloading out from under it.
  await sleep(2000);

  // --- Refresh check: does the visible history survive a real reload? ---
  await visitorPage.reload();
  await visitorPage.waitForLoadState("networkidle");
  await visitorPage.waitForTimeout(1500); // let the localStorage-driven history fetch resolve before interacting
  await visitorPage.getByRole("button", { name: "Open chat" }).click();
  await visitorPage.waitForTimeout(2000);
  const afterReloadText = await visitorPage.evaluate(() => document.body.innerText);
  check(
    "chat history is still visible after a real page refresh (was blank before this fix)",
    afterReloadText.includes("I need help with a refund"),
    afterReloadText.slice(0, 200)
  );
} finally {
  await browser.close();
  for (const sid of cleanupSessionIds.filter(Boolean)) {
    await admin.from("chat_messages").delete().eq("session_id", sid);
    await admin.from("leads").delete().eq("session_id", sid);
    await admin.from("chat_sessions").delete().eq("id", sid);
  }
  if (bizId) {
    await admin.from("businesses").delete().eq("id", bizId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("HISTORY REFRESH VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: chat history survives a real page refresh.");
