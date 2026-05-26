/**
 * Premium per-ticker badge — gradient background derived from a stable hash
 * of the symbol, so each stock has a consistent "logo" across the entire app.
 *
 * Used in: screener, holdings tables, watchlist, performance, allocation legend.
 * No external API, works for all 546+ tickers, never rate-limited.
 */
type Props = {
  ticker: string;
  size?: "xs" | "sm" | "md" | "lg";
  shape?: "rounded" | "circle";
  className?: string;
};

/* Curated palette — each entry is a {dark, light} gradient pair + a foreground.
   Tuned for the Vaelor dark UI: high enough contrast for body text, deep enough
   to feel premium not pastel. Mint/vaelor green pair sits at index 0 so it's
   the "brand" entry. */
const PALETTE: { from: string; to: string; fg: string }[] = [
  { from: "#34d399", to: "#1f7a52", fg: "#0a1f17" }, // mint → vaelor (brand)
  { from: "#22d3ee", to: "#0e7490", fg: "#062430" }, // cyan
  { from: "#a78bfa", to: "#5b21b6", fg: "#1d0e3a" }, // violet
  { from: "#fbbf24", to: "#a16207", fg: "#3a2705" }, // amber
  { from: "#f472b6", to: "#9d174d", fg: "#3a0a22" }, // magenta
  { from: "#fb923c", to: "#9a3412", fg: "#3a1108" }, // orange
  { from: "#60a5fa", to: "#1e3a8a", fg: "#0a1638" }, // blue
  { from: "#a3e635", to: "#365314", fg: "#0e1d05" }, // lime
  { from: "#fb7185", to: "#9f1239", fg: "#3a0915" }, // rose
  { from: "#5eead4", to: "#115e59", fg: "#082624" }, // teal
  { from: "#c084fc", to: "#6b21a8", fg: "#240a3b" }, // purple
  { from: "#facc15", to: "#854d0e", fg: "#2e1d04" }, // gold
];

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

const SIZES = {
  xs: { box: "w-5 h-5",   text: "text-[7px]"  },
  sm: { box: "w-7 h-7",   text: "text-[9px]"  },
  md: { box: "w-9 h-9",   text: "text-[11px]" },
  lg: { box: "w-12 h-12", text: "text-[14px]" },
};

export default function TickerLogo({ ticker, size = "sm", shape = "rounded", className = "" }: Props) {
  const tk = String(ticker || "").toUpperCase();
  // 1-2 char label; for tickers with hyphens like BRK-B, BF-B, show "BRK"/"BF"
  const cleaned = tk.replace(/[^A-Z0-9]/g, "");
  const label = cleaned.length <= 2 ? cleaned : cleaned.slice(0, 2);
  const palette = PALETTE[hash(tk) % PALETTE.length];
  const s = SIZES[size];
  const round = shape === "circle" ? "rounded-full" : "rounded-lg";

  return (
    <span
      className={[
        "inline-flex items-center justify-center font-bold tracking-tight font-mono shrink-0 select-none relative overflow-hidden",
        s.box, s.text, round, className,
      ].join(" ")}
      style={{
        background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
        color: palette.fg,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.35)",
      }}
      aria-label={`${tk}`}
    >
      {/* Diagonal highlight — gives the badge a "lit" 3D feel */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 45%)",
        }}
      />
      <span className="relative z-10">{label}</span>
    </span>
  );
}
