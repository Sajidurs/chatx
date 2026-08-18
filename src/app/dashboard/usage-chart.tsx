// Single-series magnitude bars (messages per month) -- one hue, no
// categorical palette needed since there's only one series being compared
// across time, not several identities being told apart.
export function UsageChart({ months }: { months: { label: string; count: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  const currentIndex = months.length - 1;

  return (
    <div className="flex gap-4 px-2" style={{ height: "180px" }}>
      {months.map((m, i) => {
        const isCurrent = i === currentIndex;
        return (
          <div key={m.label} className="flex flex-1 flex-col items-center gap-2">
            <div className="relative flex w-full flex-1 items-end justify-center">
              {isCurrent && (
                <span className="absolute -top-6 rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white">
                  {m.count}
                </span>
              )}
              <div
                className={`w-full max-w-8 rounded-full ${isCurrent ? "bg-violet-500" : "bg-violet-200"}`}
                style={{ height: `${Math.max(6, (m.count / max) * 100)}%` }}
                title={`${m.count} messages`}
              />
            </div>
            <span className="text-[11px] text-gray-400">{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}
