"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { MAIN_ITEMS, SETUP_ITEMS } from "./nav-items";

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  locked,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  locked: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = exact ? pathname === href : pathname.startsWith(href);

  if (locked) {
    // Not a real link -- clicking sends the owner straight to the page
    // that actually unlocks it, rather than into the feature itself. The
    // tooltip is plain CSS (group-hover), no JS state, so it's as cheap as
    // the rest of this nav.
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={() => router.push("/plans")}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-50"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{label}</span>
          <Lock className="h-3.5 w-3.5 shrink-0" />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-max max-w-[200px] -translate-x-1/2 rounded-lg bg-gray-900 px-2.5 py-1.5 text-center text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          Upgrade your plan to use this feature
        </div>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

export function SidebarNav({ plan }: { plan: string }) {
  const isPro = plan === "pro";

  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3">
      <div className="flex flex-col gap-1">
        <span className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Main</span>
        {MAIN_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} locked={!!item.proOnly && !isPro} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Setup</span>
        {SETUP_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} locked={!!item.proOnly && !isPro} />
        ))}
      </div>
    </nav>
  );
}
