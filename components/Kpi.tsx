export function Kpi({ label, value, sub, color }: {
  label: string; value: string; sub?: string;
  color?: "mint" | "red" | "neutral";
}) {
  const c = color === "mint" ? "text-mint" : color === "red" ? "text-red" : "text-ink";
  const glow = color === "mint" ? "drop-shadow(0 0 14px rgba(63,245,160,.4))"
            : color === "red"  ? "drop-shadow(0 0 14px rgba(255,77,109,.3))" : undefined;
  return (
    <div className="panel-glow flex-1 min-w-[160px] transition-all hover:-translate-y-1 hover:shadow-glow2 relative">
      <div className="text-[10px] uppercase tracking-[.18em] text-muted font-semibold mb-2">
        {label}
      </div>
      <div className={`text-2xl font-extrabold leading-none tracking-tight ${c}`}
           style={glow ? { filter: glow } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-2 font-mono">{sub}</div>}
    </div>
  );
}
