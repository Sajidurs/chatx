import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { planForPriceId } from "@/lib/stripe/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvoiceUpcomingReminder } from "@/lib/email/resend";
import { formatCurrency } from "@/lib/format";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "invoice.upcoming",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const admin = createAdminClient();

  // Idempotency: Stripe can deliver the same event more than once. The
  // insert is the atomic claim -- if two deliveries race, only one wins and
  // the other returns immediately. If processing then throws, the claim is
  // released (row deleted) so a genuine retry can actually finish the job,
  // rather than being silently swallowed as "already processed" forever.
  const { error: claimError } = await admin.from("processed_stripe_events").insert({ event_id: event.id });
  if (claimError) {
    if (claimError.code === "23505") {
      return NextResponse.json({ received: true, alreadyProcessed: true });
    }
    console.error("Failed to claim Stripe event for processing", claimError);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  try {
    await handleEvent(event, admin);
  } catch (err) {
    await admin.from("processed_stripe_events").delete().eq("event_id", event.id);
    console.error(`Failed to process Stripe event ${event.id} (${event.type})`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event, admin: ReturnType<typeof createAdminClient>) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.metadata?.business_id;
      const subscriptionId = session.subscription as string | null;
      if (!businessId || !subscriptionId) return;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId ? planForPriceId(priceId) : undefined;
      if (!plan) return;

      await admin
        .from("businesses")
        .update({
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          plan,
          status: "active",
          past_due_at: null,
        })
        .eq("id", businessId);
      await admin.from("plan_history").insert({ business_id: businessId, plan });
      return;
    }

    case "customer.subscription.updated": {
      // Fires for plan changes made via /api/checkout's in-place subscription
      // update (see that route for why we update rather than create a
      // second subscription), and for any other Stripe-side subscription
      // change. We only act on it when it resolves to one of our known
      // plans and the business already owns this subscription.
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata?.business_id;
      if (!businessId) return;

      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId ? planForPriceId(priceId) : undefined;
      if (!plan) return;

      const { data: business } = await admin
        .from("businesses")
        .select("plan, stripe_subscription_id")
        .eq("id", businessId)
        .single();
      if (!business) return;
      // Allow adopting the subscription id if the business doesn't have one
      // yet (e.g. this update races ahead of checkout.session.completed),
      // but never overwrite with an unrelated subscription's changes.
      if (business.stripe_subscription_id && business.stripe_subscription_id !== subscription.id) return;

      await admin
        .from("businesses")
        .update({ plan, stripe_subscription_id: subscription.id, stripe_customer_id: subscription.customer as string })
        .eq("id", businessId);
      // Only log an actual change -- this event also fires for unrelated
      // subscription edits (e.g. metadata-only updates) that don't change
      // which plan the business is on.
      if (plan !== business.plan) {
        await admin.from("plan_history").insert({ business_id: businessId, plan });
      }
      return;
    }

    case "invoice.upcoming": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id, name")
        .eq("stripe_customer_id", customerId)
        .single();
      if (!business) return;

      const { data: owner } = await admin
        .from("business_users")
        .select("email")
        .eq("business_id", business.id)
        .eq("role", "owner")
        .eq("status", "accepted")
        .single();
      if (!owner) return;

      const amountDue = formatCurrency(invoice.amount_due, invoice.currency);
      const dueDate = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
        : "soon";

      await sendInvoiceUpcomingReminder({
        to: owner.email,
        businessName: business.name,
        amountDue,
        dueDate,
      });
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();
      if (!business) return;

      await admin.from("businesses").update({ status: "active", past_due_at: null }).eq("id", business.id);

      const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
      await admin
        .from("usage_logs")
        .upsert({ business_id: business.id, month, message_count: 0, visitor_count: 0 }, { onConflict: "business_id,month" });
      // The "seen this month" set has to reset alongside the counter --
      // otherwise a visitor who already chatted earlier this same month
      // would keep bypassing the quota check as "already seen" even though
      // the count they'd bypass against just went back to 0.
      await admin.from("monthly_active_visitors").delete().eq("business_id", business.id).eq("month", month);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id, past_due_at")
        .eq("stripe_customer_id", customerId)
        .single();
      if (!business) return;

      await admin
        .from("businesses")
        .update({ status: "past_due", past_due_at: business.past_due_at ?? new Date().toISOString() })
        .eq("id", business.id);
      return;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata?.business_id;
      const customerId = subscription.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id, stripe_subscription_id")
        .eq(businessId ? "id" : "stripe_customer_id", businessId || customerId)
        .single();
      if (!business) return;

      // Only cancel if this is the subscription the business currently has
      // on file -- a customer can end up with a stale/superseded
      // subscription (e.g. from before plan-switching updated in place
      // instead of creating a new one); its cancellation shouldn't lock out
      // a business whose actual current subscription is unaffected.
      if (business.stripe_subscription_id && business.stripe_subscription_id !== subscription.id) return;

      await admin.from("businesses").update({ status: "cancelled" }).eq("id", business.id);
      return;
    }
  }
}
