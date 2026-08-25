import Link from "next/link";
import { LogoMark } from "../dashboard/logo-mark";

export const authInputClass =
  "rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100";

// Shared premium two-panel shell for login/signup -- a dark visual panel
// with the page's own headline on the left (hidden on small screens, where
// the form alone is the whole page), a clean white form panel on the right.
// The left panel's glow is plain CSS (radial gradients + a faint repeating
// diagonal streak), not an image asset, so there's nothing to ship or swap
// out later.
export function AuthSplitLayout({
  headline,
  subtext,
  children,
}: {
  headline: string;
  subtext: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl md:grid-cols-2">
        <div className="relative hidden flex-col justify-end gap-3 overflow-hidden bg-gray-950 p-10 text-white md:flex">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(60% 50% at 15% 15%, rgba(37,211,102,0.35), transparent 60%), radial-gradient(55% 45% at 85% 80%, rgba(37,211,102,0.22), transparent 60%), repeating-linear-gradient(100deg, rgba(37,211,102,0.07) 0px, rgba(37,211,102,0.07) 2px, transparent 2px, transparent 40px)",
            }}
          />
          <div className="relative flex flex-col gap-3">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">{headline}</h1>
            <p className="text-sm text-gray-300">{subtext}</p>
          </div>
        </div>

        <div className="flex flex-col justify-center gap-6 p-8 sm:p-10">
          <Link href="/" className="flex w-fit items-center gap-2">
            <LogoMark />
            <span className="text-base font-semibold tracking-tight">Falah Chat</span>
          </Link>
          {children}
        </div>
      </div>
    </main>
  );
}
