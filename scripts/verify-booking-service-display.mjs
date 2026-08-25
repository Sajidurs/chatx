// Narrower verification, used because Wallxer's real Google Calendar
// connection has expired (invalid_grant) -- see the founder-facing report.
// This can't drive create_booking through a live conversation right now
// (that call fails before ever reaching our own database, since the real
// Calendar API call happens first), so this instead verifies the half of
// the feature that doesn't depend on Google connectivity: a bookings row
// with `service`/`customer_notes` populated actually renders correctly on
// the owner-facing Bookings page. The AI-tool-call half (does Claude
// reliably supply these fields from a real conversation) is covered by
// verify-booking-service-context.mjs, currently blocked on the same token
// issue -- rerun that once Wallxer's calendar is reconnected.
//
// Usage: node --env-file=.env.local scripts/verify-booking-service-display.mjs
// Requires: npm run dev already running on http://localhost:3000.

import { chromium } from "playwright";
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

const stamp = Date.now();
const email = `booking-display-${stamp}@mailinator.com`;
const password = "TestPassword123!";
const bizName = `Booking Display Co ${stamp}`;

const browser = await chromium.launch();
let ownerUserId, bizId, bookingWithNotesId, bookingNoNotesId;

try {
  const { data: owner } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ownerUserId = owner.user.id;
  const { data: biz } = await admin.from("businesses").insert({ name: bizName, plan: "pro" }).select("id").single();
  bizId = biz.id;
  await admin.from("business_users").insert({ business_id: bizId, email, role: "owner", auth_user_id: ownerUserId, status: "accepted" });

  const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const { data: withNotes } = await admin
    .from("bookings")
    .insert({
      business_id: bizId,
      customer_name: "Jamie Rivera",
      customer_contact: "jamie@example.com",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
      service: "SEO Consultation",
      customer_notes: "Early-stage startup, currently gets almost no organic traffic.",
    })
    .select("id")
    .single();
  bookingWithNotesId = withNotes.id;

  // A booking made before this feature shipped -- service/customer_notes
  // are genuinely null. The page must degrade gracefully, not break.
  const { data: noNotes } = await admin
    .from("bookings")
    .insert({
      business_id: bizId,
      customer_name: "Legacy Customer",
      customer_contact: "legacy@example.com",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
    })
    .select("id")
    .single();
  bookingNoNotesId = noNotes.id;

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");

  await page.goto(`${BASE_URL}/dashboard/bookings`);
  await page.waitForLoadState("networkidle");
  const text = await page.evaluate(() => document.body.innerText);

  // `innerText` reflects rendered text, and the header row is styled with
  // CSS text-transform: uppercase -- so the real DOM text is "Service" but
  // the rendered/visible text (what innerText returns) is "SERVICE".
  check("Bookings page shows a 'Service' column header", /service/i.test(text));
  check("the booked service ('SEO Consultation') is shown for the row that has one", text.includes("SEO Consultation"));
  check(
    "the customer context note is shown for the row that has one",
    text.includes("Early-stage startup, currently gets almost no organic traffic.")
  );
  check("a booking with no service/notes (pre-feature legacy row) still renders without breaking the page", text.includes("Legacy Customer"));
  check("no uncaught client-side errors rendering a mix of old and new booking rows", consoleErrors.length === 0, JSON.stringify(consoleErrors));
} finally {
  await browser.close();
  if (bookingWithNotesId) await admin.from("bookings").delete().eq("id", bookingWithNotesId);
  if (bookingNoNotesId) await admin.from("bookings").delete().eq("id", bookingNoNotesId);
  if (bizId) {
    await admin.from("business_users").delete().eq("business_id", bizId);
    await admin.from("businesses").delete().eq("id", bizId);
  }
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("BOOKING SERVICE DISPLAY VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: the Bookings page correctly displays service/customer-notes when present and degrades gracefully for older rows without them.");
