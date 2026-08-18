import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = "file://" + path.join(__dirname, "host-test-page-head-placement.html").replace(/\\/g, "/");

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(PAGE);
await page.waitForTimeout(2000);
const iframeCount = await page.locator("iframe").count();
console.log("iframe count:", iframeCount);
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (iframeCount !== 1 || errors.length > 0) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS -- widget mounts correctly even when embed.js is placed in <head>.");
