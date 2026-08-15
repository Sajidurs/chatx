import Link from "next/link";

// Placeholder landing page. The real sales/pricing page is Phase 7 scope
// (system_design.md) -- this just gets founders into the product for now.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold">chatx</h1>
      <p className="text-gray-600">
        Train an AI assistant on your business, connect your calendar, and embed it on your site.
      </p>
      <div className="flex gap-4">
        <Link href="/signup" className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white">
          Sign up
        </Link>
        <Link href="/login" className="rounded-md border px-5 py-2.5 text-sm font-medium">
          Log in
        </Link>
      </div>
    </main>
  );
}
