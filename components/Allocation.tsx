"use client";
import { fp } from "@/lib/format";

type Slice = { ticker: string; value: number };

const COLORS = [
  "#34d399", "#06b6d4", "#fbbf24", "#a78bfa", "#f472b6",
  "#fb923c", "#60a5fa", "#34d39988", "#06b6d488", "#fbbf2488",
];

/**
 * Apple-Stocks-style donut + side legend.
 * Shows top 8 holdings; remainder collapsed into "Other".
 */
export default function Allocation({ slices }: { slices: Slice[] }) {
  if (!slices.length) return null;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 8);
  const otherVal = sorted.slice(8).reduce((a, s) => a + s.value, 0);
  const all = otherVal > 0 ? [...top, { ticker: "Other", value: otherVal }] : top;

  // SVG arcs
  const R = 70, r = 48, C = 80;
  let cumulative = 0;
  const arcs = all.map((s, i) => {
    const start = cumulative / total;
    cumulative += s.value;
    const end = cumulative / total;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end   * 2 * Math.PI - Math.PI / 2;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const ix0 = C + r * Math.cos(a0), iy0 = C + r * Math.sin(a0);
    const ix1 = C + r * Math.cos(a1), iy1 = C + r * Math.sin(a1);
    const large = (end - start) > 0.5 ? 1 : 0;
    return {
      d: `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}
          L ${ix1} ${iy1} A ${r} ${r} 0 ${large} 0 ${ix0} ${iy0} Z`,
      color: COLORS[i % COLORS.length],
      ticker: s.ticker,
      value: s.value,
      pct: (s.value / total) * 100,
    };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160" className="flex-shrink-0">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} className="transition-opacity hover:opacity-80" />
        ))}
        <text x="80" y="76" textAnchor="middle" className="fill-muted text-[10px]" fontFamily="JetBrains Mono">
          TOTAL
        </text>
        <text x="80" y="92" textAnchor="middle" className="fill-ink text-[13px] font-bold" fontFamily="JetBrains Mono">
          {fp(total)}
        </text>
      </svg>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 w-full">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: a.color }} />
            <span className="text-ink font-mono font-semibold flex-shrink-0">{a.ticker}</span>
            <span className="text-muted font-mono ml-auto">{a.pct.toFixed(1)}%</span>
            <span className="text-ink2 font-mono w-20 text-right">{fp(a.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
