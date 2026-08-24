import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { getCurrentUserProfile, initialsFor } from "@/lib/auth/current-user-profile";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, type Plan } from "@/lib/stripe/plans";
import { formatCurrency } from "@/lib/format";
import { DashboardShell } from "@/components/dashboard-shell";

const PLAN_ORDER: Plan[] = ["free", "starter", "pro"];

// Mirrors plan_limits + what's actually plan-gated in the code (only
// message quota and booking are) -- not marketing copy invented for this
// page.
const PLAN_FEATURES: Record<Plan, string[]> = {
  free: ["Custom-trained AI assistant", "Embeddable website widget", "20 messages/month", "No Google Calendar booking"],
  starter: ["Custom-trained AI assistant", "Embeddable website widget", "1,000 messages/month", "No Google Calendar booking"],
  pro: ["Custom-trained AI assistant", "Embeddable website widget", "Unlimited messages", "Google Calendar booking with Google Meet links"],
};

export default async function PlansPage() {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const profile = await getCurrentUserProfile();

  const prices = await Promise.all(PLAN_ORDER.map((plan) => stripe.prices.retrieve(PLAN_PRICE_IDS[plan])));

  return (
    <DashboardShell
      businessName={context.business.name}
      role={context.role}
      plan={context.business.plan}
      userInitials={initialsFor(profile?.displayName || profile?.email || context.business.name)}
      userAvatarUrl={profile?.avatarUrl}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a plan</h1>
          <p className="text-sm text-gray-500">You&apos;re currently on the {context.business.plan} plan.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLAN_ORDER.map((plan, i) => {
            const price = prices[i];
            const isCurrent = context.business.plan === plan;
            const isPro = plan === "pro";
            return (
              <div
                key={plan}
                className={`flex flex-col gap-4 rounded-2xl p-6 shadow-sm ${
                  isPro ? "bg-gradient-to-br from-brand-600 to-gray-900 text-white" : "border border-gray-100 bg-white"
                }`}
              >
                <div>
                  <h2 className="text-lg font-semibold capitalize">{plan}</h2>
                  <p className="text-2xl font-bold">
                    {price.unit_amount === null ? "Free" : formatCurrency(price.unit_amount, price.currency)}
                    {price.unit_amount ? <span className="text-sm font-normal opacity-70">/mo</span> : null}
                  </p>
                </div>

                <ul className="flex flex-1 flex-col gap-2 text-sm">
                  {PLAN_FEATURES[plan].map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isPro ? "text-white" : "text-brand-600"}`} />
                      <span className={isPro ? "text-white/90" : "text-gray-600"}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <form action="/api/checkout" method="post">
                  <input type="hidden" name="plan" value={plan} />
                  <button
                    type="submit"
                    disabled={isCurrent}
                    className={`w-full rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${
                      isPro ? "bg-white text-gray-900 hover:bg-gray-100" : "bg-brand-500 text-white hover:bg-brand-600"
                    }`}
                  >
                    {isCurrent ? "Current plan" : "Select"}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
