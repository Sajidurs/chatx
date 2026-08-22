import { redirect } from "next/navigation";

// Feature hidden for launch -- "we will add these later if needed" (staff
// invites). The real implementation (list members, invite form, accept
// flow) is intact in git history at the commit that added this redirect --
// bringing it back means restoring that version of this file plus
// re-adding the sidebar entry in nav-items.ts, not rebuilding from scratch.
export default function TeamPage() {
  redirect("/dashboard");
}
