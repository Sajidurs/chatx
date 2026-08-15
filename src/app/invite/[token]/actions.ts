"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite, findPendingInvite } from "@/lib/auth/accept-invite";

function fail(token: string, message: string): never {
  redirect(`/invite/${token}?error=${encodeURIComponent(message)}`);
}

// For a visitor who does not have an account yet: creates one, then accepts.
export async function acceptInviteViaSignup(formData: FormData) {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");

  const invite = await findPendingInvite(token);
  if (!invite) fail(token, "This invite is invalid or has already been used.");
  if (password.length < 8) fail(token, "Password must be at least 8 characters.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: invite.email,
    password,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      fail(token, "You already have an account with this email. Log in, then revisit this link.");
    }
    fail(token, error.message);
  }
  if (!data.user) fail(token, "Signup failed. Please try again.");

  const { accepted } = await acceptInvite(token, data.user.id);
  if (!accepted) fail(token, "This invite is invalid or has already been used.");

  if (data.session) redirect("/dashboard");
  redirect("/signup/check-email");
}

// For a visitor already logged in as the invited email.
export async function acceptInviteViaSession(formData: FormData) {
  const token = String(formData.get("token") || "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const invite = await findPendingInvite(token);
  if (!invite) fail(token, "This invite is invalid or has already been used.");
  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    fail(token, `This invite is for ${invite.email}, but you're logged in as ${user.email}.`);
  }

  const { accepted } = await acceptInvite(token, user.id);
  if (!accepted) fail(token, "This invite is invalid or has already been used.");

  redirect("/dashboard");
}
