import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { isBusinessRestricted } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { UsageChart } from "./usage-chart";

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ planUpdated?: string }>;
}) {
  const context = await getCurrentBusinessContext();
  if (!context) return null; // layout already redirects; satisfies TypeScript
  const { planUpdated } = await searchParams;

  const { business } = context;
  const restricted = isBusinessRestricted(business);

  const supabase = await createClient();

  const now = new Date();
  const currentMonth = monthKey(now);
  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
    return monthKey(d);
  });

  const [{ data: usageRows }, { data: planLimit }, { count: bookingsThisMonth }] = await Promise.all([
    supabase
      .from("usage_logs")
      .select("month, message_count")
      .eq("business_id", business.id)
      .in("month", last6Months),
    supabase.from("plan_limits").select("monthly_messages").eq("plan", business.plan).single(),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("created_at", `${currentMonth}-01`),
  ]);

  const usageByMonth = new Map((usageRows ?? []).map((r) => [r.month, r.message_count]));
  const chartMonths = last6Months.map((m) => ({
    label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short" }),
    count: usageByMonth.get(m) ?? 0,
  }));

  const messagesThisMonth = usageByMonth.get(currentMonth) ?? 0;
  const monthlyLimit = planLimit?.monthly_messages ?? null;
  const usagePercent = monthlyLimit ? Math.min(100, (messagesThisMonth / monthlyLimit) * 100) : 0;
  const usageBarColor = usagePercent >= 100 ? "bg-red-600" : usagePercent >= 80 ? "bg-yellow-500" : "bg-green-600";

  return (
    <div className="flex flex-col gap-4">
      {planUpdated && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-green-800">
          Your plan change is being processed. It may take a few seconds to reflect below.
        </div>
      )}

      {restricted && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          Your access is currently restricted due to a payment issue. Please{" "}
          <Link href="/plans" className="underline">
            update your billing
          </Link>{" "}
          to restore access.
        </div>
      )}

      {business.status === "past_due" && !restricted && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-yellow-800">
          There was a problem with your last payment. Please update your billing details soon to
          avoid losing access.
        </div>
      )}

      {business.plan === "free" && business.status === "active" && !business.stripe_subscription_id && (
        <div className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-blue-800">
          You&apos;re on the Free plan.{" "}
          <Link href="/plans" className="underline">
            Upgrade
          </Link>{" "}
          for more messages and booking.
        </div>
      )}

      <h1 className="text-xl font-semibold">Welcome, {business.name}</h1>
      <dl className="grid max-w-sm grid-cols-2 gap-y-2 text-sm">
        <dt className="text-gray-500">Plan</dt>
        <dd className="capitalize">{business.plan}</dd>
        <dt className="text-gray-500">Status</dt>
        <dd className="capitalize">{business.status.replace("_", " ")}</dd>
        <dt className="text-gray-500">Your role</dt>
        <dd className="capitalize">{context.role}</dd>
      </dl>

      <div className="grid max-w-2xl grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs uppercase text-gray-500">Messages this month</p>
          <p className="mt-1 text-2xl font-semibold">
            {messagesThisMonth}
            {monthlyLimit && <span className="text-sm font-normal text-gray-400"> / {monthlyLimit}</span>}
          </p>
          {monthlyLimit ? (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full ${usageBarColor}`} style={{ width: `${usagePercent}%` }} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-400">Unlimited on your plan</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs uppercase text-gray-500">Bookings this month</p>
          <p className="mt-1 text-2xl font-semibold">{bookingsThisMonth ?? 0}</p>
        </div>
      </div>

      <div className="max-w-2xl">
        <p className="mb-2 text-xs uppercase text-gray-500">Messages, last 6 months</p>
        <UsageChart months={chartMonths} />
      </div>
    </div>
  );
}
