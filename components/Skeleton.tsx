export function Skeleton({ className = "", height = 20 }: { className?: string; height?: number | string }) {
  return (
    <div
      className={`bg-card2 rounded overflow-hidden relative ${className}`}
      style={{ height }}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer
        bg-gradient-to-r from-transparent via-white/[.03] to-transparent" />
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-border1/40 last:border-b-0">
          <Skeleton className="w-12" height={12} />
          <Skeleton className="w-20" height={28} />
          <Skeleton className="flex-1 max-w-[80px]" height={12} />
          <Skeleton className="w-16" height={12} />
          <Skeleton className="w-16" height={12} />
        </div>
      ))}
    </div>
  );
}
