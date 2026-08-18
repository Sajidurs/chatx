import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stamp = Date.now();
const email = `ui-preview-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = "Aurora Design Studio";

const { data: owner } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: biz } = await admin.from("businesses").insert({ name: bizName, plan: "starter" }).select("id").single();
await admin.from("business_users").insert({ business_id: biz.id, email, role: "owner", auth_user_id: owner.user.id, status: "accepted" });

const currentMonth = new Date().toISOString().slice(0, 7);
await admin.from("usage_logs").insert({ business_id: biz.id, month: currentMonth, message_count: 640 });
for (let i = 1; i <= 5; i++) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - i);
  await admin.from("usage_logs").insert({ business_id: biz.id, month: d.toISOString().slice(0, 7), message_count: Math.round(200 + Math.random() * 500) });
}

const sessions = [];
for (let i = 0; i < 6; i++) {
  const { data: s } = await admin
    .from("chat_sessions")
    .insert({ business_id: biz.id, visitor_id: crypto.randomUUID(), needs_handoff: i < 2 })
    .select("id")
    .single();
  sessions.push(s.id);
  await admin.from("chat_messages").insert({ session_id: s.id, role: "visitor", content: "Hi, do you have availability this week?" });
}

const names = ["Sarah Chen", "Marcus Lee", "Priya Patel", "Diego Ramirez", "Fatima Noor"];
for (let i = 0; i < 5; i++) {
  const start = new Date();
  start.setDate(start.getDate() + i + 1);
  await admin.from("bookings").insert({
    business_id: biz.id,
    session_id: sessions[i % sessions.length],
    customer_name: names[i],
    customer_contact: `${names[i].split(" ")[0].toLowerCase()}@mailinator.com`,
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 1800000).toISOString(),
    status: i === 3 ? "cancelled" : i === 4 ? "rescheduled" : "confirmed",
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${BASE_URL}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
await page.screenshot({ path: "scripts/dashboard-preview.png", fullPage: true });
console.log("Screenshot saved. URL:", page.url());

await page.goto(`${BASE_URL}/dashboard/bookings`);
await page.waitForTimeout(300);
await page.screenshot({ path: "scripts/bookings-preview.png", fullPage: true });

await page.goto(`${BASE_URL}/dashboard/conversations`);
await page.waitForTimeout(300);
await page.screenshot({ path: "scripts/conversations-preview.png", fullPage: true });

await browser.close();

// Self-cleaning -- this is a visual-preview tool, not a regression suite, so
// leftover fake businesses would just accumulate on every re-run otherwise.
for (const s of sessions) await admin.from("chat_messages").delete().eq("session_id", s);
await admin.from("bookings").delete().eq("business_id", biz.id);
await admin.from("chat_sessions").delete().eq("business_id", biz.id);
await admin.from("usage_logs").delete().eq("business_id", biz.id);
await admin.from("business_users").delete().eq("business_id", biz.id);
await admin.from("businesses").delete().eq("id", biz.id);
await admin.auth.admin.deleteUser(owner.user.id);

console.log("Done -- screenshots saved to scripts/*.png, preview data cleaned up.");
