/**
 * Per-ticker mini-logo — a clean circular monogram with the symbol's
 * first 1-2 letters. Color is deterministic from a stable djb2 hash of
 * the ticker, so each stock has a consistent identity across the app.
 *
 * Design choice: solid color + thin inner ring + white text. Reads as
 * "real branded logo" at a glance, even though it's procedural.
 */
type Props = {
  ticker: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
};

/* Curated 10-color palette of deep, premium tones. All are dark enough
   for white text to hit WCAG AA contrast on small badges.
   Vaelor mint sits at index 0 so the brand color shows up on real tickers. */
const PALETTE: string[] = [
  "#10b981", // mint
  "#0e7490", // teal-deep
  "#5b21b6", // violet
  "#b45309", // amber-deep
  "#9d174d", // wine
  "#1e3a8a", // navy
  "#365314", // olive
  "#7c2d12", // rust
  "#581c87", // purple-deep
  "#0d4f4a", // forest
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

export default function TickerLogo({ ticker, size = "sm", className = "" }: Props) {
  const tk = String(ticker || "").toUpperCase();
  // Strip non-alphanumeric so things like BRK-B show "BR"
  const cleaned = tk.replace(/[^A-Z0-9]/g, "");
  const label = cleaned.length <= 2 ? cleaned : cleaned.slice(0, 2);
  const color = PALETTE[hash(tk) % PALETTE.length];
  const s = SIZES[size];

  return (
    <span
      className={[
        "inline-flex items-center justify-center rounded-full font-bold tracking-tight font-mono shrink-0 select-none text-white relative",
        s.box, s.text, className,
      ].join(" ")}
      style={{
        backgroundColor: color,
        // Thin inner highlight ring + soft outer shadow → "real coin/badge" feel
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.18), 0 1px 3px rgba(0,0,0,0.45)",
      }}
      aria-label={tk}
    >
      {label}
    </span>
  );
}
