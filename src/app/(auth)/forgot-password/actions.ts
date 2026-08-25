"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  if (!email) redirect(`/forgot-password?error=${encodeURIComponent("Please enter your email address.")}`);

  const supabase = await createClient();
  // Supabase never reveals whether the email actually has an account (same
  // reasoning as signup's isFreshSignup check) -- the response here doesn't
  // depend on the result, so there's nothing to distinguish either way.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
  });

  redirect("/forgot-password?sent=1");
}
