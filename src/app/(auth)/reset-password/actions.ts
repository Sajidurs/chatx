"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function resetPassword(formData: FormData) {
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (newPassword.length < 8) {
    redirect(`/reset-password?error=${encodeURIComponent("New password must be at least 8 characters.")}`);
  }
  if (newPassword !== confirmPassword) {
    redirect(`/reset-password?error=${encodeURIComponent("New password and confirmation don't match.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message || "Could not reset your password. Please request a new link.")}`);
  }

  redirect("/dashboard");
}
