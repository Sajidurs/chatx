// Regression check for a real pre-existing bug found while building the
// account page: a page whose Server Component reads `searchParams` AND
// contains an <input type="file"> form silently fails to submit that form
// (zero network request) once the URL already carries an earlier action's
// confirmation query string. Confirmed on both onboarding (this page, since
// Phase 1/2 -- "?saved=persona|prompt|photo") and the new account page.
// Fixed by moving confirmation banners into a client component that reads
// useSearchParams() independently, keeping the page itself free of a
// searchParams prop.
//
// Usage: node --env-file=.env.local scripts/verify-onboarding-photo-fix.mjs
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
const email = `onboarding-fix-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = `Onboarding Fix Co ${stamp}`;

const browser = await chromium.launch();
let ownerUserId, bizId;

try {
  const { data: owner } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin.from("businesses").insert({ name: bizName }).select("id").single();
  bizId = biz.id;
  await admin.from("business_users").insert({ business_id: bizId, email, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");

  // Land on the page with a STALE confirmation query string already
  // present -- exactly the trigger condition for the bug.
  await page.goto(`${BASE_URL}/dashboard/onboarding?saved=persona`);
  await page.waitForLoadState("networkidle");
  check("starts with a stale ?saved= query string present", page.url().includes("saved=persona"), page.url());

  await page.setInputFiles('input[name="photo"]', {
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ),
  });
  await page.click('button:has-text("Upload photo")');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(5000);

  const { data: bizAfter } = await admin.from("businesses").select("assistant_photo_url").eq("id", bizId).single();
  check(
    "photo upload actually ran despite the stale query string (assistant_photo_url set)",
    !!bizAfter.assistant_photo_url,
    bizAfter.assistant_photo_url
  );

  const text = await page.evaluate(() => document.body.innerText);
  check("photo save confirmation shown", text.includes("Photo saved"), null);
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
  console.error("ONBOARDING PHOTO FIX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Onboarding photo upload works correctly even when the URL already carries a stale confirmation query string.");
