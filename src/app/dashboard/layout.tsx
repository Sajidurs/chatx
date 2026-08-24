import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { getCurrentUserProfile, initialsFor } from "@/lib/auth/current-user-profile";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const profile = await getCurrentUserProfile();

  return (
    <DashboardShell
      businessName={context.business.name}
      role={context.role}
      plan={context.business.plan}
      userInitials={initialsFor(profile?.displayName || profile?.email || context.business.name)}
      userAvatarUrl={profile?.avatarUrl}
    >
      {children}
    </DashboardShell>
  );
}
