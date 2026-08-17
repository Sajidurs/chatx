import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@/lib/google/oauth";
import { encrypt } from "@/lib/crypto/encryption";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { OAUTH_STATE_COOKIE } from "@/lib/google/oauth-state-cookie";

function redirectWithError(origin: string, message: string) {
  return NextResponse.redirect(`${origin}/dashboard/calendar?error=${encodeURIComponent(message)}`);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (oauthError) {
    return redirectWithError(origin, "Google sign-in was cancelled.");
  }
  if (!code || !state) {
    return redirectWithError(origin, "Invalid callback request.");
  }

  const [businessId, nonce] = state.split(".");
  if (!businessId || !nonce || nonce !== expectedNonce) {
    return redirectWithError(origin, "Could not verify this request. Please try connecting again.");
  }

  // The nonce proves this callback belongs to the browser session that
  // started it; this proves that session is still the owner of the business
  // named in state (not a different account that happens to share cookies,
  // e.g. after a mid-flow logout/login).
  const context = await getCurrentBusinessContext();
  if (!context || context.business.id !== businessId || context.role !== "owner") {
    return redirectWithError(origin, "Could not verify this request. Please log in as the business owner and try again.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return redirectWithError(
        origin,
        "Google didn't return a long-lived connection. If you've connected before, disconnect first, then reconnect."
      );
    }

    const admin = createAdminClient();
    const { error: dbError } = await admin
      .from("businesses")
      .update({ google_refresh_token: encrypt(tokens.refresh_token), google_calendar_id: "primary" })
      .eq("id", businessId);
    if (dbError) throw dbError;

    return NextResponse.redirect(`${origin}/dashboard/calendar?connected=1`);
  } catch (err) {
    console.error("Google OAuth callback failed", err);
    return redirectWithError(origin, "Could not connect Google Calendar. Please try again.");
  }
}
