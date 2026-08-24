import Link from "next/link";
import { SidebarNav } from "@/app/dashboard/sidebar-nav";
import { CommandSearch } from "@/app/dashboard/command-search";
import { LogoMark } from "@/app/dashboard/logo-mark";
import { PageTransition } from "@/app/dashboard/page-transition";

// Shared by both the /dashboard layout and the standalone /plans page --
// /plans lives outside the /dashboard route segment (see CHANGELOG for why
// it wasn't moved under it), so it can't just inherit dashboard/layout.tsx.
// Extracted here once so both places render the exact same shell instead of
// two copies drifting apart.
export function DashboardShell({
  businessName,
  role,
  plan,
  userInitials,
  userAvatarUrl,
  children,
}: {
  businessName: string;
  role: string;
  plan: string;
  userInitials: string;
  userAvatarUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-gray-50 p-3 sm:p-6">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-gray-200/50 blur-3xl" />

      <div className="relative z-10 mx-auto flex h-[calc(100vh-1.5rem)] max-w-[1600px] overflow-hidden rounded-3xl border border-white bg-white shadow-xl sm:h-[calc(100vh-3rem)]">
        <aside className="flex w-64 shrink-0 flex-col border-r border-gray-100 py-5">
          <div className="mb-6 flex items-center gap-2 px-5">
            <LogoMark />
            <span className="text-base font-semibold tracking-tight">Falah Chat</span>
          </div>
          <SidebarNav plan={plan} />
          <div className="mt-6 border-t border-gray-100 px-3 pt-4">
            <form action="/auth/signout" method="post">
              <button type="submit" className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100">
                Log out
              </button>
            </form>
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between gap-6 border-b border-gray-100 px-6">
            <CommandSearch plan={plan} />
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold leading-tight">{businessName}</p>
                <p className="text-xs capitalize leading-tight text-gray-400">{role}</p>
              </div>
              <Link
                href="/dashboard/account"
                aria-label="Your account"
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gray-900 text-xs font-medium text-white"
              >
                {userAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size avatar, not worth next/image's overhead here
                  <img src={userAvatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  userInitials
                )}
              </Link>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    </div>
  );
}
