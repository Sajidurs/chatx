"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFreshSignup } from "@/lib/auth/fresh-signup";

function fail(message: string): never {
  redirect(`/signup?error=${encodeURIComponent(message)}`);
}

export async function signUp(formData: FormData) {
  const businessName = String(formData.get("businessName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!businessName || !email || !password) fail("All fields are required.");
  if (password.length < 8) fail("Password must be at least 8 characters.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });

  if (error) fail(error.message);
  if (!data.user) fail("Signup failed. Please try again.");

  // Supabase never errors for an email that already has an account (to
  // avoid leaking which emails are registered) -- it just returns a user
  // object that isn't actually a new signup. Proceeding here would attach a
  // stranger's real account as the owner of a new business.
  if (!isFreshSignup(data.user)) {
    fail("This email is already registered. Please log in instead.");
  }

  // The auth user exists immediately even if email confirmation is pending,
  // so the business can be created now rather than waiting on confirmation.
  const admin = createAdminClient();
  const { data: business, error: businessError } = await admin
    .from("businesses")
    .insert({ name: businessName })
    .select("id")
    .single();

  if (businessError) {
    await admin.auth.admin.deleteUser(data.user.id);
    fail("Could not create your business. Please contact support.");
  }

  const { error: memberError } = await admin.from("business_users").insert({
    business_id: business.id,
    email,
    role: "owner",
    auth_user_id: data.user.id,
    status: "accepted",
  });

  if (memberError) {
    await admin.from("businesses").delete().eq("id", business.id);
    await admin.auth.admin.deleteUser(data.user.id);
    fail("Could not set up your account. Please contact support.");
  }

  if (data.session) {
    redirect("/dashboard");
  }
  redirect("/signup/check-email");
}
