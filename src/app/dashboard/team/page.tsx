import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { inviteStaffMember } from "./actions";
import { PageHeader, Card } from "../ui";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  const { error, invited } = await searchParams;
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("business_users")
    .select("id, email, role, status")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: true });

  const inviteLink = invited ? `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invited}` : null;

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <PageHeader title="Team" description="Everyone with access to this business's dashboard." />

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {inviteLink && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          Invite created. Send this link to your new team member:
          <br />
          <code className="break-all">{inviteLink}</code>
        </div>
      )}

      <Card className="!p-2">
        <ul className="flex flex-col divide-y divide-gray-50 text-sm">
          {members?.map((member) => (
            <li key={member.id} className="flex justify-between px-4 py-3">
              <span className="font-medium">{member.email}</span>
              <span className="capitalize text-gray-500">
                {member.role} &middot; {member.status}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {context.role === "owner" && (
        <form action={inviteStaffMember} className="flex gap-2">
          <input
            name="email"
            type="email"
            placeholder="staff@example.com"
            required
            className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <button type="submit" className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
            Invite
          </button>
        </form>
      )}
    </div>
  );
}
