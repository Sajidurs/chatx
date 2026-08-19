import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkAvailability,
  createCalendarEvent,
  deleteCalendarEvent,
  patchCalendarEvent,
} from "@/lib/google/calendar";
import { resolveToUtcIso } from "@/lib/timezones";

export const BOOKING_TOOLS: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Check the business's calendar for busy periods within a date range. Use this before offering specific meeting times to a customer, so you don't offer a time that's already taken.",
    input_schema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description:
            "Start of the range to check, as the business's own LOCAL wall-clock date/time, ISO 8601 format WITHOUT a UTC offset or 'Z' suffix (e.g. \"2026-08-20T09:00:00\") -- the business's timezone is applied automatically, never assume or add an offset yourself.",
        },
        end_date: {
          type: "string",
          description:
            "End of the range to check, same local-time-with-no-offset format as start_date (e.g. \"2026-08-20T17:00:00\").",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "create_booking",
    description:
      "Book a meeting on the business's calendar with a Google Meet link attached. Only call this after the customer has agreed on one specific date and time.",
    input_schema: {
      type: "object",
      properties: {
        start_time: {
          type: "string",
          description:
            "Meeting start time, as the business's own LOCAL wall-clock date/time, ISO 8601 format WITHOUT a UTC offset or 'Z' suffix (e.g. \"2026-08-20T10:00:00\" for 10AM local) -- the business's timezone is applied automatically, never assume or add an offset yourself.",
        },
        end_time: {
          type: "string",
          description: "Meeting end time, same local-time-with-no-offset format as start_time.",
        },
        customer_name: { type: "string", description: "The customer's name" },
        customer_contact: { type: "string", description: "The customer's email or phone number" },
      },
      required: ["start_time", "end_time", "customer_name", "customer_contact"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel an existing booking. If the customer doesn't give you a booking ID (they usually won't, in a live chat), omit booking_id -- this automatically cancels the most recent active booking made in this conversation.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: {
          type: "string",
          description: "The booking's ID, only if the customer explicitly provided one",
        },
      },
    },
  },
  {
    name: "reschedule_booking",
    description:
      "Move an existing booking to a new date and time. If the customer doesn't give you a booking ID (they usually won't, in a live chat), omit booking_id -- this automatically reschedules the most recent active booking made in this conversation.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: {
          type: "string",
          description: "The booking's ID, only if the customer explicitly provided one",
        },
        new_start_time: {
          type: "string",
          description:
            "New start time, as the business's own LOCAL wall-clock date/time, ISO 8601 format WITHOUT a UTC offset or 'Z' suffix -- the business's timezone is applied automatically, never assume or add an offset yourself.",
        },
        new_end_time: {
          type: "string",
          description: "New end time, same local-time-with-no-offset format as new_start_time.",
        },
      },
      required: ["new_start_time", "new_end_time"],
    },
  },
];

type BookingBusiness = {
  id: string;
  name: string;
  google_refresh_token: string;
  google_calendar_id: string;
  timezone: string;
};

/**
 * Returns a tool executor closed over one business + chat session. Every
 * lookup is scoped by business_id, not just booking_id -- a booking_id is
 * just a UUID a visitor could guess or reuse, and a business's own chat must
 * never be able to touch another business's calendar events.
 */
export function createBookingToolExecutor(business: BookingBusiness, sessionId: string) {
  const admin = createAdminClient();

  // Resolves which booking a cancel/reschedule call refers to. A live chat
  // customer almost never has a booking ID to quote back -- and Claude
  // itself doesn't reliably retain one across separate turns either, since
  // conversation history is reconstructed from stored message *text*, not
  // raw tool-call data (the booking_id from create_booking's result was
  // never spoken aloud, so it isn't in the history Claude sees next turn).
  // Defaulting to "the most recent active booking in this session" matches
  // how a real customer actually refers to it ("cancel that").
  async function resolveBookingId(explicitId: unknown): Promise<{ id: string } | { error: string }> {
    if (typeof explicitId === "string" && explicitId) {
      const { data } = await admin
        .from("bookings")
        .select("id")
        .eq("id", explicitId)
        .eq("business_id", business.id)
        .single();
      if (!data) return { error: "Booking not found." };
      return { id: data.id };
    }

    const { data } = await admin
      .from("bookings")
      .select("id")
      .eq("business_id", business.id)
      .eq("session_id", sessionId)
      .in("status", ["confirmed", "rescheduled"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return { error: "No active booking found in this conversation to modify." };
    return { id: data.id };
  }

  return async function executeBookingTool(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case "check_availability": {
          const busy = await checkAvailability({
            refreshTokenEncrypted: business.google_refresh_token,
            calendarId: business.google_calendar_id,
            startIso: String(input.start_date),
            endIso: String(input.end_date),
            timeZone: business.timezone,
          });
          return JSON.stringify({ busy });
        }

        case "create_booking": {
          const startIso = String(input.start_time);
          const endIso = String(input.end_time);
          const customerName = String(input.customer_name);
          const customerContact = String(input.customer_contact);

          const { eventId, meetLink } = await createCalendarEvent({
            refreshTokenEncrypted: business.google_refresh_token,
            calendarId: business.google_calendar_id,
            summary: `Meeting with ${customerName}`,
            description: `Booked via ${business.name}'s chat assistant. Contact: ${customerContact}`,
            startIso,
            endIso,
            timeZone: business.timezone,
            attendeeEmail: customerContact.includes("@") ? customerContact : undefined,
          });

          const { data: booking, error } = await admin
            .from("bookings")
            .insert({
              business_id: business.id,
              session_id: sessionId,
              google_event_id: eventId,
              customer_name: customerName,
              customer_contact: customerContact,
              // Stored as a real UTC instant, not the bare local string --
              // see resolveToUtcIso's doc comment for why a bare string can't
              // go straight into a timestamptz column.
              start_time: resolveToUtcIso(startIso, business.timezone),
              end_time: resolveToUtcIso(endIso, business.timezone),
              status: "confirmed",
            })
            .select("id")
            .single();
          if (error) throw error;

          return JSON.stringify({ booking_id: booking.id, meet_link: meetLink, start_time: startIso, end_time: endIso });
        }

        case "cancel_booking": {
          const resolved = await resolveBookingId(input.booking_id);
          if ("error" in resolved) return JSON.stringify(resolved);
          const bookingId = resolved.id;

          const { data: booking } = await admin
            .from("bookings")
            .select("id, google_event_id, status")
            .eq("id", bookingId)
            .eq("business_id", business.id)
            .single();
          if (!booking) return JSON.stringify({ error: "Booking not found." });
          if (booking.status === "cancelled") return JSON.stringify({ error: "Booking is already cancelled." });

          if (booking.google_event_id) {
            await deleteCalendarEvent({
              refreshTokenEncrypted: business.google_refresh_token,
              calendarId: business.google_calendar_id,
              eventId: booking.google_event_id,
            });
          }
          await admin.from("bookings").update({ status: "cancelled" }).eq("id", bookingId).eq("business_id", business.id);
          return JSON.stringify({ cancelled: true });
        }

        case "reschedule_booking": {
          const resolved = await resolveBookingId(input.booking_id);
          if ("error" in resolved) return JSON.stringify(resolved);
          const bookingId = resolved.id;
          const newStartIso = String(input.new_start_time);
          const newEndIso = String(input.new_end_time);

          const { data: booking } = await admin
            .from("bookings")
            .select("id, google_event_id, status")
            .eq("id", bookingId)
            .eq("business_id", business.id)
            .single();
          if (!booking) return JSON.stringify({ error: "Booking not found." });
          if (booking.status === "cancelled") return JSON.stringify({ error: "Cannot reschedule a cancelled booking." });
          if (!booking.google_event_id) return JSON.stringify({ error: "Booking has no calendar event to move." });

          await patchCalendarEvent({
            refreshTokenEncrypted: business.google_refresh_token,
            calendarId: business.google_calendar_id,
            eventId: booking.google_event_id,
            startIso: newStartIso,
            endIso: newEndIso,
            timeZone: business.timezone,
          });
          await admin
            .from("bookings")
            .update({
              start_time: resolveToUtcIso(newStartIso, business.timezone),
              end_time: resolveToUtcIso(newEndIso, business.timezone),
              status: "rescheduled",
            })
            .eq("id", bookingId)
            .eq("business_id", business.id);
          return JSON.stringify({ rescheduled: true, start_time: newStartIso, end_time: newEndIso });
        }

        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    } catch (err) {
      console.error(`Booking tool "${name}" failed`, err);
      return JSON.stringify({
        error: "Something went wrong with the calendar. Please try again or contact the business directly.",
      });
    }
  };
}
