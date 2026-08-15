import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re all set</h1>
      <p className="text-gray-600">
        Your subscription is being processed. It may take a few seconds to reflect on your
        dashboard.
      </p>
      <Link href="/dashboard" className="underline">
        Go to dashboard
      </Link>
    </main>
  );
}
