import Link from "next/link";
import { logIn } from "./actions";
import { AuthSplitLayout, authInputClass } from "../auth-split-layout";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthSplitLayout
      headline="Your AI front desk, always on."
      subtext="Pick up right where you left off -- conversations, leads, and bookings are all waiting."
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Log in to your account</h2>
        <p className="mt-1 text-sm text-gray-500">Welcome back. Enter your details to get back in.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <form action={logIn} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="you@business.com" className={authInputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Password
          <input name="password" type="password" required autoComplete="current-password" placeholder="********" className={authInputClass} />
        </label>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>

        <button type="submit" className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-white hover:bg-brand-600">
          Log in
        </button>
      </form>

      <p className="text-center text-sm text-gray-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-brand-700 hover:underline">
          Create one
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
