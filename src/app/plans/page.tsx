import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, type Plan } from "@/lib/stripe/plans";

const PLAN_ORDER: Plan[] = ["free", "starter", "pro"];

function formatAmount(amountCents: number | null, currency: string) {
  if (amountCents === null) return "Free";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

export default async function PlansPage() {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const prices = await Promise.all(
    PLAN_ORDER.map((plan) => stripe.prices.retrieve(PLAN_PRICE_IDS[plan]))
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Choose a plan</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((plan, i) => {
          const price = prices[i];
          const isCurrent = context.business.plan === plan;
          return (
            <div key={plan} className="flex flex-col gap-3 rounded-lg border p-6">
              <h2 className="text-lg font-semibold capitalize">{plan}</h2>
              <p className="text-2xl font-bold">
                {formatAmount(price.unit_amount, price.currency)}
                {price.unit_amount ? <span className="text-sm font-normal">/mo</span> : null}
              </p>
              <form action="/api/checkout" method="post">
                <input type="hidden" name="plan" value={plan} />
                <button
                  type="submit"
                  disabled={isCurrent}
                  className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isCurrent ? "Current plan" : "Select"}
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </main>
  );
}
