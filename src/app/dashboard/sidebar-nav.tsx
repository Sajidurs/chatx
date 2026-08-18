"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessagesSquare,
  CalendarCheck,
  FileText,
  Bot,
  MessageCircleMore,
  Code2,
  CalendarClock,
  Users,
  CreditCard,
} from "lucide-react";

const MAIN_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: CalendarCheck },
];

const SETUP_ITEMS = [
  { href: "/dashboard/knowledge", label: "Training", icon: FileText },
  { href: "/dashboard/onboarding", label: "Assistant setup", icon: Bot },
  { href: "/dashboard/test-chat", label: "Test chat", icon: MessageCircleMore },
  { href: "/dashboard/embed", label: "Embed", icon: Code2 },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/plans", label: "Plan", icon: CreditCard },
];

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
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"
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
