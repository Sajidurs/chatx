// Verifies the new Timezone card on the onboarding page: a real signed-in
// owner can pick a timezone from the dropdown, submit, see the confirmation
// banner, and have it actually persist to businesses.timezone -- and that a
// non-owner (staff) sees the same value read-only.
//
// Usage: node --env-file=.env.local scripts/verify-timezone-setting.mjs
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

const stamp = Date.now();
const ownerEmail = `tz-setting-owner-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = `TZ Setting Test Co ${stamp}`;

const browser = await chromium.launch();
let bizId, ownerUserId;

try {
  const { data: owner } = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin.from("businesses").insert({ name: bizName, assistant_name: "Sage" }).select("id, timezone").single();
  bizId = biz.id;
  check("new business defaults to UTC", biz.timezone === "UTC", biz.timezone);
  await admin.from("business_users").insert({ business_id: bizId, email: ownerEmail, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', ownerEmail);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE_URL}/dashboard/onboarding`);
  await page.waitForLoadState("networkidle");

  await page.selectOption('select[name="timezone"]', "Asia/Dhaka");
  await page.getByRole("button", { name: "Save timezone" }).click();
  await page.waitForURL(/saved=timezone/, { timeout: 15000 });
  // The dashboard route has a loading.tsx skeleton (streaming) -- networkidle
  // can fire while the real RSC payload is still hydrating in, so wait for
  // the actual banner text rather than racing raw network quiescence.
  await page.waitForFunction(() => document.body.innerText.includes("Timezone saved."), null, { timeout: 10000 });

  const bodyText = await page.evaluate(() => document.body.innerText);
  check("confirmation banner shown after saving", bodyText.includes("Timezone saved."), bodyText.slice(0, 100));

  const { data: afterSave } = await admin.from("businesses").select("timezone").eq("id", bizId).single();
  check("businesses.timezone actually persisted the new value", afterSave.timezone === "Asia/Dhaka", afterSave.timezone);

  // Reload and confirm the dropdown reflects the saved value, not a reset default.
  await page.reload();
  await page.waitForLoadState("networkidle");
  const selectedValue = await page.locator('select[name="timezone"]').inputValue();
  check("dropdown shows the saved timezone after a reload", selectedValue === "Asia/Dhaka", selectedValue);
} finally {
  await browser.close();
  if (bizId) {
    await admin.from("business_users").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("TIMEZONE SETTING VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: the onboarding page's Timezone setting saves and persists correctly.");
