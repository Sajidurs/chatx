// Regression check for the timezone bug logged in CHANGELOG.md's "Known
// gaps": a visitor giving a bare time with no timezone ("10AM") got booked as
// literal UTC, landing 6 hours off on Wallxer's real Dhaka-timezone Google
// Calendar. This temporarily sets Wallxer's new `timezone` field to
// Asia/Dhaka, drives a real bare-time booking + reschedule through the real
// /api/chat endpoint, and independently confirms via the real Google
// Calendar API AND our own database that both land at the intended local
// hour -- then restores Wallxer's timezone and cleans up everything created.
//
// Usage: node --env-file=.env.local scripts/verify-booking-timezone-fix.mjs
// Requires: npm run dev already running on http://localhost:3000, and
// Wallxer already connected to a real Google Calendar (done manually).

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

// Voyage's free tier without a payment method on file caps at 3 req/min.
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

function hourInZone(isoInstant, timeZone) {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(new Date(isoInstant))
  );
}

const TEST_TIMEZONE = "Asia/Dhaka"; // UTC+6, no DST -- matches the real known-affected business
const customerName = `TZ Regression Test ${Date.now()}`;
const createdEventIds = [];
let originalTimezone = "UTC";
let business;

// Wallxer's real connected Google Calendar (the founder's own, used since
// Phase 4 -- there's no other business with real OAuth credentials to test
// against) has genuine recurring meetings on it, including one that spans
// roughly two full days every week. A hardcoded date offset collided with it
// twice while writing this script. Rather than guess around real calendar
// data, find a day where the 00:00-12:00 UTC window (covers both the 10AM
// and 3PM Dhaka slots this test uses) is actually empty before running.
async function findFreeDay(calendar, calendarId) {
  for (let offset = 10; offset < 60; offset++) {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    const dateStr = day.toISOString().slice(0, 10);
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${dateStr}T00:00:00Z`,
        timeMax: `${dateStr}T12:00:00Z`,
        items: [{ id: calendarId }],
      },
    });
    const busy = res.data.calendars?.[calendarId]?.busy ?? [];
    if (busy.length === 0) return dateStr;
  }
  throw new Error("Could not find a free test day in the next 60 days.");
}

try {
  const { data: biz } = await admin
    .from("businesses")
    .select("id, name, google_refresh_token, google_calendar_id, timezone")
    .eq("name", "Wallxer")
    .single();
  business = biz;
  originalTimezone = business.timezone;

  await admin.from("businesses").update({ timezone: TEST_TIMEZONE }).eq("id", business.id);
  check(`Wallxer's timezone temporarily set to ${TEST_TIMEZONE} for this test`, true);

  const realCalendar = realCalendarClient(business.google_refresh_token);

  const dateStr = await findFreeDay(realCalendar, business.google_calendar_id);
  console.log(`  using ${dateStr} (confirmed free 00:00-12:00 UTC on the real calendar)`);

  // --- create_booking with a BARE time, no timezone mentioned -- exactly
  // how the founder said a real customer will normally talk ---
  const bookTurn = await chat(
    business.id,
    `Please book me for ${dateStr} at 10AM for 30 minutes. My name is ${customerName} and my email is tz-test-${Date.now()}@mailinator.com.`
  );
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

  if (created) {
    check(
      `our own bookings.start_time (${created.start_time}) is 10AM when read back in ${TEST_TIMEZONE}, not 10AM UTC`,
      hourInZone(created.start_time, TEST_TIMEZONE) === 10,
      `hour in ${TEST_TIMEZONE}: ${hourInZone(created.start_time, TEST_TIMEZONE)}`
    );
  }

  if (created?.google_event_id) {
    const realEvent = await realCalendar.events.get({ calendarId: business.google_calendar_id, eventId: created.google_event_id });
    check(
      `the REAL Google Calendar event is 10AM when read back in ${TEST_TIMEZONE}, not shifted by the UTC bug`,
      hourInZone(realEvent.data.start.dateTime, TEST_TIMEZONE) === 10,
      `raw start: ${realEvent.data.start.dateTime} (timeZone field: ${realEvent.data.start.timeZone})`
    );
  } else {
    check(`the REAL Google Calendar event is 10AM when read back in ${TEST_TIMEZONE}`, false, "no google_event_id recorded");
  }

  // --- reschedule_booking with another BARE time ---
  const rescheduleTurn = await chat(
    business.id,
    `Actually can you move that to 3PM instead, same day?`,
    bookTurn.body.sessionId
  );
  check("reschedule request gets a normal (non-blocked) reply", rescheduleTurn.body.blocked === false);

  await sleep(2000);
  const { data: afterReschedule } = await admin.from("bookings").select("*").eq("id", created.id).single();
  check(
    `after reschedule, bookings.start_time is 3PM (15:00) in ${TEST_TIMEZONE}`,
    hourInZone(afterReschedule.start_time, TEST_TIMEZONE) === 15,
    `hour in ${TEST_TIMEZONE}: ${hourInZone(afterReschedule.start_time, TEST_TIMEZONE)}, status: ${afterReschedule.status}`
  );

  if (created?.google_event_id) {
    const realEventAfter = await realCalendar.events.get({ calendarId: business.google_calendar_id, eventId: created.google_event_id });
    check(
      `the REAL calendar event also actually moved to 3PM ${TEST_TIMEZONE}`,
      hourInZone(realEventAfter.data.start.dateTime, TEST_TIMEZONE) === 15,
      `raw start: ${realEventAfter.data.start.dateTime}`
    );
  } else {
    check(`the REAL calendar event also actually moved to 3PM ${TEST_TIMEZONE}`, false, "no google_event_id recorded");
  }
} finally {
  for (const eventId of createdEventIds) {
    await realCalendarClient(business.google_refresh_token)
      .events.delete({ calendarId: business.google_calendar_id, eventId })
      .catch(() => {});
  }
  if (business) {
    await admin.from("bookings").delete().eq("business_id", business.id).eq("customer_name", customerName);
    const { data: sessions } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("business_id", business.id)
      .gte("started_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
    for (const s of sessions || []) {
      await admin.from("chat_messages").delete().eq("session_id", s.id);
      await admin.from("chat_sessions").delete().eq("id", s.id);
    }
    await admin.from("businesses").update({ timezone: originalTimezone }).eq("id", business.id);
    console.log(`Restored Wallxer's timezone back to "${originalTimezone}".`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("BOOKING TIMEZONE FIX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: a bare, unqualified time is correctly interpreted in the business's own timezone end-to-end -- both on the real Google Calendar and in our own database -- for both a fresh booking and a reschedule.");
