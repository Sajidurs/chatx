import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { planForPriceId } from "@/lib/stripe/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvoiceUpcomingReminder } from "@/lib/email/resend";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
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

  // Idempotency: Stripe can deliver the same event more than once. Checked
  // before processing (so a repeat delivery is a no-op) but only recorded as
  // processed AFTER the switch below completes without throwing -- recording
  // it up front would mean a delivery that fails partway (e.g. the DB update
  // succeeds but the reminder email throws) gets permanently marked done,
  // and Stripe's retry of that same event would be silently swallowed as
  // "already processed" instead of actually finishing the job.
  const { data: existing } = await admin
    .from("processed_stripe_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.metadata?.business_id;
      const subscriptionId = session.subscription as string | null;
      if (!businessId || !subscriptionId) break;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId ? planForPriceId(priceId) : undefined;
      if (!plan) break;

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
      break;
    }

    case "invoice.upcoming": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id, name")
        .eq("stripe_customer_id", customerId)
        .single();
      if (!business) break;

      const { data: owner } = await admin
        .from("business_users")
        .select("email")
        .eq("business_id", business.id)
        .eq("role", "owner")
        .eq("status", "accepted")
        .single();
      if (!owner) break;

      const amountDue = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: invoice.currency,
      }).format(invoice.amount_due / 100);
      const dueDate = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
        : "soon";

      await sendInvoiceUpcomingReminder({
        to: owner.email,
        businessName: business.name,
        amountDue,
        dueDate,
      });
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();
      if (!business) break;

      await admin
        .from("businesses")
        .update({ status: "active", past_due_at: null })
        .eq("id", business.id);

      const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
      await admin
        .from("usage_logs")
        .upsert(
          { business_id: business.id, month, message_count: 0 },
          { onConflict: "business_id,month" }
        );
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: business } = await admin
        .from("businesses")
        .select("id, past_due_at")
        .eq("stripe_customer_id", customerId)
        .single();
      if (!business) break;

      await admin
        .from("businesses")
        .update({ status: "past_due", past_due_at: business.past_due_at ?? new Date().toISOString() })
        .eq("id", business.id);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata?.business_id;
      const customerId = subscription.customer as string;

      const query = businessId
        ? admin.from("businesses").update({ status: "cancelled" }).eq("id", businessId)
        : admin.from("businesses").update({ status: "cancelled" }).eq("stripe_customer_id", customerId);
      await query;
      break;
    }
  }

  // Record success now that processing actually completed. A unique-violation
  // here just means a concurrent duplicate delivery recorded it first, which
  // is fine -- the effect has already been applied either way.
  await admin.from("processed_stripe_events").insert({ event_id: event.id });

  return NextResponse.json({ received: true });
}
