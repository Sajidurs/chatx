import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, UpgradeLock } from "../ui";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-brand-100 text-brand-700",
  rescheduled: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-100 text-gray-600",
};

export default async function BookingsPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  if (context.business.plan !== "pro") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Bookings" description="Meetings booked through your assistant." />
        <UpgradeLock feature="Bookings" />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, customer_name, customer_contact, start_time, end_time, status, service, customer_notes")
    .eq("business_id", context.business.id)
    .order("start_time", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bookings" description="Meetings booked through your assistant." />

      {(!bookings || bookings.length === 0) && (
        <Card>
          <p className="text-sm text-gray-500">No bookings yet.</p>
        </Card>
      )}

      {bookings && bookings.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="pb-3 font-medium">Customer</th>
                <th className="pb-3 font-medium">Contact</th>
                <th className="pb-3 font-medium">Service</th>
                <th className="pb-3 font-medium">When</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="max-w-[220px] py-3 pr-4 align-top">
                    <p className="font-medium">{b.customer_name}</p>
                    {b.customer_notes && <p className="mt-0.5 text-xs text-gray-500">{b.customer_notes}</p>}
                  </td>
                  <td className="py-3 pr-4 align-top text-gray-500">{b.customer_contact}</td>
                  <td className="py-3 pr-4 align-top text-gray-500">{b.service || "—"}</td>
                  <td className="py-3 pr-4 align-top text-gray-500">
                    {new Date(b.start_time).toLocaleString()} &ndash; {new Date(b.end_time).toLocaleTimeString()}
                  </td>
                  <td className="py-3 align-top">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[b.status] || "bg-gray-100 text-gray-600"}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
