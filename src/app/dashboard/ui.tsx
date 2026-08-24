export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-gray-500">{description}</p>
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-2xl border border-gray-100 bg-white p-6 shadow-sm ${className}`}>{children}</div>;
}

// Shown in place of a Pro-only page's real content for a free/starter
// business -- the sidebar already locks the nav entry, but this catches
// anyone landing here directly (a bookmark, a shared link, ⌘K, etc.).
export function UpgradeLock({ feature }: { feature: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-900">{feature} is a Pro plan feature</p>
      <p className="max-w-xs text-sm text-gray-500">Upgrade your plan to unlock this feature.</p>
      <a href="/plans" className="mt-1 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
        View plans
      </a>
    </Card>
  );
}
