import Link from "next/link";
import { LogoMark } from "./dashboard/logo-mark";

// Still a lightweight placeholder -- the real sales/pricing page is Phase 7
// scope (system_design.md). Real branding + privacy/terms links added now
// specifically because Google's OAuth verification process checks that the
// app's public homepage identifies the app and links to its privacy policy.
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex flex-1 max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="text-xl font-semibold tracking-tight">Falah Chat</span>
        </div>
        <p className="text-gray-600">
          Train an AI assistant on your business, connect your calendar, and embed it on your site.
        </p>
        <div className="flex gap-4">
          <Link href="/signup" className="rounded-md bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
            Sign up
          </Link>
          <Link href="/login" className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-gray-50">
            Log in
          </Link>
        </div>
      </main>
      <footer className="flex justify-center gap-6 py-6 text-xs text-gray-500">
        <Link href="/privacy" className="hover:text-gray-700 hover:underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-gray-700 hover:underline">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}
