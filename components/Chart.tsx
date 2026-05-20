"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export default function Chart({ data, height = 380 }: { data: Candle[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#4a6654",
        fontFamily: "DM Mono, monospace",
      },
      grid: {
        vertLines: { color: "rgba(22,35,23,.6)" },
        horzLines: { color: "rgba(22,35,23,.6)" },
      },
      rightPriceScale: { borderColor: "#162317" },
      timeScale: { borderColor: "#162317", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "#3ff5a0", downColor: "#ff4d6d",
      borderUpColor: "#3ff5a0", borderDownColor: "#ff4d6d",
      wickUpColor: "#3ff5a0", wickDownColor: "#ff4d6d",
    });
    series.setData(data.map(c => ({
      time: c.t as any, open: c.o, high: c.h, low: c.l, close: c.c,
    })));
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data, height]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
