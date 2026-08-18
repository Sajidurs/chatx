// Regression check for the founder-reported bug: a visitor gave a bare date
// with no year ("18th August at 6PM Dhaka time") and Claude booked it for
// 2025 instead of 2026, since the system prompt never told it what today's
// actual date is. This drives the exact same style of request through the
// real /api/chat endpoint and asserts the resulting booking lands in the
// correct (current) year, then cleans up.
//
// Usage: node --env-file=.env.local scripts/verify-booking-date-fix.mjs
// Requires: npm run dev already running on http://localhost:3000.

import crypto from "crypto";
import { google } from "googleapis";
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

// Voyage's free tier without a payment method caps at 3 req/min -- every
// chat turn calls embedQuery, so pace turns to stay under it.
const VOYAGE_CALL_GAP_MS = 25000;
let firstChatCall = true;

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
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: decrypt(refreshTokenEncrypted) });
  return google.calendar({ version: "v3", auth });
}

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

const currentYear = new Date().getUTCFullYear();
const customerName = `Date Regression Test ${Date.now()}`;

try {
  // A bare "month day" with no year, exactly like the founder's real test.
  const turn1 = await chat(business.id, "Can we book a meeting?");
  const turn2 = await chat(
    business.id,
    "September 5th at 3PM UTC",
    turn1.body.sessionId
  );
  const turn3 = await chat(
    business.id,
    `For 30 minutes. Name: ${customerName}, email: date-regression-${Date.now()}@mailinator.com`,
    turn1.body.sessionId
  );
  check("booking request gets a normal (non-blocked) reply", turn3.body.blocked === false);

  await new Promise((r) => setTimeout(r, 2000));
  const { data: created } = await admin
    .from("bookings")
    .select("*")
    .eq("business_id", business.id)
    .eq("customer_name", customerName)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  check("a booking row was created", !!created, JSON.stringify(created));
  if (created) {
    const bookedYear = new Date(created.start_time).getUTCFullYear();
    check(
      `booking year (${bookedYear}) matches the current year (${currentYear}), not the past`,
      bookedYear === currentYear,
      created.start_time
    );
  }
} finally {
  const { data: leftover } = await admin
    .from("bookings")
    .select("id, google_event_id")
    .eq("business_id", business.id)
    .eq("customer_name", customerName);
  for (const b of leftover || []) {
    if (b.google_event_id) {
      await realCalendar.events.delete({ calendarId: business.google_calendar_id, eventId: b.google_event_id }).catch(() => {});
    }
    await admin.from("bookings").delete().eq("id", b.id);
  }
  const { data: sessions } = await admin
    .from("chat_sessions")
    .select("id")
    .eq("business_id", business.id)
    .gte("started_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  for (const s of sessions || []) {
    await admin.from("chat_messages").delete().eq("session_id", s.id);
    await admin.from("chat_sessions").delete().eq("id", s.id);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("DATE FIX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Booking date resolution verified: bare dates resolve to the current year, not the past.");
