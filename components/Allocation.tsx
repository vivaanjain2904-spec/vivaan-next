"use client";
import { fp } from "@/lib/format";
import TickerLogo from "@/components/TickerLogo";

type Slice = { ticker: string; value: number };

/* Mint-anchored palette so the chart reads as "Vaelor" first, then accents.
   Top 4 colors are mint/teal-family (largest holdings get the brand color
   real estate), bottom half drifts through complementary accents. */
const COLORS = [
  "#34d399", // mint (primary)
  "#10b981", // mint-dark
  "#22d3ee", // cyan
  "#0ea5e9", // sky
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#fb923c", // orange
  "#f472b6", // pink
  "#a3e635", // lime
  "#94a3b8", // slate (for Other)
];

/**
 * Apple-Stocks-style donut + side legend with motion + per-ticker badges.
 * Shows top 8 holdings; remainder collapsed into "Other".
 */
export default function Allocation({ slices }: { slices: Slice[] }) {
  if (!slices.length) return null;
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 8);
  const otherVal = sorted.slice(8).reduce((a, s) => a + s.value, 0);
  const all = otherVal > 0 ? [...top, { ticker: "Other", value: otherVal }] : top;

  // Larger SVG with subtle ring shadow behind the donut
  const SIZE = 220;
  const C = SIZE / 2;     // 110
  const R = 92;           // outer radius
  const r = 60;           // inner radius

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
    const isOther = s.ticker === "Other";
    return {
      d: `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}
          L ${ix1} ${iy1} A ${r} ${r} 0 ${large} 0 ${ix0} ${iy0} Z`,
      color: isOther ? COLORS[9] : COLORS[i % (COLORS.length - 1)],
      ticker: s.ticker,
      value: s.value,
      pct: (s.value / total) * 100,
      isOther,
    };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8">
      {/* Donut */}
      <div className="relative flex-shrink-0">
        {/* Soft mint halo behind the donut */}
        <div
          className="absolute inset-0 -m-4 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(52,211,153,0.10), transparent 60%)",
          }}
        />

        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative">
          {/* Background ring */}
          <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#1b1b1f" strokeWidth={R - r} />

          {/* Slices — each fades in with a stagger */}
          {arcs.map((a, i) => (
            <path
              key={i}
              d={a.d}
              fill={a.color}
              className="transition-all duration-200 hover:opacity-90 cursor-default animate-fade-in"
              style={{ animationDelay: `${i * 90}ms`, animationFillMode: "both" }}
            >
              <title>{a.ticker} · {a.pct.toFixed(1)}% · {fp(a.value)}</title>
            </path>
          ))}

          {/* Center label */}
          <text
            x={C}
            y={C - 8}
            textAnchor="middle"
            className="fill-muted text-[10px] font-semibold uppercase tracking-[0.18em]"
            fontFamily="Inter"
          >
            Total
          </text>
          <text
            x={C}
            y={C + 16}
            textAnchor="middle"
            className="fill-ink"
            fontFamily="Inter"
            style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {fp(total)}
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
        {arcs.map((a, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 text-[12px] animate-rise"
            style={{ animationDelay: `${i * 50 + 200}ms`, animationFillMode: "both" }}
          >
            {a.isOther ? (
              <span className="w-7 h-7 rounded-lg bg-card2 border border-border1 flex items-center justify-center text-[9px] font-mono font-bold text-muted shrink-0">
                +
              </span>
            ) : (
              <TickerLogo ticker={a.ticker} size="sm" />
            )}
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: a.color, boxShadow: `0 0 6px ${a.color}80` }}
            />
            <span className="text-ink font-mono font-semibold flex-shrink-0">{a.ticker}</span>
            <span className="text-muted font-mono ml-auto tabular-nums">{a.pct.toFixed(1)}%</span>
            <span className="text-ink2 font-mono w-20 text-right tabular-nums">{fp(a.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
