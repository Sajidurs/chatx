import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, isPlan, isPlanUpgrade } from "@/lib/stripe/plans";

export async function POST(request: Request) {
  const context = await getCurrentBusinessContext();
  if (!context) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const formData = await request.formData();
  const plan = String(formData.get("plan") || "");
  if (!isPlan(plan)) {
    return NextResponse.redirect(new URL("/plans", request.url), 303);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  // Already subscribed: change the existing subscription's price instead of
  // creating a second Checkout session. Two independent subscriptions on the
  // same customer would double-bill them, and the webhook would overwrite
  // stripe_subscription_id with the new one, permanently losing track of the
  // old one which would keep renewing. The resulting plan change is applied
  // via the customer.subscription.updated webhook, same as every other
  // billing-state change, rather than writing to the business row here too.
  if (context.business.stripe_subscription_id) {
    const subscription = await stripe.subscriptions.retrieve(context.business.stripe_subscription_id);
    const currentItem = subscription.items.data[0];
    const upgrade = isPlanUpgrade(context.business.plan, plan);

    try {
      await stripe.subscriptions.update(context.business.stripe_subscription_id, {
        items: [{ id: currentItem.id, price: PLAN_PRICE_IDS[plan] }],
        // An upgrade (moving to a pricier plan) bills the prorated
        // difference right now instead of silently rolling it into next
        // month's invoice -- error_if_incomplete means a declined card
        // blocks the plan change outright rather than granting the pricier
        // plan against an unpaid balance. A downgrade only ever produces a
        // credit, never a charge, so it keeps the default behavior of
        // rolling that credit into the next invoice with no payment step.
        proration_behavior: upgrade ? "always_invoice" : "create_prorations",
        ...(upgrade ? { payment_behavior: "error_if_incomplete" } : {}),
        metadata: { business_id: context.business.id },
      });
    } catch (err) {
      const message =
        err instanceof Stripe.errors.StripeError
          ? err.message
          : "Could not charge your card for this upgrade. Please check your payment method and try again.";
      return NextResponse.redirect(new URL(`/plans?error=${encodeURIComponent(message)}`, request.url), 303);
    }

    return NextResponse.redirect(new URL("/dashboard?planUpdated=1", request.url), 303);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: PLAN_PRICE_IDS[plan], quantity: 1 }],
    success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/plans`,
    ...(context.business.stripe_customer_id
      ? { customer: context.business.stripe_customer_id }
      : { customer_email: context.email }),
    metadata: { business_id: context.business.id },
    subscription_data: { metadata: { business_id: context.business.id } },
  });

  return NextResponse.redirect(session.url!, 303);
}
