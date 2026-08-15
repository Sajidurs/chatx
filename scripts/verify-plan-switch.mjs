// One-off verification of two things fixed during code review:
// 1. Selecting a different plan while already subscribed updates the
//    existing Stripe subscription in place (via /api/checkout, driven by a
//    real logged-in browser session) instead of creating a second one.
// 2. customer.subscription.deleted only cancels a business when the deleted
//    subscription actually matches the one currently on file -- a stale/
//    superseded subscription being canceled elsewhere shouldn't lock out a
//    business whose current subscription is unaffected.
//
// Usage: node --env-file=.env.local scripts/verify-plan-switch.mjs
// Requires: npm run dev already running on http://localhost:3000

import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const ownerEmail = `plan-switch-${suffix}@mailinator.com`;
const password = `Test-${suffix}-Aa1!`;
const businessName = `Plan Switch Test ${suffix}`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

async function sendEvent(type, dataObject, idSuffix) {
  const event = {
    id: `evt_test_planswitch_${suffix}_${idSuffix}`,
    object: "event",
    type,
    data: { object: dataObject },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let businessId, stripeCustomerId, stripeSubscriptionId, browser;

try {
  const { data: business } = await admin.from("businesses").insert({ name: businessName }).select("id").single();
  businessId = business.id;

  const { data: createdOwner } = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  await admin
    .from("business_users")
    .insert({ business_id: businessId, email: ownerEmail, role: "owner", auth_user_id: createdOwner.user.id, status: "accepted" });

  const customer = await stripe.customers.create({ email: ownerEmail, name: businessName });
  stripeCustomerId = customer.id;
  const attached = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: attached.id } });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: process.env.STRIPE_PRICE_STARTER }],
    metadata: { business_id: businessId },
  });
  stripeSubscriptionId = subscription.id;

  await admin
    .from("businesses")
    .update({ stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId, plan: "starter", status: "active" })
    .eq("id", businessId);

  // --- Part 1: switching plans via the real UI updates in place ---
  browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', ownerEmail);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");

  await page.goto(`${BASE_URL}/plans`);
  await page.waitForLoadState("networkidle");
  // Click "Select" on the Pro plan card specifically (Starter's button is
  // disabled since it's the current plan).
  await page
    .locator(".rounded-lg.border.p-6")
    .filter({ has: page.getByRole("heading", { name: "pro", exact: true }) })
    .getByRole("button", { name: "Select" })
    .click();
  await page.waitForLoadState("networkidle");

  check("switching plan redirects to dashboard with planUpdated flag", page.url().includes("/dashboard?planUpdated=1"), page.url());

  const subscriptionsForCustomer = await stripe.subscriptions.list({ customer: stripeCustomerId, limit: 10 });
  check(
    "still exactly one subscription on the customer (no duplicate created)",
    subscriptionsForCustomer.data.length === 1,
    `count=${subscriptionsForCustomer.data.length}`
  );

  const updatedSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  check(
    "the existing subscription's price changed to Pro (same subscription id)",
    updatedSubscription.items.data[0].price.id === process.env.STRIPE_PRICE_PRO,
    updatedSubscription.items.data[0].price.id
  );

  // Simulate the resulting customer.subscription.updated webhook (Stripe
  // can't reach localhost to deliver it for real -- see CHANGELOG.md).
  const updatedEvent = await sendEvent(
    "customer.subscription.updated",
    { id: stripeSubscriptionId, object: "subscription", customer: stripeCustomerId, metadata: { business_id: businessId }, items: { data: [{ price: { id: process.env.STRIPE_PRICE_PRO } }] } },
    "updated"
  );
  check("customer.subscription.updated returns 200", updatedEvent.status === 200, JSON.stringify(updatedEvent.body));

  const { data: bizAfterSwitch } = await admin.from("businesses").select("plan, stripe_subscription_id").eq("id", businessId).single();
  check("business.plan updated to pro via the webhook", bizAfterSwitch.plan === "pro", JSON.stringify(bizAfterSwitch));

  // --- Part 2: a stale subscription being deleted elsewhere shouldn't cancel this business ---
  const staleDeleteEvent = await sendEvent(
    "customer.subscription.deleted",
    { id: "sub_some_other_stale_subscription", object: "subscription", customer: stripeCustomerId, metadata: {} },
    "stale-delete"
  );
  check("stale subscription.deleted returns 200 (accepted, but a no-op)", staleDeleteEvent.status === 200, JSON.stringify(staleDeleteEvent.body));

  const { data: bizAfterStaleDelete } = await admin.from("businesses").select("status").eq("id", businessId).single();
  check(
    "business status NOT cancelled by an unrelated/stale subscription's deletion",
    bizAfterStaleDelete.status === "active",
    JSON.stringify(bizAfterStaleDelete)
  );

  // Now delete the ACTUAL current subscription and confirm it DOES cancel.
  const realDeleteEvent = await sendEvent(
    "customer.subscription.deleted",
    { id: stripeSubscriptionId, object: "subscription", customer: stripeCustomerId, metadata: { business_id: businessId } },
    "real-delete"
  );
  check("real subscription.deleted returns 200", realDeleteEvent.status === 200, JSON.stringify(realDeleteEvent.body));
  const { data: bizAfterRealDelete } = await admin.from("businesses").select("status").eq("id", businessId).single();
  check("business status cancelled by its actual current subscription's deletion", bizAfterRealDelete.status === "cancelled", JSON.stringify(bizAfterRealDelete));
} finally {
  if (browser) await browser.close();
  if (stripeSubscriptionId) await stripe.subscriptions.cancel(stripeSubscriptionId).catch(() => {});
  if (stripeCustomerId) await stripe.customers.del(stripeCustomerId).catch(() => {});
  if (businessId) {
    const { data: members } = await admin.from("business_users").select("auth_user_id").eq("business_id", businessId);
    await admin.from("businesses").delete().eq("id", businessId);
    for (const m of members || []) {
      if (m.auth_user_id) await admin.auth.admin.deleteUser(m.auth_user_id);
    }
  }
  for (const s of ["updated", "stale-delete", "real-delete"]) {
    await admin.from("processed_stripe_events").delete().eq("event_id", `evt_test_planswitch_${suffix}_${s}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PLAN SWITCH CHECK FAILED");
  process.exit(1);
}
console.log("Plan switch + stale-subscription safety verified end-to-end.");
