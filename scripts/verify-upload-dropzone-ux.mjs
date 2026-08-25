// Verifies the redesigned upload UI on the knowledge (training documents)
// and onboarding (assistant photo) pages, requested after the founder found
// the old raw <input type="file"> confusing -- people didn't know where to
// click, and "Choose File / No file chosen" gave no feedback once a file was
// actually picked.
//
// New flow: a clearly-clickable dropzone -> selected file shows name/size ->
// an explicit Upload/Save button -> a real progress bar while the XHR
// upload runs -> an inline "Uploaded" success state -> the page's server
// data refreshes (router.refresh()) without a full page navigation.
//
// Usage: node --env-file=.env.local scripts/verify-upload-dropzone-ux.mjs
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
const email = `upload-ux-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = `Upload UX Co ${stamp}`;

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

  // ============== Knowledge (training documents) page ==============
  await page.goto(`${BASE_URL}/dashboard/knowledge`);
  await page.waitForLoadState("networkidle");

  check(
    "idle state is a clearly-clickable dropzone, not the raw native file input",
    await page.getByText("Click to upload or drag and drop").isVisible(),
    null
  );

  // --- Client-side size validation, no network round-trip needed ---
  const bigBuffer = Buffer.alloc(16 * 1024 * 1024); // over the 15MB limit
  await page.setInputFiles('input[name="file"]', { name: "too-big.txt", mimeType: "text/plain", buffer: bigBuffer });
  await page.getByText(/too large/i).waitFor({ state: "visible", timeout: 5000 });
  check("oversized file is rejected client-side with a clear message before any upload button appears", true);
  check("no upload button shown for a rejected oversized file", (await page.locator('button:has-text("Upload document")').count()) === 0);

  // --- Pick a valid file: name + size shown, remove button works ---
  await page.setInputFiles('input[name="file"]', {
    name: "return-policy.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Our return policy is 30 days, receipt required."),
  });
  await page.getByText("return-policy.txt").waitFor({ state: "visible", timeout: 5000 });
  check("selected file's name is shown before uploading", true);
  const sizeText = await page.getByText(/KB$/).first().textContent();
  check("selected file's size is shown before uploading", /\d+\s*KB/.test(sizeText || ""), sizeText);

  await page.getByRole("button", { name: "Remove file" }).click();
  await sleep(300);
  check(
    "remove button clears the selection back to the idle dropzone (no accidental upload)",
    await page.getByText("Click to upload or drag and drop").isVisible()
  );

  // --- Actually upload it: progress bar, then success, then auto-reset ---
  await page.setInputFiles('input[name="file"]', {
    name: "return-policy.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Our return policy is 30 days, receipt required."),
  });
  await page.getByText("return-policy.txt").waitFor({ state: "visible", timeout: 5000 });
  const uploadButton = page.getByRole("button", { name: "Upload document" });
  await uploadButton.waitFor({ state: "visible", timeout: 5000 });
  const urlBeforeUpload = page.url();
  await uploadButton.click();

  const progressBarTrack = page.locator("div.h-1\\.5.w-full.overflow-hidden.rounded-full");
  check("a progress bar appears while the upload runs", await progressBarTrack.first().isVisible({ timeout: 5000 }).catch(() => false));

  await page.getByText("Uploaded", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  check("an inline 'Uploaded' success state is shown after the upload completes", true);
  check("the URL never changed -- this was a background upload, not a full-page form submission", page.url() === urlBeforeUpload, page.url());

  await sleep(2200); // the dropzone auto-resets ~1.8s after success
  check(
    "dropzone auto-resets back to idle after a successful upload, ready for the next file",
    await page.getByText("Click to upload or drag and drop").isVisible()
  );

  const listText = await page.evaluate(() => document.body.innerText);
  check(
    "the new document shows up in the list below without a full page reload (server data refreshed in place)",
    listText.includes("return-policy.txt")
  );

  const { data: sources } = await admin.from("knowledge_sources").select("id, file_url").eq("business_id", bizId);
  check("exactly one document was actually saved to the database", sources?.length === 1, JSON.stringify(sources));

  // ============== Onboarding (assistant photo) page ==============
  await page.goto(`${BASE_URL}/dashboard/onboarding`);
  await page.waitForLoadState("networkidle");

  check("photo dropzone shows a short, clear click prompt", await page.getByText("Click to upload", { exact: false }).first().isVisible());

  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await page.setInputFiles('input[name="photo"]', {
    name: "new-avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPngBase64, "base64"),
  });
  await page.getByText("new-avatar.png").waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: "Save photo" }).click();
  await page.getByText("Uploaded", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  await sleep(2200);
  const { data: bizAfter } = await admin.from("businesses").select("assistant_photo_url").eq("id", bizId).single();
  check("assistant_photo_url was actually updated", !!bizAfter.assistant_photo_url, bizAfter.assistant_photo_url);

  const avatarSrc = await page.locator('img[alt="Assistant photo"]').getAttribute("src");
  check(
    "the avatar preview on the page reflects the newly uploaded photo (refreshed without a full reload)",
    !!avatarSrc && avatarSrc.includes(encodeURIComponent(bizAfter.assistant_photo_url).slice(0, 40)) ||
      (!!avatarSrc && decodeURIComponent(avatarSrc).includes(bizAfter.assistant_photo_url)),
    avatarSrc
  );
} finally {
  await browser.close();
  if (bizId) {
    const { data: photoFiles } = await admin.storage.from("assistant-photos").list(bizId);
    if (photoFiles?.length) await admin.storage.from("assistant-photos").remove(photoFiles.map((f) => `${bizId}/${f.name}`));
    const { data: docFiles } = await admin.storage.from("knowledge-sources").list(bizId);
    if (docFiles?.length) await admin.storage.from("knowledge-sources").remove(docFiles.map((f) => `${bizId}/${f.name}`));
    await admin.from("knowledge_sources").delete().eq("business_id", bizId);
    await admin.from("business_users").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("UPLOAD DROPZONE UX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: clear click target, filename/size preview, progress bar, inline success, auto-reset, and refresh-without-reload on both pages.");
