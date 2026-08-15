import { NextResponse } from "next/server";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, isPlan } from "@/lib/stripe/plans";

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
