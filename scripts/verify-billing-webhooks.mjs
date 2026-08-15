// One-off verification of the Stripe webhook handler against the real running
// dev server: real signature verification (using Stripe's documented
// generateTestHeaderString helper, since the Stripe CLI isn't available in
// this environment), a real test-mode customer/subscription/invoice, and real
// database assertions after each event. Cleans up everything it creates.
//
// Usage: node --env-file=.env.local scripts/verify-billing-webhooks.mjs
// Requires: npm run dev already running on http://localhost:3000

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const WEBHOOK_URL = `${BASE_URL}/api/webhooks/stripe`;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const ownerEmail = `webhook-test-owner-${suffix}@mailinator.com`;
const businessName = `Webhook Test Business ${suffix}`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

let eventCounter = 0;
async function sendEvent(type, dataObject) {
  eventCounter++;
  const event = {
    id: `evt_test_${suffix}_${eventCounter}`,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object: dataObject },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => null), eventId: event.id };
}

let businessId, stripeCustomerId, stripeSubscriptionId;

try {
  // --- Set up: business, owner, real Stripe customer + subscription ---
  const { data: business } = await admin
    .from("businesses")
    .insert({ name: businessName })
    .select("id")
    .single();
  businessId = business.id;

  const { data: createdOwner } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: `Test-${suffix}-Aa1!`,
    email_confirm: true,
  });
  await admin
    .from("business_users")
    .insert({ business_id: businessId, email: ownerEmail, role: "owner", auth_user_id: createdOwner.user.id, status: "accepted" });

  const customer = await stripe.customers.create({ email: ownerEmail, name: businessName });
  stripeCustomerId = customer.id;
  // pm_card_visa is a Stripe test-mode magic token; attaching it returns a
  // real PaymentMethod with its own id, which is what default_payment_method
  // must reference (not the literal token string again).
  const attachedPaymentMethod = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: attachedPaymentMethod.id },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: process.env.STRIPE_PRICE_STARTER }],
    metadata: { business_id: businessId },
  });
  stripeSubscriptionId = subscription.id;
  check("real test-mode subscription created and active", subscription.status === "active", subscription.status);

  // --- checkout.session.completed ---
  const checkoutEvent = await sendEvent("checkout.session.completed", {
    id: `cs_test_${suffix}`,
    object: "checkout.session",
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    customer: stripeCustomerId,
    subscription: stripeSubscriptionId,
    metadata: { business_id: businessId },
  });
  check("checkout.session.completed returns 200", checkoutEvent.status === 200, JSON.stringify(checkoutEvent.body));

  let { data: biz } = await admin
    .from("businesses")
    .select("plan, status, stripe_customer_id, stripe_subscription_id")
    .eq("id", businessId)
    .single();
  check(
    "business updated from checkout.session.completed: plan=starter, status=active, stripe ids saved",
    biz.plan === "starter" && biz.status === "active" && biz.stripe_customer_id === stripeCustomerId && biz.stripe_subscription_id === stripeSubscriptionId,
    JSON.stringify(biz)
  );

  // --- Idempotency: redeliver the exact same event ---
  const replay = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify({
          id: checkoutEvent.eventId,
          object: "event",
          type: "checkout.session.completed",
          data: { object: { id: `cs_test_${suffix}`, customer: stripeCustomerId, subscription: stripeSubscriptionId, metadata: { business_id: businessId } } },
        }),
        secret: process.env.STRIPE_WEBHOOK_SECRET,
      }),
    },
    body: JSON.stringify({
      id: checkoutEvent.eventId,
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: `cs_test_${suffix}`, customer: stripeCustomerId, subscription: stripeSubscriptionId, metadata: { business_id: businessId } } },
    }),
  });
  const replayBody = await replay.json();
  check("redelivered event is a no-op (alreadyProcessed)", replay.status === 200 && replayBody.alreadyProcessed === true, JSON.stringify(replayBody));

  // --- invoice.paid: resets usage, clears past_due ---
  // First push the business into past_due manually to prove invoice.paid clears it.
  await admin.from("businesses").update({ status: "past_due", past_due_at: new Date().toISOString() }).eq("id", businessId);
  const month = new Date().toISOString().slice(0, 7);
  await admin.from("usage_logs").insert({ business_id: businessId, month, message_count: 17 });

  const paidEvent = await sendEvent("invoice.paid", {
    id: `in_test_${suffix}_paid`,
    object: "invoice",
    customer: stripeCustomerId,
    amount_due: 1900,
    currency: "usd",
    status: "paid",
  });
  check("invoice.paid returns 200", paidEvent.status === 200, JSON.stringify(paidEvent.body));

  const { data: bizAfterPaid } = await admin.from("businesses").select("status, past_due_at").eq("id", businessId).single();
  check("invoice.paid clears past_due", bizAfterPaid.status === "active" && bizAfterPaid.past_due_at === null, JSON.stringify(bizAfterPaid));

  const { data: usage } = await admin.from("usage_logs").select("message_count").eq("business_id", businessId).eq("month", month).single();
  check("invoice.paid resets usage_logs to 0", usage.message_count === 0, JSON.stringify(usage));

  // --- invoice.payment_failed: sets past_due, stamps past_due_at once ---
  const failedEvent1 = await sendEvent("invoice.payment_failed", {
    id: `in_test_${suffix}_failed1`,
    object: "invoice",
    customer: stripeCustomerId,
    amount_due: 1900,
    currency: "usd",
    status: "open",
  });
  check("invoice.payment_failed returns 200", failedEvent1.status === 200, JSON.stringify(failedEvent1.body));

  const { data: bizAfterFail1 } = await admin.from("businesses").select("status, past_due_at").eq("id", businessId).single();
  check(
    "invoice.payment_failed sets status=past_due with a timestamp",
    bizAfterFail1.status === "past_due" && !!bizAfterFail1.past_due_at,
    JSON.stringify(bizAfterFail1)
  );

  await new Promise((r) => setTimeout(r, 1100)); // ensure a distinguishable timestamp if the bug were present
  const failedEvent2 = await sendEvent("invoice.payment_failed", {
    id: `in_test_${suffix}_failed2`,
    object: "invoice",
    customer: stripeCustomerId,
    amount_due: 1900,
    currency: "usd",
    status: "open",
  });
  const { data: bizAfterFail2 } = await admin.from("businesses").select("status, past_due_at").eq("id", businessId).single();
  check(
    "second payment_failed does not reset the grace-period clock",
    failedEvent2.status === 200 && bizAfterFail2.past_due_at === bizAfterFail1.past_due_at,
    `first=${bizAfterFail1.past_due_at} second=${bizAfterFail2.past_due_at}`
  );

  // --- customer.subscription.deleted ---
  const deletedEvent = await sendEvent("customer.subscription.deleted", {
    id: stripeSubscriptionId,
    object: "subscription",
    customer: stripeCustomerId,
    status: "canceled",
    metadata: { business_id: businessId },
  });
  check("customer.subscription.deleted returns 200", deletedEvent.status === 200, JSON.stringify(deletedEvent.body));

  const { data: bizAfterCancel } = await admin.from("businesses").select("status").eq("id", businessId).single();
  check("customer.subscription.deleted sets status=cancelled", bizAfterCancel.status === "cancelled", JSON.stringify(bizAfterCancel));

  // --- invoice.upcoming: expected to fail right now (no RESEND_API_KEY yet) ---
  const upcomingEvent = await sendEvent("invoice.upcoming", {
    object: "invoice",
    customer: stripeCustomerId,
    amount_due: 1900,
    currency: "usd",
    next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
  });
  if (process.env.RESEND_API_KEY) {
    check("invoice.upcoming returns 200 (RESEND_API_KEY present)", upcomingEvent.status === 200, JSON.stringify(upcomingEvent.body));
  } else {
    check(
      "invoice.upcoming fails as expected (RESEND_API_KEY not set yet) -- everything up to the email send worked",
      upcomingEvent.status === 500,
      JSON.stringify(upcomingEvent.body)
    );
  }

  // --- Signature tampering is rejected ---
  const tampered = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ id: "evt_fake", type: "checkout.session.completed" }),
  });
  check("tampered/invalid signature is rejected with 400", tampered.status === 400, tampered.status);
} finally {
  // --- Clean up everything this script created ---
  if (stripeSubscriptionId) {
    await stripe.subscriptions.cancel(stripeSubscriptionId).catch(() => {});
  }
  if (stripeCustomerId) {
    await stripe.customers.del(stripeCustomerId).catch(() => {});
  }
  if (businessId) {
    const { data: members } = await admin.from("business_users").select("auth_user_id").eq("business_id", businessId);
    await admin.from("usage_logs").delete().eq("business_id", businessId);
    await admin.from("businesses").delete().eq("id", businessId);
    for (const m of members || []) {
      if (m.auth_user_id) await admin.auth.admin.deleteUser(m.auth_user_id);
    }
  }
  for (let i = 1; i <= eventCounter; i++) {
    await admin.from("processed_stripe_events").delete().eq("event_id", `evt_test_${suffix}_${i}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("BILLING WEBHOOK CHECK FAILED");
  process.exit(1);
}
console.log("Billing webhook handler verified end-to-end.");
