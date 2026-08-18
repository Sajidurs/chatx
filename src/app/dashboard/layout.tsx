import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { getCurrentUserProfile, initialsFor } from "@/lib/auth/current-user-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const profile = await getCurrentUserProfile();
  const supabase = await createClient();
  const { count: needsHandoffCount } = await supabase
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", context.business.id)
    .eq("needs_handoff", true);

  return (
    <DashboardShell
      businessName={context.business.name}
      role={context.role}
      needsHandoffCount={needsHandoffCount ?? 0}
      userInitials={initialsFor(profile?.displayName || profile?.email || context.business.name)}
      userAvatarUrl={profile?.avatarUrl}
    >
      {children}
    </DashboardShell>
  );
}
