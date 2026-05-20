"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi } from "lightweight-charts";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type Hover = { o: number; h: number; l: number; c: number; v: number; t: number } | null;

export default function Chart({
  data, height = 380, mode = "area",
}: { data: Candle[]; height?: number; mode?: "area" | "candle" }) {
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [chartMode, setChartMode] = useState<"area" | "candle">(mode);

  useEffect(() => {
    if (!ref.current || data.length < 2) return;
    const up = data[data.length - 1].c >= data[0].c;
    const lineColor = up ? "#34d399" : "#f87171";
    const fillTop   = up ? "rgba(52,211,153,.18)" : "rgba(248,113,113,.18)";
    const fillBot   = "rgba(0,0,0,0)";

    const chart = createChart(ref.current, {
      width: ref.current.clientWidth, height,
      layout: { background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#71717a", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false },
              horzLines: { color: "rgba(38,38,41,.6)", style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: "transparent", textColor: "#71717a" },
      timeScale: { borderColor: "transparent", timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#52525b", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#1b1b1f" },
        horzLine: { color: "#52525b", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#1b1b1f" },
      },
      handleScroll: true, handleScale: true,
    });
    apiRef.current = chart;

    if (chartMode === "candle") {
      const s = chart.addCandlestickSeries({
        upColor: "#34d399", downColor: "#f87171",
        borderUpColor: "#34d399", borderDownColor: "#f87171",
        wickUpColor: "#34d399", wickDownColor: "#f87171",
      });
      s.setData(data.map(c => ({ time: c.t as any, open: c.o, high: c.h, low: c.l, close: c.c })));
    } else {
      const s = chart.addAreaSeries({
        lineColor, lineWidth: 2, topColor: fillTop, bottomColor: fillBot,
        priceLineVisible: false, lastValueVisible: false,
      });
      s.setData(data.map(c => ({ time: c.t as any, value: c.c })));
    }

    // Volume bars at bottom
    const vol = chart.addHistogramSeries({
      color: "rgba(82,82,91,.4)", priceFormat: { type: "volume" },
      priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false,
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(data.map(c => ({ time: c.t as any, value: c.v, color: c.c >= c.o ? "rgba(52,211,153,.35)" : "rgba(248,113,113,.35)" })));

    chart.timeScale().fitContent();

    // Crosshair hover info
    chart.subscribeCrosshairMove(p => {
      if (!p || !p.time || !p.seriesData.size) { setHover(null); return; }
      const allPoints = Array.from(p.seriesData.values()) as any[];
      const main = allPoints[0];
      if (!main) return;
      const candle = data.find(d => d.t === (p.time as number));
      if (!candle) return;
      setHover({ o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v, t: candle.t });
    });

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data, height, chartMode]);

  if (!data.length) return <div className="text-muted text-sm py-12 text-center">No chart data.</div>;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <div className="h-5 text-[11px] font-mono text-ink2 flex items-center gap-4">
          {hover ? (
            <>
              <span>O <span className="text-ink">{hover.o.toFixed(2)}</span></span>
              <span>H <span className="text-mint">{hover.h.toFixed(2)}</span></span>
              <span>L <span className="text-red">{hover.l.toFixed(2)}</span></span>
              <span>C <span className="text-ink">{hover.c.toFixed(2)}</span></span>
              <span>V <span className="text-ink">{fmtV(hover.v)}</span></span>
            </>
          ) : <span className="text-muted">Hover chart for OHLC</span>}
        </div>
        <div className="seg">
          <button onClick={() => setChartMode("area")}
                  className={chartMode === "area" ? "seg-btn-active" : "seg-btn"}>Line</button>
          <button onClick={() => setChartMode("candle")}
                  className={chartMode === "candle" ? "seg-btn-active" : "seg-btn"}>Candle</button>
        </div>
      </div>
      <div ref={ref} style={{ width: "100%", height }} />
    </div>
  );
}

function fmtV(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toString();
}
