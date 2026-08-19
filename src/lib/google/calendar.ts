import "server-only";
import { google } from "googleapis";
import { randomUUID } from "crypto";
import { decrypt } from "@/lib/crypto/encryption";
import { resolveToUtcIso } from "@/lib/timezones";

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
  timeZone: string;
}): Promise<{ start: string; end: string }[]> {
  const calendar = calendarClientFor(params.refreshTokenEncrypted);
  const res = await calendar.freebusy.query({
    requestBody: {
      // Unlike events.insert/patch, freebusy.query's timeMin/timeMax do NOT
      // support a bare local wall-clock string interpreted via a sibling
      // `timeZone` field -- confirmed directly against the real API, a bare
      // string here is rejected outright with a 400. So this is resolved to
      // a real UTC instant first, the same conversion used for our own
      // bookings.start_time/end_time (see resolveToUtcIso's doc comment).
      timeMin: resolveToUtcIso(params.startIso, params.timeZone),
      timeMax: resolveToUtcIso(params.endIso, params.timeZone),
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
  timeZone: string;
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
      // The AI is instructed to give a bare local wall-clock datetime with no
      // UTC offset (e.g. "2026-08-20T10:00:00"). Google's Calendar API
      // interprets a dateTime with no offset/"Z" using the sibling `timeZone`
      // field -- this is what makes "10AM" actually mean 10AM in the
      // business's own timezone instead of literal UTC (the bug this fixes).
      start: { dateTime: params.startIso, timeZone: params.timeZone },
      end: { dateTime: params.endIso, timeZone: params.timeZone },
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
  timeZone: string;
}): Promise<void> {
  const calendar = calendarClientFor(params.refreshTokenEncrypted);
  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: params.startIso, timeZone: params.timeZone },
      end: { dateTime: params.endIso, timeZone: params.timeZone },
    },
  });
}
