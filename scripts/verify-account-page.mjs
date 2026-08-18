// Verifies the new Account page: display name, avatar photo, and password
// change, all against the real running app -- including logging back in
// with the NEW password afterward, since a password change that "saves" but
// doesn't actually let you log in with it would be a false positive.
//
// Usage: node --env-file=.env.local scripts/verify-account-page.mjs
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
const email = `account-test-${stamp}@mailinator.com`;
const originalPassword = "OriginalPass123!";
const newPassword = "NewPassword456!";
const bizName = `Account Test Co ${stamp}`;

const browser = await chromium.launch();
let ownerUserId, bizId;

try {
  const { data: owner } = await admin.auth.admin.createUser({ email, password: originalPassword, email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin.from("businesses").insert({ name: bizName }).select("id").single();
  bizId = biz.id;
  await admin.from("business_users").insert({ business_id: bizId, email, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', originalPassword);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  check("logged in with original password", page.url().includes("/dashboard"), page.url());

  // --- Update display name ---
  await page.goto(`${BASE_URL}/dashboard/account`);
  await page.fill('input[name="displayName"]', "Jamie Rivera");
  await page.click('button:has-text("Save name")');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(4000); // the confirmation banner is a client component reading useSearchParams(), which lags slightly behind the redirect itself
  const afterNameText = await page.textContent("body");
  check("display name save confirmation shown", afterNameText.includes("Name saved"), null);

  // Header avatar should now reflect the new name's initials ("JR")
  const headerText = await page.textContent("header");
  check("header shows initials derived from the new display name (JR)", headerText.includes("JR"), headerText.slice(0, 80));

  // --- Upload avatar photo ---
  await page.setInputFiles('input[name="photo"]', {
    name: "avatar.png",
    mimeType: "image/png",
    // Smallest valid 1x1 PNG
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ),
  });
  await page.click('button:has-text("Upload photo")');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(4000);
  const afterPhotoText = await page.textContent("body");
  check("photo save confirmation shown", afterPhotoText.includes("Photo saved"), null);

  const { data: userAfterPhoto } = await admin.auth.admin.getUserById(ownerUserId);
  check(
    "avatar_url actually saved to the auth user's metadata",
    !!userAfterPhoto.user.user_metadata?.avatar_url,
    userAfterPhoto.user.user_metadata?.avatar_url
  );

  // --- Change password ---
  await page.fill('input[name="newPassword"]', newPassword);
  await page.fill('input[name="confirmPassword"]', newPassword);
  await page.click('button:has-text("Update password")');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(4000);
  const afterPasswordText = await page.textContent("body");
  check("password update confirmation shown", afterPasswordText.includes("Password updated"), null);

  // --- Real proof: log out, log back in with the NEW password ---
  await page.click('button:has-text("Log out")');
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', newPassword);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  check("logging in with the NEW password actually works", page.url().includes("/dashboard"), page.url());

  // Old password should no longer work
  await page.click('button:has-text("Log out")').catch(() => {});
  await page.waitForTimeout(500);
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', originalPassword);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  check("the OLD password no longer works", !page.url().includes("/dashboard"), page.url());
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
  console.error("ACCOUNT PAGE VERIFICATION FAILED");
  process.exit(1);
}
console.log("Account page verified: name, photo, and password changes all genuinely work.");
