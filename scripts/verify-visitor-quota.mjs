// Verifies the plan quota is now based on distinct visitors per month, not
// total messages: the same visitor can send many messages without using up
// the plan's quota, a new/different visitor consumes one slot, the cap
// blocks only once the visitor count is reached (existing visitors are
// never blocked), Pro (unlimited) never blocks, and invoice.paid's reset
// clears both the counter and the "seen" set together.
//
// Usage: node --env-file=.env.local scripts/verify-visitor-quota.mjs

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail !== undefined ? ` (${detail})` : ""}`);
}

const stamp = Date.now();
const month = new Date().toISOString().slice(0, 7);
const bizIds = [];

async function makeBusiness(plan) {
  const { data: biz } = await admin.from("businesses").insert({ name: `Visitor Quota ${plan} ${stamp}`, plan }).select("id").single();
  bizIds.push(biz.id);
  return biz.id;
}

async function consume(bizId, visitorId) {
  const { data, error } = await admin.rpc("try_consume_message_quota", { p_business_id: bizId, p_visitor_id: visitorId });
  if (error) throw error;
  return data;
}

try {
  // --- Free plan (limit: 20 visitors) ---
  const freeBiz = await makeBusiness("free");

  // Same visitor sending many messages should never be blocked and should
  // only ever count as ONE visitor.
  const sameVisitor = `same-visitor-${stamp}`;
  let allSameVisitorAllowed = true;
  for (let i = 0; i < 25; i++) {
    const allowed = await consume(freeBiz, sameVisitor);
    if (!allowed) allSameVisitorAllowed = false;
  }
  check("free plan: one visitor sending 25 messages is never blocked", allSameVisitorAllowed);

  const { data: afterSameVisitor } = await admin.from("usage_logs").select("message_count, visitor_count").eq("business_id", freeBiz).eq("month", month).single();
  check(
    "free plan: 25 messages from one visitor counts as 1 visitor, 25 messages",
    afterSameVisitor.visitor_count === 1 && afterSameVisitor.message_count === 25,
    JSON.stringify(afterSameVisitor)
  );

  // 19 more NEW distinct visitors (20 total including the one above) should
  // all be allowed -- exactly at the free plan's cap.
  let newVisitorsAllowed = 0;
  for (let i = 0; i < 19; i++) {
    const allowed = await consume(freeBiz, `new-visitor-${stamp}-${i}`);
    if (allowed) newVisitorsAllowed++;
  }
  check("free plan: 19 more new distinct visitors (20 total) are all allowed", newVisitorsAllowed === 19, `${newVisitorsAllowed}/19`);

  // The 21st distinct visitor this month should be blocked.
  const blockedVisitor = `blocked-visitor-${stamp}`;
  const blockedResult = await consume(freeBiz, blockedVisitor);
  check("free plan: a 21st new distinct visitor is blocked", blockedResult === false);

  // An already-counted visitor (the very first one) sending another message
  // must still be allowed, even though the business is at its cap.
  const stillAllowed = await consume(freeBiz, sameVisitor);
  check("free plan: an already-counted visitor is still allowed after the cap is hit", stillAllowed === true);

  const { data: finalFreeUsage } = await admin.from("usage_logs").select("message_count, visitor_count").eq("business_id", freeBiz).eq("month", month).single();
  check("free plan: final visitor_count is exactly 20 (cap reached, not exceeded)", finalFreeUsage.visitor_count === 20, JSON.stringify(finalFreeUsage));

  // --- Pro plan (unlimited) ---
  const proBiz = await makeBusiness("pro");
  let allProAllowed = true;
  for (let i = 0; i < 25; i++) {
    const allowed = await consume(proBiz, `pro-visitor-${stamp}-${i}`);
    if (!allowed) allProAllowed = false;
  }
  check("pro plan: 25 different visitors are all allowed (unlimited)", allProAllowed);

  // --- invoice.paid reset behavior ---
  const resetBiz = await makeBusiness("free");
  const resetVisitor = `reset-visitor-${stamp}`;
  await consume(resetBiz, resetVisitor);
  const { data: beforeReset } = await admin.from("usage_logs").select("visitor_count").eq("business_id", resetBiz).eq("month", month).single();
  check("reset test: visitor_count is 1 before reset", beforeReset.visitor_count === 1);

  // Mirrors exactly what the invoice.paid webhook handler does.
  await admin.from("usage_logs").upsert({ business_id: resetBiz, month, message_count: 0, visitor_count: 0 }, { onConflict: "business_id,month" });
  await admin.from("monthly_active_visitors").delete().eq("business_id", resetBiz).eq("month", month);

  const { data: afterReset } = await admin.from("usage_logs").select("visitor_count, message_count").eq("business_id", resetBiz).eq("month", month).single();
  check("reset test: visitor_count and message_count both back to 0 after reset", afterReset.visitor_count === 0 && afterReset.message_count === 0);

  // The same visitor who already chatted before the reset should count as
  // NEW again after the reset (the "seen" set was cleared too).
  const { data: seenAfterReset } = await admin
    .from("monthly_active_visitors")
    .select("visitor_id")
    .eq("business_id", resetBiz)
    .eq("month", month)
    .eq("visitor_id", resetVisitor);
  check("reset test: the previously-seen visitor is no longer in the seen set", (seenAfterReset ?? []).length === 0);

  const allowedAfterReset = await consume(resetBiz, resetVisitor);
  const { data: afterResetConsume } = await admin.from("usage_logs").select("visitor_count").eq("business_id", resetBiz).eq("month", month).single();
  check(
    "reset test: that visitor messaging again after reset is allowed and counts as visitor #1 again",
    allowedAfterReset === true && afterResetConsume.visitor_count === 1
  );
} finally {
  for (const bizId of bizIds) {
    await admin.from("monthly_active_visitors").delete().eq("business_id", bizId);
    await admin.from("usage_logs").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("VISITOR QUOTA VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: quota is now based on distinct visitors per month, not total messages.");
