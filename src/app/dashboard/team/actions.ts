"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createAdminClient } from "@/lib/supabase/admin";

export async function inviteStaffMember(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const context = await getCurrentBusinessContext();

  if (!context) redirect("/login");
  if (context.role !== "owner") {
    redirect(`/dashboard/team?error=${encodeURIComponent("Only the business owner can invite staff.")}`);
  }
  if (!email) {
    redirect(`/dashboard/team?error=${encodeURIComponent("Email is required.")}`);
  }

  const admin = createAdminClient();
  const inviteToken = randomUUID();

  const { error } = await admin.from("business_users").insert({
    business_id: context.business.id,
    email,
    role: "staff",
    status: "pending",
    invite_token: inviteToken,
  });

  if (error) {
    // Most likely cause: an invite is already pending for this email
    // (idx_business_users_pending_email).
    redirect(
      `/dashboard/team?error=${encodeURIComponent(
        "Could not invite that email -- they may already be invited or on the team."
      )}`
    );
  }

  redirect(`/dashboard/team?invited=${inviteToken}`);
}
