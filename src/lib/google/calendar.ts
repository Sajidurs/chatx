import "server-only";
import { google } from "googleapis";
import { randomUUID } from "crypto";
import { decrypt } from "@/lib/crypto/encryption";

function calendarClientFor(refreshTokenEncrypted: string) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: decrypt(refreshTokenEncrypted) });
  return google.calendar({ version: "v3", auth });
}

export async function checkAvailability(params: {
  refreshTokenEncrypted: string;
  calendarId: string;
  startIso: string;
  endIso: string;
}): Promise<{ start: string; end: string }[]> {
  const calendar = calendarClientFor(params.refreshTokenEncrypted);
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: params.startIso,
      timeMax: params.endIso,
      items: [{ id: params.calendarId }],
    },
  });
  const busy = res.data.calendars?.[params.calendarId]?.busy ?? [];
  return busy.map((b) => ({ start: b.start!, end: b.end! }));
}

export async function createCalendarEvent(params: {
  refreshTokenEncrypted: string;
  calendarId: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendeeEmail?: string;
}): Promise<{ eventId: string; meetLink: string | null }> {
  const calendar = calendarClientFor(params.refreshTokenEncrypted);
  const res = await calendar.events.insert({
    calendarId: params.calendarId,
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startIso },
      end: { dateTime: params.endIso },
      attendees: params.attendeeEmail ? [{ email: params.attendeeEmail }] : undefined,
      conferenceData: { createRequest: { requestId: randomUUID() } },
    },
  });
  return { eventId: res.data.id!, meetLink: res.data.hangoutLink ?? null };
}

export async function deleteCalendarEvent(params: {
  refreshTokenEncrypted: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const calendar = calendarClientFor(params.refreshTokenEncrypted);
  await calendar.events.delete({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "all",
  });
}

export async function patchCalendarEvent(params: {
  refreshTokenEncrypted: string;
  calendarId: string;
  eventId: string;
  startIso: string;
  endIso: string;
}): Promise<void> {
  const calendar = calendarClientFor(params.refreshTokenEncrypted);
  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: params.startIso },
      end: { dateTime: params.endIso },
    },
  });
}
