// Ad-hoc diagnostic: checks whether the chat widget is actually rendering on
// a given real, live website, from a fresh logged-out browser -- the same
// view a real anonymous visitor gets. Useful whenever a business reports the
// widget "isn't showing" after embedding the snippet, since WordPress
// caching (or any full-page cache) very commonly serves an admin a stale,
// pre-edit page while showing real visitors something different.
//
// Usage: node scripts/check-widget-live.mjs https://example.com

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/check-widget-live.mjs <url>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const scriptCount = await page.locator("script[src*='embed.js']").count();
const iframeCount = await page.locator("iframe[src*='/widget/']").count();
console.log("embed.js script tags found:", scriptCount);
console.log("widget iframe count:", iframeCount);

if (iframeCount > 0) {
  const iframe = page.locator("iframe[src*='/widget/']").first();
  console.log("iframe src:", await iframe.getAttribute("src"));
  console.log("iframe box:", JSON.stringify(await iframe.boundingBox()));
}

await browser.close();

if (scriptCount === 0 || iframeCount === 0) {
  console.error("Widget NOT found for a real, logged-out visitor.");
  process.exit(1);
}
console.log("Widget confirmed live for a real, logged-out visitor.");
