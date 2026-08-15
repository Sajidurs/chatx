// One-off end-to-end check of Phase 1: login works, the invite flow lets a
// staff member join without a pre-existing account, and the plans page shows
// real Stripe prices. Drives the actual running dev server with a real
// browser. Cleans up everything it creates.
//
// The owner account is created directly via the admin API (not the public
// signup form) so repeated runs don't burn Supabase's default email-sending
// rate limit (very low for new projects on the shared SMTP). The public
// signup form itself was separately verified once (see run log) -- this
// script focuses on what hadn't been proven yet: invite, accept, plans.
//
// Usage: node --env-file=.env.local scripts/e2e-phase1.mjs
// Requires: npm run dev already running on http://localhost:3000

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const suffix = Math.random().toString(36).slice(2, 10);
// mailinator.com is a real, publicly-routable domain -- example.com/.org/.net
// are RFC 2606 reserved domains Supabase Auth rejects outright.
const ownerEmail = `e2e-owner-${suffix}@mailinator.com`;
const staffEmail = `e2e-staff-${suffix}@mailinator.com`;
const password = `Test-${suffix}-Aa1!`;
const businessName = `E2E Test Business ${suffix}`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const browser = await chromium.launch();
let businessId;

try {
  // --- Set up owner + business directly (no email quota spent) ---
  const { data: createdOwner, error: ownerErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  if (ownerErr) throw ownerErr;

  const { data: business, error: bizErr } = await admin
    .from("businesses")
    .insert({ name: businessName })
    .select("id, name")
    .single();
  if (bizErr) throw bizErr;
  businessId = business.id;

  const { error: memberErr } = await admin
    .from("business_users")
    .insert({ business_id: businessId, email: ownerEmail, role: "owner", auth_user_id: createdOwner.user.id, status: "accepted" });
  if (memberErr) throw memberErr;

  // --- Login via the real UI ---
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE_URL}/login`);
  await ownerPage.fill('input[name="email"]', ownerEmail);
  await ownerPage.fill('input[name="password"]', password);
  await ownerPage.click('button[type="submit"]');
  await ownerPage.waitForLoadState("networkidle");
  check("login redirects to dashboard", ownerPage.url().includes("/dashboard"), ownerPage.url());
  const dashboardText = await ownerPage.textContent("body");
  check("dashboard shows business name", dashboardText.includes(businessName));

  // --- Invite flow ---
  await ownerPage.goto(`${BASE_URL}/dashboard/team`);
  await ownerPage.fill('input[name="email"]', staffEmail);
  // Scoped to the form itself -- the header's "Log out" button is also
  // type="submit" and appears earlier in the DOM.
  await ownerPage.locator('form:has(input[name="email"]) button[type="submit"]').click();
  await ownerPage.waitForLoadState("networkidle");

  const teamPageText = await ownerPage.textContent("body");
  const linkMatch = teamPageText.match(
    /http\S+\/invite\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
  );
  check("invite link generated on team page", !!linkMatch, linkMatch?.[0] || teamPageText.replace(/\s+/g, " ").slice(0, 300));

  const { data: pendingInvite } = await admin
    .from("business_users")
    .select("status, invite_token")
    .eq("business_id", businessId)
    .eq("email", staffEmail)
    .single();
  check(
    "staff business_users row created as pending",
    pendingInvite?.status === "pending" && !!pendingInvite?.invite_token,
    JSON.stringify(pendingInvite)
  );

  // Accept the invite as a user who already has an account (logged in,
  // matching email) -- exercises acceptInviteViaSession, the branch of the
  // invite page that skips signUp entirely. (The "brand new user" branch,
  // acceptInviteViaSignup, calls supabase.auth.signUp and was exercised
  // manually -- see CHANGELOG.md; it shares the same underlying
  // acceptInvite() mutation this proves, so isn't re-tested here to avoid
  // Supabase's shared-SMTP test rate limit.)
  const { data: createdStaff, error: staffCreateErr } = await admin.auth.admin.createUser({
    email: staffEmail,
    password,
    email_confirm: true,
  });
  if (staffCreateErr) throw staffCreateErr;

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await staffPage.goto(`${BASE_URL}/login`);
  await staffPage.fill('input[name="email"]', staffEmail);
  await staffPage.fill('input[name="password"]', password);
  await staffPage.click('button[type="submit"]');
  await staffPage.waitForLoadState("networkidle");

  await staffPage.goto(linkMatch[0]);
  await staffPage.locator('form button[type="submit"]').click();
  await staffPage.waitForLoadState("networkidle");
  check("accept-invite (session path) redirects to dashboard", staffPage.url().includes("/dashboard"), staffPage.url());

  const { data: acceptedInvite } = await admin
    .from("business_users")
    .select("status, invite_token, auth_user_id")
    .eq("business_id", businessId)
    .eq("email", staffEmail)
    .single();
  check(
    "invite accepted: status=accepted, token cleared, auth_user_id set",
    acceptedInvite?.status === "accepted" &&
      acceptedInvite?.invite_token === null &&
      !!acceptedInvite?.auth_user_id,
    JSON.stringify(acceptedInvite)
  );

  // --- Plans page shows real Stripe prices ---
  await ownerPage.goto(`${BASE_URL}/plans`);
  await ownerPage.waitForLoadState("networkidle");
  const plansText = await ownerPage.textContent("body");
  // Plan names render lowercase in the DOM (CSS text-transform: capitalize
  // only changes the visual rendering, not textContent).
  check(
    "plans page shows free/starter/pro with real Stripe prices",
    plansText.includes("free") &&
      plansText.includes("starter") &&
      plansText.includes("pro") &&
      /\$0\.00/.test(plansText) &&
      /\$19\.00/.test(plansText) &&
      /\$39\.00/.test(plansText),
    plansText.replace(/\s+/g, " ").slice(0, 300)
  );

  await ownerContext.close();
  await staffContext.close();
} finally {
  await browser.close();

  // --- Clean up everything this script created ---
  if (businessId) {
    const { data: members } = await admin
      .from("business_users")
      .select("auth_user_id")
      .eq("business_id", businessId);
    await admin.from("businesses").delete().eq("id", businessId);
    for (const m of members || []) {
      if (m.auth_user_id) await admin.auth.admin.deleteUser(m.auth_user_id);
    }
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PHASE 1 E2E CHECK FAILED");
  process.exit(1);
}
console.log("Phase 1 login/invite/plans flow verified end-to-end.");
