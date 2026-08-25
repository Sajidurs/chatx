import Link from "next/link";
import { signUp } from "./actions";
import { AuthSplitLayout, authInputClass } from "../auth-split-layout";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthSplitLayout
      headline="Train your AI. Launch in minutes."
      subtext="No developer, no agency -- just your business, your documents, and one line of code."
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Create your account</h2>
        <p className="mt-1 text-sm text-gray-500">Start free. No card required until you&apos;re ready to upgrade.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <form action={signUp} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Business name
          <input name="businessName" type="text" required autoComplete="organization" placeholder="Your business" className={authInputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="you@business.com" className={authInputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className={authInputClass}
          />
        </label>

        <button type="submit" className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-white hover:bg-brand-600">
          Create account
        </button>
      </form>

      <p className="text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
