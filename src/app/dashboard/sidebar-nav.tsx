"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_ITEMS, SETUP_ITEMS } from "./nav-items";

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

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

export function SidebarNav() {
  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3">
      <div className="flex flex-col gap-1">
        <span className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Main</span>
        {MAIN_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Setup</span>
        {SETUP_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </div>
    </nav>
  );
}
