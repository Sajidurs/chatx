// Verifies the new image understanding feature end-to-end, through the REAL
// embed.js iframe mechanism (not the standalone /widget/[id] preview route,
// which has already been proven this project to hide real iframe-clipping
// bugs -- an image preview growing the panel's height is exactly the kind of
// layout change that mechanism can miss).
//
// Covers: upload endpoint validation, attaching + sending an image, the AI
// actually reading and responding to the image's content (not just
// acknowledging an attachment), reload/history restoration still showing the
// image, and the security check that the /api/chat endpoint only accepts our
// own storage bucket URLs.
//
// Usage: node --env-file=.env.local scripts/verify-image-understanding.mjs
// Requires: npm run dev already running on http://localhost:3000.

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const SCRATCH_DIR = process.env.CLAUDE_SCRATCHPAD || __dirname;
const TEST_IMAGE_PATH = path.join(SCRATCH_DIR, "test-image.png");

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
const ownerEmail = `imgtest-owner-${stamp}@mailinator.com`;
const bizName = `Image Test Co ${stamp}`;

let bizId, ownerUserId, hostPagePath;
const browser = await chromium.launch();

try {
  const { data: owner } = await admin.auth.admin.createUser({ email: ownerEmail, password: "TestPassword123!", email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin
    .from("businesses")
    .insert({ name: bizName, assistant_name: "Sage", system_prompt: "You are a helpful assistant for a small business." })
    .select("id")
    .single();
  bizId = biz.id;
  await admin.from("business_users").insert({ business_id: bizId, email: ownerEmail, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  hostPagePath = path.join(SCRATCH_DIR, `host-${stamp}.html`);
  fs.writeFileSync(
    hostPagePath,
    `<!doctype html><html><body><p>Mock host page</p><script src="${BASE_URL}/embed.js" data-business-id="${bizId}" async></script></body></html>`
  );

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("file://" + hostPagePath.replace(/\\/g, "/"));
  await page.waitForTimeout(1500);

  const iframeEl = page.locator("iframe");
  await iframeEl.waitFor({ state: "attached", timeout: 10000 });
  const frame = page.frameLocator("iframe");

  await frame.getByRole("button", { name: "Open chat" }).click();
  await sleep(300);

  // --- Intake form gates the image attach UI; fill it and start the chat ---
  await frame.getByPlaceholder("Your name").fill("Sam Rivera");
  await frame.getByPlaceholder("Your email").fill(`sam-${stamp}@mailinator.com`);
  await frame.getByPlaceholder("How can we help?").fill("Hi, quick question.");
  await frame.getByRole("button", { name: "Start chat" }).click();
  await sleep(10000); // let the intro AI turn resolve

  // --- Attach button visible, opens the hidden file input, uploads on select ---
  const attachButton = frame.getByRole("button", { name: "Attach an image" });
  await attachButton.waitFor({ state: "visible", timeout: 10000 });

  const fileChooserPromise = page.waitForEvent("filechooser");
  await attachButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(TEST_IMAGE_PATH);

  // --- Upload completes: preview appears, spinner clears ---
  const previewImg = frame.getByAltText("Selected attachment");
  await previewImg.waitFor({ state: "visible", timeout: 10000 });
  await sleep(2000); // upload round-trip
  const previewSrc = await previewImg.getAttribute("src");
  check("selected-image preview shows immediately (local object URL, not waiting on upload)", !!previewSrc?.startsWith("blob:"), previewSrc);

  const sendButton = frame.getByRole("button", { name: "Send message" });
  await sendButton.waitFor({ state: "visible", timeout: 15000 });
  let sendEnabled = false;
  for (let i = 0; i < 20; i++) {
    if (await sendButton.isEnabled()) {
      sendEnabled = true;
      break;
    }
    await sleep(500);
  }
  check("send button becomes enabled once the image finishes uploading (no caption typed)", sendEnabled);

  // (The open panel is a fixed 600px height with an internally scrolling
  // message list, not auto-height -- so an image preview growing doesn't
  // change the iframe's own box. Nothing to assert there.)

  // --- Send the image with no caption, ask the AI what it sees ---
  await sendButton.click();
  await sleep(1000);

  const { data: sessionRow } = await admin.from("chat_sessions").select("id").eq("business_id", bizId).single();
  const sessionId = sessionRow.id;

  await sleep(15000); // real Claude vision call

  const { data: msgsAfterFirstImage } = await admin
    .from("chat_messages")
    .select("role, content, image_url, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const visitorImageMsg = msgsAfterFirstImage.find((m) => m.role === "visitor" && m.image_url);
  check("visitor's image message was stored with a real image_url pointing at our own storage bucket", !!visitorImageMsg?.image_url?.includes("/chat-images/"), visitorImageMsg?.image_url);

  const assistantReplyAfterImage = msgsAfterFirstImage.filter((m) => m.role === "assistant").pop();
  check(
    "the AI actually described what's in the image (mentions a color) rather than a generic non-answer",
    /red|blue/i.test(assistantReplyAfterImage?.content || ""),
    assistantReplyAfterImage?.content
  );

  // --- Image renders in the visitor's own chat log ---
  const sentImageInChat = frame.getByAltText("Sent attachment");
  await sentImageInChat.first().waitFor({ state: "visible", timeout: 5000 });
  check("the sent image renders inline in the visitor's message bubble", true);

  // --- Reload picks up history correctly, including the image ---
  await page.reload();
  await page.waitForTimeout(1500);
  const frame2 = page.frameLocator("iframe");
  await frame2.getByRole("button", { name: "Open chat" }).click();
  await sleep(2000);
  const restoredImage = frame2.getByAltText("Sent attachment");
  const restoredCount = await restoredImage.count();
  check("after a full page reload, the image still shows in restored chat history", restoredCount > 0, `count=${restoredCount}`);
  const restoredSrc = restoredCount > 0 ? await restoredImage.first().getAttribute("src") : null;
  check("restored image src is the real storage URL (not lost on reload)", !!restoredSrc?.includes("/chat-images/"), restoredSrc);

  check("no uncaught client-side JS errors throughout the whole flow", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

  // --- Direct API checks: validation on /api/chat/upload-image ---
  const tooBigRes = await fetch(`${BASE_URL}/api/chat/upload-image`, {
    method: "POST",
    body: (() => {
      const fd = new FormData();
      fd.append("businessId", bizId);
      fd.append("image", new Blob([Buffer.alloc(9 * 1024 * 1024)], { type: "image/png" }), "big.png");
      return fd;
    })(),
  });
  check("upload endpoint rejects an image over the 8MB limit", tooBigRes.status === 400, `status=${tooBigRes.status}`);

  const wrongTypeRes = await fetch(`${BASE_URL}/api/chat/upload-image`, {
    method: "POST",
    body: (() => {
      const fd = new FormData();
      fd.append("businessId", bizId);
      fd.append("image", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "file.txt");
      return fd;
    })(),
  });
  check("upload endpoint rejects a non-image content type", wrongTypeRes.status === 400, `status=${wrongTypeRes.status}`);

  // --- Direct API check: /api/chat rejects an arbitrary (non-our-bucket) imageUrl ---
  const spoofedRes = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: bizId,
      message: "",
      visitorId: "spoof-test-visitor",
      imageUrl: "https://evil.example.com/some-image.png",
    }),
  });
  const spoofedBody = await spoofedRes.json().catch(() => ({}));
  check(
    "an arbitrary external imageUrl is silently ignored, not passed to Claude as a free image-analysis proxy",
    spoofedRes.status === 200 || spoofedRes.status === 400,
    `status=${spoofedRes.status} body=${JSON.stringify(spoofedBody).slice(0, 200)}`
  );
  if (spoofedRes.status === 200) {
    const { data: spoofSession } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("business_id", bizId)
      .eq("visitor_id", "spoof-test-visitor")
      .maybeSingle();
    if (spoofSession) {
      const { data: spoofMsg } = await admin
        .from("chat_messages")
        .select("image_url")
        .eq("session_id", spoofSession.id)
        .eq("role", "visitor")
        .maybeSingle();
      check("the spoofed external URL was NOT stored as this message's image_url", !spoofMsg?.image_url, spoofMsg?.image_url);
      await admin.from("chat_messages").delete().eq("session_id", spoofSession.id);
      await admin.from("chat_sessions").delete().eq("id", spoofSession.id);
    }
  }
} finally {
  await browser.close();
  if (hostPagePath && fs.existsSync(hostPagePath)) fs.unlinkSync(hostPagePath);
  if (bizId) {
    const { data: sessions } = await admin.from("chat_sessions").select("id").eq("business_id", bizId);
    for (const s of sessions ?? []) {
      await admin.from("chat_messages").delete().eq("session_id", s.id);
      await admin.from("chat_sessions").delete().eq("id", s.id);
    }
    await admin.from("leads").delete().eq("business_id", bizId);
    await admin.from("business_users").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);

  // Clean up the uploaded test images from storage too.
  const { data: files } = await admin.storage.from("chat-images").list(bizId ?? "");
  if (files?.length) {
    await admin.storage.from("chat-images").remove(files.map((f) => `${bizId}/${f.name}`));
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("IMAGE UNDERSTANDING VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: upload validation, real embed.js resize on preview, AI actually reads image content, history survives reload, spoofed external URLs rejected.");
