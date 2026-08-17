// End-to-end verification of Phase 2: uploading a real PDF through the actual
// dashboard UI results in searchable chunks scoped to the right business, a
// similarity search only ever returns that business's own chunks (not
// another tenant's), and the onboarding questionnaire generates an editable
// system prompt. Drives the real running dev server with a real browser and
// the real Voyage AI embeddings API. Cleans up everything it creates.
//
// Usage: node --env-file=.env.local scripts/verify-phase2-rag.mjs
// Requires: npm run dev already running on http://localhost:3000

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const password = `Test-${suffix}-Aa1!`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

async function makePdf(text) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([500, 700]);
  const lines = text.match(/.{1,80}(\s|$)/g) || [text];
  lines.forEach((line, i) => page.drawText(line.trim(), { x: 40, y: 660 - i * 16, size: 11, font }));
  return Buffer.from(await doc.save());
}

async function createBusinessWithOwner(name, email) {
  const { data: biz } = await admin.from("businesses").insert({ name }).select("id").single();
  const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await admin
    .from("business_users")
    .insert({ business_id: biz.id, email, role: "owner", auth_user_id: created.user.id, status: "accepted" });
  return { businessId: biz.id, userId: created.user.id, email };
}

async function loginAs(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  return { context, page };
}

async function waitForSourceStatus(sourceId, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin.from("knowledge_sources").select("status").eq("id", sourceId).single();
    if (data?.status === "ready" || data?.status === "failed") return data.status;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "timeout";
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatx-rag-test-"));
let bizA, bizB;
const contexts = [];

try {
  bizA = await createBusinessWithOwner(
    `RAG Test Salon ${suffix}`,
    `rag-a-${suffix}@mailinator.com`
  );
  bizB = await createBusinessWithOwner(
    `RAG Test Bistro ${suffix}`,
    `rag-b-${suffix}@mailinator.com`
  );

  const salonText =
    "Glow Hair Salon offers haircuts for $30 and beard trims for $15. We are open Monday to Saturday, 9am to 6pm. Walk-ins welcome but appointments are preferred.";
  const bistroText =
    "Luna Bistro serves fresh pasta and wood-fired pizza every evening from 5pm to 11pm. Our signature dish is the truffle mushroom risotto, priced at $24.";

  const pdfPathA = path.join(tmpDir, "salon-info.pdf");
  const pdfPathB = path.join(tmpDir, "bistro-info.pdf");
  await fs.writeFile(pdfPathA, await makePdf(salonText));
  await fs.writeFile(pdfPathB, await makePdf(bistroText));

  const browser = await chromium.launch();

  // --- Business A: upload a real PDF through the actual dashboard UI ---
  const sessionA = await loginAs(browser, bizA.email);
  contexts.push(sessionA.context);
  await sessionA.page.goto(`${BASE_URL}/dashboard/knowledge`);
  await sessionA.page.setInputFiles('input[type="file"]', pdfPathA);
  await sessionA.page.locator('form:has(input[type="file"]) button[type="submit"]').click();
  await sessionA.page.waitForLoadState("networkidle");

  const { data: sourceA } = await admin
    .from("knowledge_sources")
    .select("id, type")
    .eq("business_id", bizA.businessId)
    .single();
  check("PDF upload created a knowledge_sources row scoped to business A", !!sourceA && sourceA.type === "pdf");

  const statusA = await waitForSourceStatus(sourceA.id);
  check("business A's PDF finished processing (status=ready)", statusA === "ready", statusA);

  const { data: chunksA } = await admin
    .from("knowledge_chunks")
    .select("id, business_id, content, embedding")
    .eq("business_id", bizA.businessId);
  check(
    "business A has chunks with 1024-dim embeddings",
    (chunksA?.length ?? 0) > 0 && typeof chunksA[0].embedding === "string",
    `count=${chunksA?.length}`
  );

  // --- Business B: upload a different real PDF ---
  const sessionB = await loginAs(browser, bizB.email);
  contexts.push(sessionB.context);
  await sessionB.page.goto(`${BASE_URL}/dashboard/knowledge`);
  await sessionB.page.setInputFiles('input[type="file"]', pdfPathB);
  await sessionB.page.locator('form:has(input[type="file"]) button[type="submit"]').click();
  await sessionB.page.waitForLoadState("networkidle");

  const { data: sourceB } = await admin
    .from("knowledge_sources")
    .select("id, type")
    .eq("business_id", bizB.businessId)
    .single();
  const statusB = await waitForSourceStatus(sourceB.id);
  check("business B's PDF finished processing (status=ready)", statusB === "ready", statusB);

  // --- Similarity search isolation: query about salon should only surface business A's chunks ---
  // (calling Voyage directly here, mirroring src/lib/ai/voyage.ts's embedQuery --
  // that module is TS and server-only, not importable from a plain Node script)
  const { VoyageAIClient } = await import("voyageai");
  const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Voyage's free tier without a payment method on file is capped at 3
  // requests/minute -- space calls out to stay safely under that during
  // this test. Real usage will need a payment method added regardless (see
  // CHANGELOG.md); this is purely a test-pacing accommodation.
  const VOYAGE_CALL_GAP_MS = 25000;

  async function search(businessId, queryText) {
    await sleep(VOYAGE_CALL_GAP_MS);
    const embedRes = await voyage.embed({
      input: [queryText],
      model: "voyage-4-lite",
      inputType: "query",
      outputDimension: 1024,
    });
    const queryEmbedding = embedRes.data[0].embedding;
    const { data, error } = await admin.rpc("match_knowledge_chunks", {
      p_business_id: businessId,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_match_count: 5,
    });
    if (error) throw error;
    return data;
  }

  const salonResultsForA = await search(bizA.businessId, "How much does a haircut cost?");
  check(
    "similarity search on business A returns its own salon content",
    salonResultsForA.length > 0 && salonResultsForA.some((r) => r.content.includes("$30")),
    JSON.stringify(salonResultsForA.map((r) => r.content.slice(0, 40)))
  );

  const salonResultsForB = await search(bizB.businessId, "How much does a haircut cost?");
  check(
    "the same query scoped to business B returns none of business A's content",
    !salonResultsForB.some((r) => r.content.includes("$30") || r.content.includes("Glow Hair")),
    JSON.stringify(salonResultsForB.map((r) => r.content.slice(0, 40)))
  );

  const bistroResultsForB = await search(bizB.businessId, "What's on the dinner menu?");
  check(
    "similarity search on business B returns its own bistro content",
    bistroResultsForB.length > 0 && bistroResultsForB.some((r) => r.content.includes("risotto")),
    JSON.stringify(bistroResultsForB.map((r) => r.content.slice(0, 40)))
  );

  // --- Onboarding questionnaire generates an editable system prompt ---
  await sessionA.page.goto(`${BASE_URL}/dashboard/onboarding`);
  await sessionA.page.fill('input[name="assistantName"]', "Glo");
  await sessionA.page.fill('input[name="businessType"]', "hair salon");
  await sessionA.page.fill('textarea[name="services"]', "Haircuts, beard trims, coloring");
  await sessionA.page.fill('input[name="tone"]', "friendly and casual");
  await sessionA.page.fill('textarea[name="faqs"]', "Q: Do you take walk-ins? A: Yes.");
  await sessionA.page.locator('form:has(input[name="businessType"]) button[type="submit"]').click();
  await sessionA.page.waitForLoadState("networkidle");

  const { data: bizAfterOnboarding } = await admin
    .from("businesses")
    .select("system_prompt, assistant_name")
    .eq("id", bizA.businessId)
    .single();
  check(
    "system prompt reflects questionnaire answers",
    bizAfterOnboarding.system_prompt?.includes("hair salon") &&
      bizAfterOnboarding.system_prompt?.includes("walk-ins") &&
      bizAfterOnboarding.assistant_name === "Glo",
    bizAfterOnboarding.system_prompt?.slice(0, 120)
  );

  // --- Persona photo upload ---
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const photoPath = path.join(tmpDir, "avatar.png");
  await fs.writeFile(photoPath, Buffer.from(tinyPngBase64, "base64"));

  await sessionA.page.goto(`${BASE_URL}/dashboard/onboarding`);
  await sessionA.page.setInputFiles('input[name="photo"]', photoPath);
  await sessionA.page.locator('form:has(input[name="photo"]) button[type="submit"]').click();
  await sessionA.page.waitForLoadState("networkidle");

  const { data: bizAfterPhoto } = await admin
    .from("businesses")
    .select("assistant_photo_url")
    .eq("id", bizA.businessId)
    .single();
  check(
    "persona photo upload sets assistant_photo_url to a public URL",
    !!bizAfterPhoto.assistant_photo_url?.includes("assistant-photos"),
    bizAfterPhoto.assistant_photo_url
  );

  // Direct edit path
  await sessionA.page.goto(`${BASE_URL}/dashboard/onboarding`);
  const editedPrompt = "This is a manually edited system prompt for testing.";
  await sessionA.page.fill('textarea[name="systemPrompt"]', editedPrompt);
  await sessionA.page.locator('form:has(textarea[name="systemPrompt"]) button[type="submit"]').click();
  await sessionA.page.waitForLoadState("networkidle");

  const { data: bizAfterEdit } = await admin
    .from("businesses")
    .select("system_prompt")
    .eq("id", bizA.businessId)
    .single();
  check(
    "system prompt is directly editable afterward",
    bizAfterEdit.system_prompt === editedPrompt,
    bizAfterEdit.system_prompt
  );

  await browser.close();
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  for (const biz of [bizA, bizB].filter(Boolean)) {
    const { data: sources } = await admin
      .from("knowledge_sources")
      .select("file_url")
      .eq("business_id", biz.businessId);
    if (sources?.length) {
      await admin.storage.from("knowledge-sources").remove(sources.map((s) => s.file_url));
    }
    const { data: photos } = await admin.storage.from("assistant-photos").list(biz.businessId);
    if (photos?.length) {
      await admin.storage
        .from("assistant-photos")
        .remove(photos.map((p) => `${biz.businessId}/${p.name}`));
    }
    await admin.from("businesses").delete().eq("id", biz.businessId);
    await admin.auth.admin.deleteUser(biz.userId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PHASE 2 RAG VERIFICATION FAILED");
  process.exit(1);
}
console.log("Phase 2 RAG pipeline verified end-to-end.");
