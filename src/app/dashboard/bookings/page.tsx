import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-100 text-green-800",
  rescheduled: "bg-blue-100 text-blue-800",
  cancelled: "bg-gray-100 text-gray-600",
};

export default async function BookingsPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, customer_name, customer_contact, start_time, end_time, status")
    .eq("business_id", context.business.id)
    .order("start_time", { ascending: false })
    .limit(200);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Bookings</h1>
        <p className="text-sm text-gray-600">Meetings booked through your assistant.</p>
      </div>

      {(!bookings || bookings.length === 0) && <p className="text-sm text-gray-500">No bookings yet.</p>}

      {bookings && bookings.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium">{b.customer_name}</td>
                  <td className="px-4 py-2 text-gray-600">{b.customer_contact}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {new Date(b.start_time).toLocaleString()} &ndash;{" "}
                    {new Date(b.end_time).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[b.status] || "bg-gray-100 text-gray-600"}`}
                    >
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
