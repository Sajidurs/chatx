// Phase 5 verification: drives a real browser against a plain static HTML
// page with deliberately hostile/conflicting global CSS, loads the real
// embed snippet, and confirms the widget renders correctly and is fully
// isolated from the host page's styles -- per system_design.md's Phase 5
// definition of done.
//
// Usage: node scripts/verify-embed-widget.mjs
// Requires: npm run dev already running on http://localhost:3000.

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_PAGE = "file://" + path.join(__dirname, "host-test-page.html").replace(/\\/g, "/");
const TEST_BUSINESS_ID = "390cde0b-76ed-49e6-93f2-0091a2439cdd"; // "Man Feshiopn" -- has a real persona name/photo set

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const runStartedAt = new Date().toISOString();

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(HOST_PAGE);
  await page.waitForTimeout(1500);

  // --- Host page's own styling is untouched ---
  const hostColor = await page.locator("#host-marker").evaluate((el) => getComputedStyle(el).color);
  check("host page's own hostile CSS still applies to its own content (untouched by us)", hostColor === "rgb(57, 255, 20)", hostColor);

  // --- The iframe exists and points at the right business ---
  const iframeEl = page.locator("iframe");
  await iframeEl.waitFor({ state: "attached", timeout: 10000 });
  const src = await iframeEl.getAttribute("src");
  check(
    "iframe src points to /widget/<the exact business ID from the snippet>",
    src === `http://localhost:3000/widget/${TEST_BUSINESS_ID}`,
    src
  );

  const frame = page.frameLocator("iframe");

  // --- Bubble renders first, sized small ---
  const bubbleButton = frame.getByRole("button", { name: "Open chat" });
  await bubbleButton.waitFor({ state: "visible", timeout: 10000 });
  check("collapsed bubble button is visible inside the iframe", true);

  const collapsedBox = await iframeEl.boundingBox();
  check("iframe starts small (bubble-sized), not a large box", collapsedBox.width < 150 && collapsedBox.height < 150, JSON.stringify(collapsedBox));

  // --- Persona loaded correctly for THIS business (assistant_name = "Bappi") ---
  await bubbleButton.click();
  await frame.getByText("Bappi", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  check("widget loaded the correct business's persona name (\"Bappi\")", true);

  await page.waitForTimeout(500);
  const expandedBox = await iframeEl.boundingBox();
  check(
    "iframe resized larger after opening the chat panel (postMessage resize protocol works)",
    expandedBox.width > 300 && expandedBox.height > 400,
    JSON.stringify(expandedBox)
  );

  // --- Widget's own internal styling survived the host's `all: unset` reset ---
  const sendButtonBg = await frame.getByRole("button", { name: "Send" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  check(
    "widget's own button styling (black background) is intact -- host's global reset never reached inside the iframe",
    sendButtonBg === "rgb(0, 0, 0)",
    sendButtonBg
  );

  // --- A real message round-trip through the actual chat pipeline ---
  const input = frame.getByPlaceholder("Type a message...");
  await input.fill("Hello, just checking the widget works");
  await frame.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(15000);
  const bubbleCount = await frame.locator("div.mr-auto, div.ml-auto").count();
  check("a reply came back through the real /api/chat pipeline", bubbleCount >= 2, `bubble count: ${bubbleCount}`);

  // --- Closing collapses the iframe back down ---
  await frame.getByRole("button", { name: "Close chat" }).click();
  await page.waitForTimeout(500);
  const closedBox = await iframeEl.boundingBox();
  check("closing the panel shrinks the iframe back to bubble size", closedBox.width < 150 && closedBox.height < 150, JSON.stringify(closedBox));

  check("no console errors were thrown on the host page", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
  // Clean up the real chat session/messages this run created.
  const { data: sessions } = await admin
    .from("chat_sessions")
    .select("id")
    .eq("business_id", TEST_BUSINESS_ID)
    .gte("started_at", runStartedAt);
  for (const s of sessions || []) {
    await admin.from("chat_messages").delete().eq("session_id", s.id);
    await admin.from("chat_sessions").delete().eq("id", s.id);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PHASE 5 EMBED WIDGET VERIFICATION FAILED");
  process.exit(1);
}
console.log("Phase 5 embed widget verified: renders correctly on a hostile host page, fully isolated, correct persona loaded.");
