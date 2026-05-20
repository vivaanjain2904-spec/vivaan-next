export const fp = (v?: number | null) =>
  typeof v === "number" && isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "—";

export const fpp = (v?: number | null) =>
  typeof v === "number" && isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—";

export const fmtVol = (v?: number | null) => {
  if (!v) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString();
};

export const fmtCap = (v?: number | null) => {
  if (!v) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
};

export const clr = (v: number) => (v >= 0 ? "text-mint" : "text-red");
