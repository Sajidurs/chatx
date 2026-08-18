"use client";

import { usePathname } from "next/navigation";

// Keying on the pathname forces React to remount this wrapper on every
// navigation, which restarts the CSS animation below -- a lightweight fade
// + slide-in without pulling in an animation library for one effect.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page-in">
      {children}
    </div>
  );
}
