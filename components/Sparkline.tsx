"use client";
import { useEffect, useState } from "react";

export default function Sparkline({
  ticker, height = 28, width = 80,
}: { ticker: string; height?: number; width?: number }) {
  const [data, setData] = useState<number[]>([]);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/chart/${ticker}?range=1mo`)
      .then(r => r.json())
      .then(j => {
        if (cancel) return;
        const closes = (j.data || []).slice(-15).map((c: any) => c.c);
        setData(closes);
      }).catch(() => {});
    return () => { cancel = true; };
  }, [ticker]);

  if (data.length < 2) return <span className="inline-block" style={{ width, height }} />;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const up = data[data.length - 1] >= data[0];
  const color = up ? "#34d399" : "#f87171";
  const pts = data.map((p, i) =>
    `${(i / (data.length - 1)) * width},${height - ((p - min) / rng) * height}`
  ).join(" ");
  const lastX = width, lastY = height - ((data[data.length - 1] - min) / rng) * height;

  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`g-${ticker}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#g-${ticker})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
                strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}
