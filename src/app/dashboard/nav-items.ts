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
  UserCircle,
  Contact,
} from "lucide-react";

export const MAIN_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/leads", label: "Leads", icon: Contact },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: CalendarCheck },
];

export const SETUP_ITEMS = [
  { href: "/dashboard/knowledge", label: "Training", icon: FileText },
  { href: "/dashboard/onboarding", label: "Assistant setup", icon: Bot },
  { href: "/dashboard/test-chat", label: "Test chat", icon: MessageCircleMore },
  { href: "/dashboard/embed", label: "Embed", icon: Code2 },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/plans", label: "Plan", icon: CreditCard },
  { href: "/dashboard/account", label: "Account", icon: UserCircle },
];

export const ALL_NAV_ITEMS = [...MAIN_ITEMS, ...SETUP_ITEMS];
