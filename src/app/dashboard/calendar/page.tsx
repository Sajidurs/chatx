import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { connectGoogleCalendar, disconnectGoogleCalendar } from "./actions";
import { PageHeader, Card } from "../ui";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; disconnected?: string }>;
}) {
  const { error, connected, disconnected } = await searchParams;
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const isConnected = Boolean(context.business.google_calendar_id);
  const isOwner = context.role === "owner";

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <PageHeader
        title="Calendar"
        description="Connect Google Calendar so your assistant can check availability and book, cancel, or reschedule meetings for real, with a Google Meet link attached."
      />

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {connected && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">Google Calendar connected.</div>
      )}
      {disconnected && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Google Calendar disconnected. Booking tools are now off until you reconnect.
        </div>
      )}

      <Card>
        {isConnected ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-brand-700">&#10003; Connected</span>
            {isOwner && (
              <form action={disconnectGoogleCalendar}>
                <button type="submit" className="rounded-xl border border-gray-200 px-3.5 py-2 text-sm hover:bg-gray-50">
                  Disconnect
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Not connected</span>
            {isOwner ? (
              <form action={connectGoogleCalendar}>
                <button type="submit" className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
                  Connect Google Calendar
                </button>
              </form>
            ) : (
              <span className="text-xs text-gray-400">Only the owner can connect this</span>
            )}
          </div>
        )}
      </Card>

      <p className="text-xs text-gray-500">
        Booking tools also require a plan that includes booking. Check the{" "}
        <a href="/plans" className="font-medium text-brand-700 hover:underline">
          Plan
        </a>{" "}
        page if booking doesn&apos;t seem to be working even after connecting.
      </p>
    </div>
  );
}
