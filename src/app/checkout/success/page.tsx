import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { stripe } from "@/lib/stripe/client";
import { planForPriceId } from "@/lib/stripe/plans";
import { formatCurrency } from "@/lib/format";

const PLAN_LABELS: Record<string, string> = { free: "Free", starter: "Starter", pro: "Pro" };

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const { session_id: sessionId } = await searchParams;

  // Read the order details straight from Stripe rather than the business
  // row -- the webhook that updates the row can take a moment (or, as found
  // debugging issue #2, might not be wired up at all yet), so this page's
  // accuracy shouldn't depend on that having already landed.
  let planLabel: string | null = null;
  let amount: string | null = null;
  let renewalDate: string | null = null;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription", "subscription.items.data.price"],
      });

      // A session_id is guessable/enumerable -- never trust it without
      // confirming it actually belongs to the business asking to see it.
      if (session.metadata?.business_id === context.business.id && session.subscription) {
        const subscription = typeof session.subscription === "string" ? null : session.subscription;
        const price = subscription?.items.data[0]?.price;
        const plan = price?.id ? planForPriceId(price.id) : undefined;
        planLabel = plan ? PLAN_LABELS[plan] : null;
        if (price?.unit_amount != null) {
          const interval = price.recurring?.interval;
          amount = `${formatCurrency(price.unit_amount, price.currency)}${interval ? ` / ${interval}` : ""}`;
        }
        if (subscription?.items.data[0]?.current_period_end) {
          renewalDate = new Date(subscription.items.data[0].current_period_end * 1000).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
        }
      }
    } catch {
      // Falls through to the generic confirmation below -- an expired,
      // invalid, or unrecognized session_id shouldn't break the page, just
      // means we can't show the specific order details.
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div>
          <h1 className="text-xl font-semibold">Payment confirmed</h1>
          <p className="mt-1 text-sm text-gray-500">Thank you -- your plan is now active.</p>
        </div>

        {planLabel && (
          <div className="flex w-full flex-col gap-2.5 rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Plan</span>
              <span className="font-medium text-gray-900">{planLabel}</span>
            </div>
            {amount && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Amount</span>
                <span className="font-medium text-gray-900">{amount}</span>
              </div>
            )}
            {renewalDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Renews on</span>
                <span className="font-medium text-gray-900">{renewalDate}</span>
              </div>
            )}
          </div>
        )}

        {!planLabel && (
          <p className="text-sm text-gray-500">Your subscription is being processed -- it may take a few seconds to reflect on your dashboard.</p>
        )}

        <Link
          href="/dashboard"
          className="w-full rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
