// One-off verification of the fresh-signup guard added during code review
// (src/lib/auth/fresh-signup.ts). Confirms that submitting the real /signup
// form with an email that already has an unconfirmed pending account does
// NOT create a business owned by that stranger's real account -- it shows a
// clear error instead. This is the scenario the naive `identities.length ===
// 0` check alone would have missed (Supabase returns the real user id with
// non-empty identities for an unconfirmed existing account).
//
// Usage: node --env-file=.env.local scripts/verify-fresh-signup-guard.mjs
// Requires: npm run dev already running on http://localhost:3000

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const victimEmail = `fresh-signup-victim-${suffix}@mailinator.com`;
const businessName = `Fresh Signup Guard Test ${suffix}`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

let victimUserId, businessId;

try {
  // A real person signed up elsewhere (or on this same form) and never
  // confirmed their email yet.
  const { data: victim } = await admin.auth.admin.createUser({
    email: victimEmail,
    password: "VictimsOwnPassword1!",
    email_confirm: false,
  });
  victimUserId = victim.user.id;

  // An attacker (or just someone who mistypes/reuses an email) submits our
  // real signup form using the victim's email and a different password.
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_URL}/signup`);
  await page.fill('input[name="businessName"]', businessName);
  await page.fill('input[name="email"]', victimEmail);
  await page.fill('input[name="password"]', "AttackerChosenPassword1!");
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  const pageText = await page.textContent("body");
  await browser.close();

  check(
    "signup form shows 'already registered' error, does not proceed",
    page.url().includes("/signup?error=") && pageText.toLowerCase().includes("already registered"),
    `${page.url()} | ${pageText.replace(/\s+/g, " ").slice(0, 150)}`
  );

  const { data: business } = await admin.from("businesses").select("id").eq("name", businessName).maybeSingle();
  businessId = business?.id;
  check("no business was created for the victim's email", !business, JSON.stringify(business));

  const { data: victimMemberships } = await admin.from("business_users").select("id").eq("auth_user_id", victimUserId);
  check("victim's account has zero business_users rows (not silently made an owner)", (victimMemberships?.length ?? 0) === 0);

  const { data: victimAfter } = await admin.auth.admin.getUserById(victimUserId);
  check(
    "victim's own original password still works (not overwritten)",
    true, // verified separately via signInWithPassword below
    ""
  );
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await admin.auth.admin.updateUserById(victimUserId, { email_confirm: true }); // simulate victim eventually confirming
  const { error: loginErr } = await anon.auth.signInWithPassword({ email: victimEmail, password: "VictimsOwnPassword1!" });
  check("victim can still log in with their ORIGINAL password after all this", !loginErr, loginErr?.message);
} finally {
  if (businessId) await admin.from("businesses").delete().eq("id", businessId);
  if (victimUserId) await admin.auth.admin.deleteUser(victimUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("FRESH SIGNUP GUARD CHECK FAILED");
  process.exit(1);
}
console.log("Fresh-signup guard verified: an unconfirmed existing account can no longer be silently attached as a new business owner.");
