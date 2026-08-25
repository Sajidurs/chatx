import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { AuthSplitLayout, authInputClass } from "../auth-split-layout";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  return (
    <AuthSplitLayout
      headline="Locked out happens to everyone."
      subtext="We'll send a reset link to your email -- you'll be back in within a minute."
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Reset your password</h2>
        <p className="mt-1 text-sm text-gray-500">Enter the email on your account and we&apos;ll send you a reset link.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
      {sent && (
        <p className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">
          If an account exists for that email, a reset link is on its way.
        </p>
      )}

      <form action={requestPasswordReset} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="you@business.com" className={authInputClass} />
        </label>
        <button type="submit" className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-white hover:bg-brand-600">
          Send reset link
        </button>
      </form>

      <p className="text-center text-sm text-gray-500">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
