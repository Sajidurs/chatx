import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { connectGoogleCalendar, disconnectGoogleCalendar } from "./actions";

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
    <div className="flex max-w-lg flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Calendar</h1>
        <p className="text-sm text-gray-600">
          Connect Google Calendar so your assistant can check availability and book, cancel,
          or reschedule meetings for real, with a Google Meet link attached.
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {connected && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Google Calendar connected.
        </p>
      )}
      {disconnected && (
        <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Google Calendar disconnected. Booking tools are now off until you reconnect.
        </p>
      )}

      <div className="rounded-lg border p-4">
        {isConnected ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-700">✓ Connected</span>
            {isOwner && (
              <form action={disconnectGoogleCalendar}>
                <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">
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
                <button
                  type="submit"
                  className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
                >
                  Connect Google Calendar
                </button>
              </form>
            ) : (
              <span className="text-xs text-gray-400">Only the owner can connect this</span>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Booking tools also require a plan that includes booking. Check the{" "}
        <a href="/plans" className="underline">
          Plan
        </a>{" "}
        page if booking doesn&apos;t seem to be working even after connecting.
      </p>
    </div>
  );
}
