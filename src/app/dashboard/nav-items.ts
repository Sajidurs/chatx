import {
  LayoutDashboard,
  MessagesSquare,
  CalendarCheck,
  FileText,
  Bot,
  MessageCircleMore,
  Code2,
  CalendarClock,
  CreditCard,
  UserCircle,
  Contact,
} from "lucide-react";

// Bookings and Calendar require the Pro plan (the only plan with
// plan_limits.booking_enabled -- see system_design.md section 4, "Plans").
// Marked here so the sidebar can render a locked state instead of hiding
// them outright -- a free/starter owner should see the feature exists and
// what unlocks it, not wonder why it's missing.
export const MAIN_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/leads", label: "Leads", icon: Contact },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: CalendarCheck, proOnly: true },
];

export const SETUP_ITEMS = [
  { href: "/dashboard/knowledge", label: "Training", icon: FileText },
  { href: "/dashboard/onboarding", label: "Assistant setup", icon: Bot },
  { href: "/dashboard/test-chat", label: "Test chat", icon: MessageCircleMore },
  { href: "/dashboard/embed", label: "Embed", icon: Code2 },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarClock, proOnly: true },
  { href: "/plans", label: "Plan", icon: CreditCard },
  { href: "/dashboard/account", label: "Account", icon: UserCircle },
];

export const ALL_NAV_ITEMS = [...MAIN_ITEMS, ...SETUP_ITEMS];
