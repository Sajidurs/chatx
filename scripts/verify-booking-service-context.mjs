// Verifies the new founder-requested feature: after a booking is made, the
// Bookings dashboard should show which SERVICE the customer booked and an
// overall CONTEXT note about them -- captured by the AI directly at booking
// time (it already has the full conversation in view right then), not
// backfilled separately.
//
// Drives a real conversation through the real /api/chat endpoint against
// Wallxer's real, already-connected Google Calendar (same fixture business
// and methodology as verify-phase4-booking.mjs), then confirms: the
// create_booking tool call actually included a service; the bookings row
// has both `service` and `customer_notes` populated with real, sensible
// values (not placeholders); and the owner-facing Bookings page renders
// them.
//
// Usage: node --env-file=.env.local scripts/verify-booking-service-context.mjs
// Requires: npm run dev already running on http://localhost:3000, and
// Wallxer already connected to a real Google Calendar (done manually).

import { chromium } from "playwright";
import { google } from "googleapis";
import crypto from "crypto";
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

function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function realCalendarClient(refreshTokenEncrypted) {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  auth.setCredentials({ refresh_token: decrypt(refreshTokenEncrypted) });
  return google.calendar({ version: "v3", auth });
}

// Voyage's free tier without a payment method caps at 3 req/min -- every
// chat turn calls embedQuery for retrieval, so pace turns to stay under it.
const VOYAGE_CALL_GAP_MS = 25000;
let firstChatCall = true;

async function chat(businessId, message, sessionId) {
  if (!firstChatCall) await sleep(VOYAGE_CALL_GAP_MS);
  firstChatCall = false;
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, message, sessionId }),
  });
  const body = await res.json();
  console.log(`  > "${message}"\n  < ${(body.replies || []).map((r) => r.content).join(" / ")}`);
  return { status: res.status, body };
}

const { data: business } = await admin
  .from("businesses")
  .select("id, name, google_refresh_token, google_calendar_id")
  .eq("name", "Wallxer")
  .single();

const realCalendar = realCalendarClient(business.google_refresh_token);
const createdEventIds = [];
const customerName = `Service Context Test ${Date.now()}`;

const day = new Date();
day.setDate(day.getDate() + 6);
const dateStr = day.toISOString().slice(0, 10);

let sessionId;
try {
  // A specific, distinctive service (from Wallxer's own real system prompt)
  // plus a detail worth noting as customer context, in one natural message.
  const bookTurn = await chat(
    business.id,
    `Hi, I run an early-stage startup and we really need help with SEO -- our site gets almost no organic traffic. Can you book me an SEO consultation on ${dateStr} from 15:00 to 15:30 UTC? My name is ${customerName} and my email is service-context-test-${Date.now()}@mailinator.com.`
  );
  sessionId = bookTurn.body.sessionId;
  check("booking request gets a normal (non-blocked) reply", bookTurn.body.blocked === false);

  await sleep(2000);
  const { data: created } = await admin
    .from("bookings")
    .select("*")
    .eq("business_id", business.id)
    .eq("customer_name", customerName)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  check("a booking row was created", !!created, JSON.stringify(created));
  if (created?.google_event_id) createdEventIds.push(created.google_event_id);

  check("the booking's `service` column is populated (not null/empty)", !!created?.service?.trim(), created?.service);
  check("the captured service actually reflects what was booked (mentions SEO)", /seo/i.test(created?.service || ""), created?.service);

  check("the booking's `customer_notes` column is populated (not null/empty)", !!created?.customer_notes?.trim(), created?.customer_notes);
  check(
    "the captured customer note reflects real conversation context (mentions the startup/traffic detail), not a generic placeholder",
    /startup|traffic|organic/i.test(created?.customer_notes || ""),
    created?.customer_notes
  );

  // --- The real Google Calendar event's summary/description carry the service too ---
  if (created?.google_event_id) {
    const realEvent = await realCalendar.events.get({ calendarId: business.google_calendar_id, eventId: created.google_event_id });
    check(
      "the real Google Calendar event's title includes the service (not just a generic 'Meeting with X')",
      /seo/i.test(realEvent.data.summary || ""),
      realEvent.data.summary
    );
  }

  // --- Owner-facing dashboard actually renders these fields ---
  // Wallxer's real owner account has no password on file for this script to
  // log in with, so a throwaway staff membership (its own fresh auth user)
  // is added just to view the page as a real logged-in member -- cleaned up
  // afterward, alongside everything else.
  const tempEmail = `booking-ux-viewer-${Date.now()}@mailinator.com`;
  const tempPassword = "TestPassword123!";
  const { data: tempUser } = await admin.auth.admin.createUser({ email: tempEmail, password: tempPassword, email_confirm: true });
  await admin
    .from("business_users")
    .insert({ business_id: business.id, email: tempEmail, role: "staff", auth_user_id: tempUser.user.id, status: "accepted" });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', tempEmail);
    await page.fill('input[name="password"]', tempPassword);
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle");

    await page.goto(`${BASE_URL}/dashboard/bookings`);
    await page.waitForLoadState("networkidle");
    const pageText = await page.evaluate(() => document.body.innerText);

    check("Bookings page shows a 'Service' column header", pageText.includes("Service"));
    check("Bookings page shows the actual booked service for this row", new RegExp(created?.service || "§NOMATCH§", "i").test(pageText), created?.service);
    check(
      "Bookings page shows the customer context note for this row",
      pageText.includes((created?.customer_notes || "§NOMATCH§").slice(0, 30)),
      created?.customer_notes?.slice(0, 30)
    );
  } finally {
    await browser.close();
    await admin.from("business_users").delete().eq("auth_user_id", tempUser.user.id);
    await admin.auth.admin.deleteUser(tempUser.user.id);
  }
} finally {
  for (const eventId of createdEventIds) {
    await realCalendar.events.delete({ calendarId: business.google_calendar_id, eventId }).catch(() => {});
  }
  await admin.from("bookings").delete().eq("business_id", business.id).eq("customer_name", customerName);
  if (sessionId) {
    await admin.from("chat_messages").delete().eq("session_id", sessionId);
    await admin.from("chat_sessions").delete().eq("id", sessionId);
    await admin.from("leads").delete().eq("session_id", sessionId);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("BOOKING SERVICE/CONTEXT VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: booking captures service and customer context directly from a real conversation, stored correctly, reflected on the real calendar event.");
