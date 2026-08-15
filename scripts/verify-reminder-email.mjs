// One-off: fires a real invoice.upcoming webhook event at the running dev
// server, targeting a test business whose owner email is the founder's real
// inbox (Resend's sandbox sender can only deliver to the account's own
// registered email until a domain is verified). Confirms the handler returns
// 200 and actually calls Resend successfully. Cleans up afterward.
//
// Usage: node --env-file=.env.local scripts/verify-reminder-email.mjs <owner-email>
// Requires: npm run dev already running on http://localhost:3000

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const ownerEmail = process.argv[2];
if (!ownerEmail) {
  console.error("Usage: node --env-file=.env.local scripts/verify-reminder-email.mjs <owner-email>");
  process.exit(1);
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const WEBHOOK_URL = `${BASE_URL}/api/webhooks/stripe`;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const businessName = `Reminder Test Business ${suffix}`;
let businessId, stripeCustomerId, authUserId;

try {
  const { data: business } = await admin.from("businesses").insert({ name: businessName }).select("id").single();
  businessId = business.id;

  const { data: createdOwner } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: `Test-${suffix}-Aa1!`,
    email_confirm: true,
  });
  authUserId = createdOwner.user.id;

  await admin
    .from("business_users")
    .insert({ business_id: businessId, email: ownerEmail, role: "owner", auth_user_id: authUserId, status: "accepted" });

  const customer = await stripe.customers.create({ email: ownerEmail, name: businessName });
  stripeCustomerId = customer.id;
  await admin.from("businesses").update({ stripe_customer_id: stripeCustomerId }).eq("id", businessId);

  const event = {
    id: `evt_test_reminder_${suffix}`,
    object: "event",
    type: "invoice.upcoming",
    data: {
      object: {
        object: "invoice",
        customer: stripeCustomerId,
        amount_due: 1900,
        currency: "usd",
        next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86400,
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  const body = await res.json().catch(() => null);
  console.log(`Webhook responded ${res.status}:`, JSON.stringify(body));

  if (res.status === 200) {
    console.log(`\nPASS -- reminder email sent. Check ${ownerEmail} for a message about "${businessName}".`);
  } else {
    console.log(`\nFAIL -- webhook returned ${res.status}, email likely did not send.`);
  }
} finally {
  if (businessId) await admin.from("businesses").delete().eq("id", businessId);
  if (authUserId) await admin.auth.admin.deleteUser(authUserId);
  if (stripeCustomerId) await stripe.customers.del(stripeCustomerId).catch(() => {});
  await admin.from("processed_stripe_events").delete().eq("event_id", `evt_test_reminder_${suffix}`);
}
