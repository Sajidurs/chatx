import Link from "next/link";
import { ArrowUpRight, MessagesSquare, CalendarCheck, Gauge } from "lucide-react";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { isBusinessRestricted } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { UsageChart } from "./usage-chart";
import { HighlightCard } from "./highlight-card";

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "text-green-600",
  rescheduled: "text-blue-600",
  cancelled: "text-red-500",
};

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
  const previousMonth = last6Months[4];

  const [
    { data: usageRows },
    { data: planLimit },
    { count: totalConversations },
    { count: totalBookings },
    { count: needsHandoffCount },
    { data: nextBooking },
    { data: recentBookings },
  ] = await Promise.all([
    supabase.from("usage_logs").select("month, message_count").eq("business_id", business.id).in("month", last6Months),
    supabase.from("plan_limits").select("monthly_messages").eq("plan", business.plan).single(),
    supabase.from("chat_sessions").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    supabase
      .from("chat_sessions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("needs_handoff", true),
    supabase
      .from("bookings")
      .select("customer_name, start_time")
      .eq("business_id", business.id)
      .in("status", ["confirmed", "rescheduled"])
      .gte("start_time", now.toISOString())
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id, customer_name, start_time, status")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const usageByMonth = new Map((usageRows ?? []).map((r) => [r.month, r.message_count]));
  const chartMonths = last6Months.map((m) => ({
    label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short" }),
    count: usageByMonth.get(m) ?? 0,
  }));

  const messagesThisMonth = usageByMonth.get(currentMonth) ?? 0;
  const messagesLastMonth = usageByMonth.get(previousMonth) ?? 0;
  const monthlyLimit = planLimit?.monthly_messages ?? null;
  const usagePercent = monthlyLimit ? Math.min(100, (messagesThisMonth / monthlyLimit) * 100) : 0;
  const momChange = messagesLastMonth > 0 ? Math.round(((messagesThisMonth - messagesLastMonth) / messagesLastMonth) * 100) : null;

  const resolutionRate =
    totalConversations && totalConversations > 0
      ? Math.round(((totalConversations - (needsHandoffCount ?? 0)) / totalConversations) * 100)
      : 100;

  return (
    <div className="flex flex-col gap-6">
      {planUpdated && (
        <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-green-800">
          Your plan change is being processed. It may take a few seconds to reflect below.
        </div>
      )}
      {restricted && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          Your access is currently restricted due to a payment issue. Please{" "}
          <Link href="/plans" className="underline">
            update your billing
          </Link>{" "}
          to restore access.
        </div>
      )}
      {business.status === "past_due" && !restricted && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-yellow-800">
          There was a problem with your last payment. Please update your billing details soon to avoid losing access.
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {business.name}</h1>
        <p className="text-sm text-gray-500">Here&apos;s how your assistant is doing.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          bg="bg-amber-50"
          label="Conversations"
          value={totalConversations ?? 0}
          href="/dashboard/conversations"
          icon={<MessagesSquare className="h-4 w-4" />}
        />
        <StatCard
          bg="bg-blue-50"
          label="Bookings"
          value={totalBookings ?? 0}
          href="/dashboard/bookings"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <StatCard
          bg="bg-gray-100"
          label="Resolution rate"
          value={`${resolutionRate}%`}
          href="/dashboard/conversations"
          icon={<Gauge className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col justify-between rounded-2xl bg-gray-900 p-5 text-white">
          <div>
            <p className="text-3xl font-semibold">
              {messagesThisMonth}
              {monthlyLimit && <span className="text-base font-normal text-gray-400"> / {monthlyLimit}</span>}
            </p>
            <p className="text-sm text-gray-300">Messages this month</p>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            {momChange === null
              ? "No data from last month yet"
              : momChange >= 0
                ? `+${momChange}% vs last month`
                : `${momChange}% vs last month`}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border p-5">
          <div>
            <p className="text-3xl font-semibold">{needsHandoffCount ?? 0}</p>
            <p className="text-sm text-gray-500">Conversations needing you</p>
          </div>
          <Link href="/dashboard/conversations" className="mt-4 text-xs font-medium text-gray-500 hover:underline">
            View conversations &rarr;
          </Link>
        </div>

        {business.plan !== "pro" ? (
          <Link
            href="/plans"
            className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-gray-900 to-gray-700 p-5 text-white"
          >
            <div>
              <span className="w-fit rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium">Upgrade</span>
              <p className="mt-2 text-lg font-semibold leading-snug">Switch to Pro for unlimited messages and booking</p>
            </div>
            <ArrowUpRight className="mt-4 h-5 w-5" />
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-2xl border p-5">
            <div>
              <p className="text-3xl font-semibold">{nextBooking ? new Date(nextBooking.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "--"}</p>
              <p className="text-sm text-gray-500">
                {nextBooking ? `Next meeting with ${nextBooking.customer_name}` : "No upcoming bookings"}
              </p>
            </div>
            <Link href="/dashboard/bookings" className="mt-4 text-xs font-medium text-gray-500 hover:underline">
              View bookings &rarr;
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Message volume</p>
              <p className="text-xs text-gray-500">Last 6 months</p>
            </div>
          </div>
          <UsageChart months={chartMonths} />
        </div>

        <div className="rounded-2xl border p-5">
          <p className="mb-3 text-sm font-semibold">Highlights</p>
          <div className="flex flex-col gap-3">
            {(needsHandoffCount ?? 0) > 0 ? (
              <HighlightCard
                tone="warning"
                title="Needs your attention"
                description={`${needsHandoffCount} conversation${needsHandoffCount === 1 ? "" : "s"} the AI couldn't resolve on its own.`}
                href="/dashboard/conversations"
              />
            ) : (
              <HighlightCard tone="good" title="All caught up" description="No conversations currently need your attention." href="/dashboard/conversations" />
            )}

            {monthlyLimit && (
              <HighlightCard
                tone={usagePercent >= 80 ? "warning" : "info"}
                title={usagePercent >= 80 ? "Approaching your limit" : "Usage is healthy"}
                description={`You've used ${Math.round(usagePercent)}% of this month's ${monthlyLimit} messages.`}
                href="/plans"
              />
            )}

            <HighlightCard
              tone="info"
              title={nextBooking ? "Upcoming meeting" : "No upcoming meetings"}
              description={
                nextBooking
                  ? `${nextBooking.customer_name} -- ${new Date(nextBooking.start_time).toLocaleString()}`
                  : "New bookings will show up here."
              }
              href="/dashboard/bookings"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border p-5">
        <p className="mb-3 text-sm font-semibold">Recent bookings</p>
        {(!recentBookings || recentBookings.length === 0) && <p className="text-sm text-gray-500">No bookings yet.</p>}
        {recentBookings && recentBookings.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-gray-400">
              <tr>
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recentBookings.map((b) => (
                <tr key={b.id}>
                  <td className="py-2 font-medium">{b.customer_name}</td>
                  <td className="py-2 text-gray-500">{new Date(b.start_time).toLocaleString()}</td>
                  <td className={`py-2 font-medium capitalize ${STATUS_STYLES[b.status] || "text-gray-500"}`}>&bull; {b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  bg,
  label,
  value,
  href,
  icon,
}: {
  bg: string;
  label: string;
  value: string | number;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col justify-between rounded-2xl ${bg} p-5`}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-4 flex items-end justify-between">
        <span className="text-2xl font-semibold">{value}</span>
        <Link href={href} className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800">
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
