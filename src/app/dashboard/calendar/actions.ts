"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { getGoogleAuthUrl } from "@/lib/google/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { OAUTH_STATE_COOKIE } from "@/lib/google/oauth-state-cookie";

function fail(message: string): never {
  redirect(`/dashboard/calendar?error=${encodeURIComponent(message)}`);
}

export async function connectGoogleCalendar() {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  if (context.role !== "owner") fail("Only the business owner can connect Google Calendar.");

  // Anti-CSRF: a nonce set in this browser's session before redirecting to
  // Google, and checked on the way back -- proves the callback belongs to
  // the same flow this browser started, not a forged cross-site request
  // carrying someone else's authorization code.
  const nonce = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  redirect(getGoogleAuthUrl(`${context.business.id}.${nonce}`));
}

export async function disconnectGoogleCalendar() {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");
  if (context.role !== "owner") fail("Only the business owner can disconnect Google Calendar.");

  const admin = createAdminClient();
  await admin
    .from("businesses")
    .update({ google_refresh_token: null, google_calendar_id: null })
    .eq("id", context.business.id);

  redirect("/dashboard/calendar?disconnected=1");
}
