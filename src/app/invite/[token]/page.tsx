import { createClient } from "@/lib/supabase/server";
import { findPendingInvite } from "@/lib/auth/accept-invite";
import { acceptInviteViaSession, acceptInviteViaSignup } from "./actions";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const invite = await findPendingInvite(token);

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-semibold">Invite not found</h1>
        <p className="text-gray-600">This invite is invalid or has already been used.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const loggedInAsMatchingUser = user && user.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Join {invite.businessName}</h1>
      <p className="text-gray-600">
        You&apos;ve been invited to join <strong>{invite.businessName}</strong> as staff, using{" "}
        {invite.email}.
      </p>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loggedInAsMatchingUser ? (
        <form action={acceptInviteViaSession}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Accept invite
          </button>
        </form>
      ) : (
        <form action={acceptInviteViaSignup} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <label className="flex flex-col gap-1 text-sm">
            Choose a password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Create account and join
          </button>
          <p className="text-xs text-gray-500">
            Already have an account with this email? Log in, then revisit this link.
          </p>
        </form>
      )}
    </main>
  );
}
