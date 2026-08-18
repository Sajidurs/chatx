// Single-series magnitude bars (messages per month) -- one hue, no
// categorical palette needed since there's only one series being compared
// across time, not several identities being told apart.
export function UsageChart({ months }: { months: { label: string; count: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  const currentIndex = months.length - 1;

  return (
    <div className="flex gap-3 px-1 pt-8 sm:gap-5" style={{ height: "190px" }}>
      {months.map((m, i) => {
        const isCurrent = i === currentIndex;
        return (
          <div key={`${m.label}-${i}`} className="flex flex-1 flex-col items-center gap-2.5">
            <div className="relative flex w-full flex-1 items-end justify-center">
              {isCurrent && (
                <div className="absolute -top-9 flex flex-col items-center">
                  <span className="rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm">{m.count}</span>
                  <span className="mt-0.5 h-2 w-px bg-gray-300" />
                </div>
              )}
              <div
                className={`w-full max-w-9 rounded-full transition-all ${isCurrent ? "bg-brand-500" : "bg-brand-100"}`}
                style={{ height: `${Math.max(6, (m.count / max) * 100)}%` }}
                title={`${m.count} messages`}
              />
            </div>
            <span className={`text-[11px] ${isCurrent ? "font-medium text-gray-700" : "text-gray-400"}`}>{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}
