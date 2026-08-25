// Regression check for the same bug fixed on account/onboarding: a page
// whose Server Component reads `searchParams` AND has an <input
// type="file"> form silently fails to submit that form (zero network
// request) once the URL already carries a stale query string. The
// knowledge (training documents) page had this same combination.
//
// The upload UI itself was later redesigned (a styled dropzone + real
// progress bar, uploading via XHR to a plain API route instead of a form
// action) -- this now targets the hidden file input the dropzone drives,
// but the regression it guards is the same: upload still has to work with a
// stale query string already in the URL.
//
// Usage: node --env-file=.env.local scripts/verify-knowledge-upload-fix.mjs
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
const email = `knowledge-fix-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = `Knowledge Fix Co ${stamp}`;

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

  // Land with a stale ?error= already in the URL -- exactly the trigger
  // condition (e.g. a real customer's first upload attempt failed
  // validation, then they retry without reloading the page).
  await page.goto(`${BASE_URL}/dashboard/knowledge?error=Something%20went%20wrong`);
  await page.waitForLoadState("networkidle");
  check("starts with a stale ?error= query string present", page.url().includes("error="), page.url());

  await page.setInputFiles('input[name="file"]', {
    name: "test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is a real test knowledge document about our return policy."),
  });
  await page.getByText("test.txt").waitFor({ state: "visible", timeout: 5000 });
  await page.click('button:has-text("Upload document")');
  await page.getByText("Uploaded", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(2000); // let the background processKnowledgeSource() finish

  const { data: sources } = await admin.from("knowledge_sources").select("*").eq("business_id", bizId);
  check("document upload actually ran despite the stale query string", (sources ?? []).length === 1, JSON.stringify(sources));
} finally {
  await browser.close();
  if (bizId) {
    await admin.from("knowledge_sources").delete().eq("business_id", bizId);
    await admin.from("business_users").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("KNOWLEDGE UPLOAD FIX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Knowledge document upload works correctly even when the URL already carries a stale query string.");
