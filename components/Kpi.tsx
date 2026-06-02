export function Kpi({ label, value, sub, color }: {
  label: string; value: string; sub?: string;
  color?: "mint" | "red" | "neutral";
}) {
  const c = color === "mint" ? "text-mint" : color === "red" ? "text-red" : "text-ink";
  return (
    <div className="panel w-full relative overflow-hidden group">
      {/* Subtle accent bar that catches the eye but doesn't shout */}
      <span
        className={[
          "absolute left-0 top-0 bottom-0 w-[2px] rounded-l-xl",
          color === "mint" ? "bg-mint/60" : color === "red" ? "bg-red/60" : "bg-border2",
        ].join(" ")}
      />
      <div className="text-[11px] text-muted font-semibold mb-2 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold tracking-tight leading-none tabular-nums ${c}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-2 font-mono">{sub}</div>}
    </div>
  );
}
