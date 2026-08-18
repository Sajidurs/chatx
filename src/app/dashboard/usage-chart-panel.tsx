"use client";

import { useState } from "react";
import { UsageChart } from "./usage-chart";

const RANGES = [3, 6, 12] as const;

export function UsageChartPanel({ months }: { months: { label: string; count: number }[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(6);
  const visible = months.slice(months.length - range);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Message volume</p>
          <p className="text-xs text-gray-500">Last {range} months</p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-gray-100 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {r}mo
            </button>
          ))}
        </div>
      </div>
      <UsageChart months={visible} />
    </div>
  );
}
