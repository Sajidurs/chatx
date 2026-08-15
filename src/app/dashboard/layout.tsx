import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold">{context.business.name}</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/dashboard/team">Team</Link>
          <Link href="/plans">Plan</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="underline">
              Log out
            </button>
          </form>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
