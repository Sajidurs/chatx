import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resetPassword } from "./actions";
import { AuthSplitLayout, authInputClass } from "../auth-split-layout";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const { code, error } = await searchParams;

  // The reset link from Supabase's email arrives with a one-time code --
  // exchanging it here (same pattern as /auth/callback) establishes the
  // temporary recovery session the form below submits against.
  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      redirect(`/forgot-password?error=${encodeURIComponent("That reset link has expired. Please request a new one.")}`);
    }
    redirect("/reset-password");
  }

  return (
    <AuthSplitLayout headline="Almost there." subtext="Choose a new password to finish resetting your account.">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Set a new password</h2>
        <p className="mt-1 text-sm text-gray-500">Make it something you haven&apos;t used before.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <form action={resetPassword} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          New password
          <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={authInputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Confirm new password
          <input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className={authInputClass} />
        </label>
        <button type="submit" className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-white hover:bg-brand-600">
          Reset password
        </button>
      </form>
    </AuthSplitLayout>
  );
}
