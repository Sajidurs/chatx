// Single-series magnitude bars (messages per month) -- one hue, no
// categorical palette needed since there's only one series being compared
// across time, not several identities being told apart.
export function UsageChart({ months }: { months: { label: string; count: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.count));

  return (
    <div className="flex items-end gap-3 rounded-lg border p-4" style={{ height: "140px" }}>
      {months.map((m) => (
        <div key={m.label} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-gray-800"
              style={{ height: `${Math.max(4, (m.count / max) * 100)}%` }}
              title={`${m.count} messages`}
            />
          </div>
          <span className="text-[11px] text-gray-500">{m.label}</span>
        </div>
      ))}
    </div>
  );
}
