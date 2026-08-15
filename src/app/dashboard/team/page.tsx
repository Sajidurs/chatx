import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { inviteStaffMember } from "./actions";

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
      <h1 className="text-xl font-semibold">Team</h1>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {inviteLink && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Invite created. Send this link to your new team member:
          <br />
          <code className="break-all">{inviteLink}</code>
        </p>
      )}

      <ul className="flex flex-col gap-2 text-sm">
        {members?.map((member) => (
          <li key={member.id} className="flex justify-between border-b py-2">
            <span>{member.email}</span>
            <span className="capitalize text-gray-500">
              {member.role} · {member.status}
            </span>
          </li>
        ))}
      </ul>

      {context.role === "owner" && (
        <form action={inviteStaffMember} className="flex gap-2">
          <input
            name="email"
            type="email"
            placeholder="staff@example.com"
            required
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Invite
          </button>
        </form>
      )}
    </div>
  );
}
