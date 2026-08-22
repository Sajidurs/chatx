import Link from "next/link";
import { ArrowUpRight, MessagesSquare, CalendarCheck, Contact } from "lucide-react";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { isBusinessRestricted } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { UsageChartPanel } from "./usage-chart-panel";
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
  const last12Months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
    return monthKey(d);
  });
  const previousMonth = last12Months[10];

  const [
    { data: usageRows },
    { data: planLimit },
    { count: totalConversations },
    { count: totalBookings },
    { count: totalLeads },
    { data: nextBooking },
    { data: recentBookings },
  ] = await Promise.all([
    supabase.from("usage_logs").select("month, message_count").eq("business_id", business.id).in("month", last12Months),
    supabase.from("plan_limits").select("monthly_messages").eq("plan", business.plan).single(),
    supabase.from("chat_sessions").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", business.id),
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
  const chartMonths = last12Months.map((m) => ({
    label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short" }),
    count: usageByMonth.get(m) ?? 0,
  }));

  const messagesThisMonth = usageByMonth.get(currentMonth) ?? 0;
  const messagesLastMonth = usageByMonth.get(previousMonth) ?? 0;
  const monthlyLimit = planLimit?.monthly_messages ?? null;
  const usagePercent = monthlyLimit ? Math.min(100, (messagesThisMonth / monthlyLimit) * 100) : 0;
  const momChange = messagesLastMonth > 0 ? Math.round(((messagesThisMonth - messagesLastMonth) / messagesLastMonth) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      {planUpdated && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-green-800">
          Your plan change is being processed. It may take a few seconds to reflect below.
        </div>
      )}
      {restricted && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          Your access is currently restricted due to a payment issue. Please{" "}
          <Link href="/plans" className="underline">
            update your billing
          </Link>{" "}
          to restore access.
        </div>
      )}
      {business.status === "past_due" && !restricted && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-yellow-800">
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
          icon={<MessagesSquare className="h-5 w-5" />}
        />
        <StatCard
          bg="bg-blue-50"
          label="Bookings"
          value={totalBookings ?? 0}
          href="/dashboard/bookings"
          icon={<CalendarCheck className="h-5 w-5" />}
        />
        <StatCard
          bg="bg-brand-50"
          label="Leads"
          value={totalLeads ?? 0}
          href="/dashboard/leads"
          icon={<Contact className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col justify-between rounded-2xl bg-gray-900 p-6 text-white shadow-sm">
          <div>
            <p className="text-3xl font-semibold">
              {messagesThisMonth}
              {monthlyLimit && <span className="text-base font-normal text-gray-400"> / {monthlyLimit}</span>}
            </p>
            <p className="text-sm text-gray-300">Messages this month</p>
          </div>
          <span
            className={`mt-4 w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
              momChange === null
                ? "bg-white/10 text-gray-300"
                : momChange >= 0
                  ? "bg-green-400/15 text-green-300"
                  : "bg-red-400/15 text-red-300"
            }`}
          >
            {momChange === null ? "No data from last month yet" : momChange >= 0 ? `+${momChange}% vs last month` : `${momChange}% vs last month`}
          </span>
        </div>

        {business.plan !== "pro" ? (
          <Link
            href="/plans"
            className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-brand-600 to-gray-900 p-6 text-white shadow-sm"
          >
            <div>
              <span className="w-fit rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">Upgrade</span>
              <p className="mt-2 text-lg font-semibold leading-snug">Switch to Pro for unlimited messages and booking</p>
            </div>
            <ArrowUpRight className="mt-4 h-5 w-5" />
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div>
              <p className="text-3xl font-semibold">
                {nextBooking ? new Date(nextBooking.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "--"}
              </p>
              <p className="text-sm text-gray-500">{nextBooking ? `Next meeting with ${nextBooking.customer_name}` : "No upcoming bookings"}</p>
            </div>
            <Link href="/dashboard/bookings" className="mt-4 text-xs font-medium text-brand-700 hover:underline">
              View bookings &rarr;
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
          <UsageChartPanel months={chartMonths} />
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm font-semibold">Highlights</p>
          <div className="flex flex-col gap-4">
            {(totalLeads ?? 0) > 0 ? (
              <HighlightCard
                tone="good"
                title="Leads captured"
                description={`${totalLeads} lead${totalLeads === 1 ? "" : "s"} collected so far.`}
                href="/dashboard/leads"
              />
            ) : (
              <HighlightCard tone="info" title="No leads yet" description="Leads collected from your chat's intake form will show up here." href="/dashboard/leads" />
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
                nextBooking ? `${nextBooking.customer_name} -- ${new Date(nextBooking.start_time).toLocaleString()}` : "New bookings will show up here."
              }
              href="/dashboard/bookings"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <p className="mb-4 text-sm font-semibold">Recent bookings</p>
        {(!recentBookings || recentBookings.length === 0) && <p className="text-sm text-gray-500">No bookings yet.</p>}
        {recentBookings && recentBookings.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="pb-3 font-medium">Customer</th>
                <th className="pb-3 font-medium">When</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentBookings.map((b) => (
                <tr key={b.id}>
                  <td className="py-3 font-medium">{b.customer_name}</td>
                  <td className="py-3 text-gray-500">{new Date(b.start_time).toLocaleString()}</td>
                  <td className={`py-3 font-medium capitalize ${STATUS_STYLES[b.status] || "text-gray-500"}`}>&bull; {b.status}</td>
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
    <div className={`flex items-center justify-between gap-3 rounded-2xl ${bg} p-4 shadow-sm`}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/70 text-gray-700">{icon}</div>
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
        </div>
      </div>
      <Link href={href} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700">
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
