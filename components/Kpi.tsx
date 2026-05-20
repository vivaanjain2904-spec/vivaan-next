export function Kpi({ label, value, sub, color }: {
  label: string; value: string; sub?: string;
  color?: "mint" | "red" | "neutral";
}) {
  const c = color === "mint" ? "text-mint" : color === "red" ? "text-red" : "text-ink";
  return (
    <div className="panel flex-1 min-w-[160px]">
      <div className="text-[11px] text-muted font-semibold mb-2">{label}</div>
      <div className={`text-2xl font-bold tracking-tight leading-none ${c}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-2 font-mono">{sub}</div>}
    </div>
  );
}
