// End-to-end verification of Phase 4: drives real conversations through the
// real /api/chat endpoint (matching the spec's own wording -- "after a test
// conversation") against Wallxer's real, already-connected Google Calendar,
// then independently confirms the effects directly via the Google Calendar
// API (not just our own database) -- a created event with a real Meet link,
// a reschedule that actually moves it, a cancellation that actually deletes
// it, and availability checks that reflect what's really on the calendar.
//
// Usage: node --env-file=.env.local scripts/verify-phase4-booking.mjs
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

// Mirrors src/lib/crypto/encryption.ts -- independent verification needs its
// own path to the real Google Calendar, not a re-use of app internals.
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

// Voyage's free tier without a payment method on file caps at 3 req/min --
// every chat turn calls embedQuery for retrieval (even with no trained
// documents), so pace turns out to stay under it (see Phase 2 changelog).
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

// A specific weekday, a few days out, at an unusual time -- unlikely to
// collide with anything already on the real calendar, and easy to reason
// about in assertions.
const day = new Date();
day.setDate(day.getDate() + 5);
const dateStr = day.toISOString().slice(0, 10);

try {
  // --- check_availability, driven by a real conversation ---
  const availTurn = await chat(business.id, `What times are you free on ${dateStr} between 1pm and 6pm UTC?`);
  check("availability question gets a normal (non-blocked) reply", availTurn.body.blocked === false);

  // --- create_booking ---
  const bookTurn = await chat(
    business.id,
    `Please book me for ${dateStr} from 14:00 to 14:30 UTC. My name is Test Visitor and my email is booking-test-${Date.now()}@mailinator.com.`,
    availTurn.body.sessionId
  );
  check("booking request gets a normal (non-blocked) reply", bookTurn.body.blocked === false);

  await sleep(2000); // let the DB write settle
  const { data: created } = await admin
    .from("bookings")
    .select("*")
    .eq("business_id", business.id)
    .eq("customer_name", "Test Visitor")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  check("a booking row was created in our database", !!created, JSON.stringify(created));
  if (created?.google_event_id) createdEventIds.push(created.google_event_id);

  if (created?.google_event_id) {
    const realEvent = await realCalendar.events.get({
      calendarId: business.google_calendar_id,
      eventId: created.google_event_id,
    });
    check(
      "the booking is a REAL event on the connected Google Calendar",
      realEvent.data.status !== "cancelled",
      realEvent.data.summary
    );
    check(
      "the real calendar event has a working Google Meet link",
      !!realEvent.data.hangoutLink,
      realEvent.data.hangoutLink
    );
  } else {
    check("the booking is a REAL event on the connected Google Calendar", false, "no google_event_id recorded");
    check("the real calendar event has a working Google Meet link", false, "no google_event_id recorded");
  }

  // --- availability reflects the new booking (no double-booking) ---
  const availAfterTurn = await chat(
    business.id,
    `What times are you free on ${dateStr} between 1pm and 6pm UTC?`,
    availTurn.body.sessionId
  );
  const availAfterText = (availAfterTurn.body.replies || []).map((r) => r.content).join(" ").toLowerCase();
  check(
    "availability check after booking no longer offers the now-booked 2pm slot as free",
    !/2\s*(pm|:00\s*pm)?\s*(to|-|–)\s*2:?30\s*(pm)?\s+is\s+(free|open|available)/i.test(availAfterText),
    availAfterText.slice(0, 200)
  );

  // --- reschedule_booking, driven by conversation ---
  const rescheduleTurn = await chat(
    business.id,
    `Actually, can you move my booking to 15:00 to 15:30 UTC on the same day instead?`,
    availTurn.body.sessionId
  );
  check("reschedule request gets a normal (non-blocked) reply", rescheduleTurn.body.blocked === false);

  await sleep(2000);
  const { data: afterReschedule } = await admin.from("bookings").select("*").eq("id", created.id).single();
  check(
    "booking row reflects the new time and status=rescheduled",
    afterReschedule.status === "rescheduled" && afterReschedule.start_time.includes("15:00"),
    JSON.stringify({ status: afterReschedule.status, start_time: afterReschedule.start_time })
  );

  if (created?.google_event_id) {
    const realEventAfterReschedule = await realCalendar.events.get({
      calendarId: business.google_calendar_id,
      eventId: created.google_event_id,
    });
    // Compare actual instants, not substrings -- Google returns the event's
    // start in the calendar's local timezone offset (e.g. +06:00), not "Z",
    // so "15:00 UTC" correctly shows up as "21:00+06:00" and a naive string
    // match on "15:00" is simply wrong, not evidence of a real failure.
    const expectedInstant = new Date(`${dateStr}T15:00:00Z`).getTime();
    const actualInstant = new Date(realEventAfterReschedule.data.start.dateTime).getTime();
    check(
      "the REAL calendar event actually moved to the new time",
      actualInstant === expectedInstant,
      `expected ${new Date(expectedInstant).toISOString()}, got ${new Date(actualInstant).toISOString()} (raw: ${realEventAfterReschedule.data.start.dateTime})`
    );
  } else {
    check("the REAL calendar event actually moved to the new time", false, "no google_event_id recorded");
  }

  // --- cancel_booking, driven by conversation ---
  const cancelTurn = await chat(business.id, `Actually, please cancel that booking instead.`, availTurn.body.sessionId);
  check("cancel request gets a normal (non-blocked) reply", cancelTurn.body.blocked === false);

  await sleep(2000);
  const { data: afterCancel } = await admin.from("bookings").select("status").eq("id", created.id).single();
  check("booking row status is cancelled", afterCancel.status === "cancelled", afterCancel.status);

  if (created?.google_event_id) {
    const realEventAfterCancel = await realCalendar.events.get({
      calendarId: business.google_calendar_id,
      eventId: created.google_event_id,
    });
    check(
      "the REAL calendar event was actually removed (status=cancelled on the real calendar)",
      realEventAfterCancel.data.status === "cancelled",
      realEventAfterCancel.data.status
    );
  } else {
    check("the REAL calendar event was actually removed (status=cancelled on the real calendar)", false, "no google_event_id recorded");
  }
} finally {
  // Clean up: delete the booking row and make sure no real event lingers.
  for (const eventId of createdEventIds) {
    await realCalendar.events.delete({ calendarId: business.google_calendar_id, eventId }).catch(() => {});
  }
  await admin.from("bookings").delete().eq("business_id", business.id).eq("customer_name", "Test Visitor");
  // Also clear the test chat sessions/messages this created.
  const { data: sessions } = await admin.from("chat_sessions").select("id").eq("business_id", business.id);
  for (const s of sessions || []) {
    await admin.from("chat_messages").delete().eq("session_id", s.id);
  }
  await admin.from("chat_sessions").delete().eq("business_id", business.id);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PHASE 4 BOOKING VERIFICATION FAILED");
  process.exit(1);
}
console.log("Phase 4 booking system verified end-to-end against a real Google Calendar.");
