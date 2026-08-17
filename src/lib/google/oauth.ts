import "server-only";
import { google } from "googleapis";

// Started with calendar.events (read/write events only, least-privilege),
// but check_availability's freebusy.query call returns 403 "insufficient
// authentication scopes" under that scope alone -- freebusy is gated
// separately from event CRUD. Using the full `calendar` scope instead of
// chasing multiple narrow scopes (calendar.events + calendar.freebusy).
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getGoogleAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    // Forces Google to return a refresh_token even if this business
    // connected before -- without it, a reconnect after disconnecting
    // silently gets no refresh_token on repeat consent.
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const { tokens } = await oauthClient().getToken(code);
  return tokens;
}
