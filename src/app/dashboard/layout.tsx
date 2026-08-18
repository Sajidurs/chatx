import { redirect } from "next/navigation";
import Link from "next/link";
import { Bell, MessageCircle } from "lucide-react";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "./sidebar-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const supabase = await createClient();
  const { count: needsHandoffCount } = await supabase
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", context.business.id)
    .eq("needs_handoff", true);

  const initials = context.business.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-white py-5">
        <div className="mb-6 flex items-center gap-2 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white">
            <MessageCircle className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">Falah Chat</span>
        </div>
        <SidebarNav />
        <div className="mt-6 border-t px-3 pt-4">
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-white px-6">
          <div>
            <p className="text-sm font-semibold">{context.business.name}</p>
            <p className="text-xs capitalize text-gray-400">{context.role}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard/conversations" className="relative rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Conversations needing attention">
              <Bell className="h-5 w-5" />
              {!!needsHandoffCount && needsHandoffCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                  {needsHandoffCount}
                </span>
              )}
            </Link>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-xs font-medium text-white">
              {initials}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
