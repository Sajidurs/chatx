import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stamp = Date.now();
const email = `shell-check-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const { data: owner } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: biz } = await admin.from("businesses").insert({ name: "Shell Check Co" }).select("id").single();
await admin.from("business_users").insert({ business_id: biz.id, email, role: "owner", auth_user_id: owner.user.id, status: "accepted" });

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE_URL}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');
await page.waitForLoadState("networkidle");

for (const path of ["/dashboard/embed", "/dashboard/calendar", "/dashboard/onboarding", "/dashboard/knowledge", "/dashboard/team", "/dashboard/test-chat"]) {
  const res = await page.goto(`${BASE_URL}${path}`);
  console.log(path, "->", res.status());
}

console.log("Page errors:", JSON.stringify(errors));
await browser.close();

await admin.from("business_users").delete().eq("business_id", biz.id);
await admin.from("businesses").delete().eq("id", biz.id);
await admin.auth.admin.deleteUser(owner.user.id);
console.log("Done.");
