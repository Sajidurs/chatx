import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stamp = Date.now();
const email = `full-preview-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = "Aurora Design Studio";

const { data: owner } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: biz } = await admin.from("businesses").insert({ name: bizName, plan: "starter", assistant_name: "Aria" }).select("id").single();
await admin.from("business_users").insert({ business_id: biz.id, email, role: "owner", auth_user_id: owner.user.id, status: "accepted" });

const currentMonth = new Date().toISOString().slice(0, 7);
await admin.from("usage_logs").insert({ business_id: biz.id, month: currentMonth, message_count: 640 });

const { data: s } = await admin.from("chat_sessions").insert({ business_id: biz.id, visitor_id: crypto.randomUUID() }).select("id").single();
await admin.from("chat_messages").insert({ session_id: s.id, role: "visitor", content: "Do you have availability this week?" });

await admin.from("bookings").insert({
  business_id: biz.id,
  session_id: s.id,
  customer_name: "Sarah Chen",
  customer_contact: "sarah@mailinator.com",
  start_time: new Date(Date.now() + 86400000).toISOString(),
  end_time: new Date(Date.now() + 90000000).toISOString(),
  status: "confirmed",
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');
await page.waitForLoadState("networkidle");

const pages = [
  ["dashboard", "/dashboard"],
  ["conversations", "/dashboard/conversations"],
  ["conversation-detail", `/dashboard/conversations/${s.id}`],
  ["bookings", "/dashboard/bookings"],
  ["embed", "/dashboard/embed"],
  ["calendar", "/dashboard/calendar"],
  ["knowledge", "/dashboard/knowledge"],
  ["onboarding", "/dashboard/onboarding"],
  ["team", "/dashboard/team"],
  ["test-chat", "/dashboard/test-chat"],
  ["plans", "/plans"],
];

for (const [name, path] of pages) {
  await page.goto(`${BASE_URL}${path}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `scripts/page-${name}.png` });
}

await browser.close();

await admin.from("chat_messages").delete().eq("session_id", s.id);
await admin.from("bookings").delete().eq("business_id", biz.id);
await admin.from("chat_sessions").delete().eq("business_id", biz.id);
await admin.from("usage_logs").delete().eq("business_id", biz.id);
await admin.from("business_users").delete().eq("business_id", biz.id);
await admin.from("businesses").delete().eq("id", biz.id);
await admin.auth.admin.deleteUser(owner.user.id);
console.log("Done -- all page screenshots saved, preview data cleaned up.");
