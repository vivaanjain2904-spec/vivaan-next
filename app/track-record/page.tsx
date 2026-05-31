"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Pt = { date: string; strategy: number; spy: number; regime?: string };
type Summary = { strategyReturnPct: number; spyReturnPct: number; alphaPct: number;
  maxDrawdownPct: number; regime?: string; asOf?: string };

export default function TrackRecord() {
  const [pts, setPts] = useState<Pt[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/public/performance").then(r => r.json()).then(j => {
      setPts(j.points || []); setSum(j.summary); setStarted(j.started); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Build an SVG line chart from the two NAV series
  const W = 920, H = 360, P = 36;
  const all = pts.flatMap(p => [p.strategy, p.spy]);
  const min = all.length ? Math.min(...all) : 90;
  const max = all.length ? Math.max(...all) : 110;
  const pad = (max - min) * 0.08 || 2;
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => P + (i / Math.max(pts.length - 1, 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const path = (key: "strategy" | "spy") =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

  return (
    <main style={{minHeight:"100vh",background:"#050809",color:"#f4f8f7",
      fontFamily:"Inter,-apple-system,sans-serif",letterSpacing:"-0.01em"}}>
      <div style={{maxWidth:980,margin:"0 auto",padding:"28px 24px 60px"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:28}}>
          <Link href="/welcome" style={{display:"flex",alignItems:"center",gap:10,textDecoration:"none",color:"#f4f8f7"}}>
            <span style={{width:13,height:13,border:"2px solid #34d39e",transform:"rotate(45deg)",borderRadius:2,display:"inline-block"}}/>
            <span style={{fontWeight:800,letterSpacing:".18em",fontSize:17}}>VAELOR</span>
          </Link>
          <Link href="/welcome" style={{color:"#34d39e",textDecoration:"none",fontWeight:600,fontSize:13}}>← Back</Link>
        </div>

        <div style={{color:"#34d39e",fontSize:11,fontWeight:700,letterSpacing:".24em",textTransform:"uppercase"}}>Live Track Record</div>
        <h1 style={{fontSize:34,fontWeight:800,letterSpacing:"-0.03em",margin:"12px 0 8px",maxWidth:"20ch"}}>
          The strategy vs the S&amp;P 500 — <span style={{color:"#7ee9c2"}}>live, not backtested.</span>
        </h1>
        <p style={{color:"#94a4a1",fontSize:14,lineHeight:1.5,maxWidth:"66ch"}}>
          A real, dated, out-of-sample record of our automated strategy against the market.
          Both lines start at 100 the day tracking began. No hindsight, no cherry-picking.
        </p>

        {loading ? (
          <div style={{marginTop:40,color:"#62716e"}}>Loading…</div>
        ) : !pts.length ? (
          <div style={{marginTop:32,padding:"28px 24px",border:"1px solid #1d2a2d",borderRadius:14,background:"#10171a"}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:6}}>Tracking has just begun.</div>
            <p style={{color:"#94a4a1",fontSize:13,lineHeight:1.5}}>
              The live track record starts accumulating from day one and updates daily.
              Check back soon to watch the strategy compound against the S&amp;P 500 in real time.
            </p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            {sum && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,margin:"26px 0 22px"}}>
                {[
                  {n:`${sum.strategyReturnPct>=0?"+":""}${sum.strategyReturnPct}%`,k:"Strategy return",hot:true},
                  {n:`${sum.spyReturnPct>=0?"+":""}${sum.spyReturnPct}%`,k:"S&P 500 return"},
                  {n:`${sum.alphaPct>=0?"+":""}${sum.alphaPct}%`,k:"Alpha vs market",hot:sum.alphaPct>=0},
                  {n:`${sum.maxDrawdownPct}%`,k:"Max drawdown"},
                ].map((c,i)=>(
                  <div key={i} style={{background:"#10171a",border:"1px solid #1d2a2d",borderRadius:12,padding:"15px 16px"}}>
                    <div style={{fontSize:23,fontWeight:800,color:c.hot?"#7ee9c2":"#f4f8f7",fontVariantNumeric:"tabular-nums"}}>{c.n}</div>
                    <div style={{color:"#94a4a1",fontSize:11,marginTop:5}}>{c.k}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Chart */}
            <div style={{background:"#10171a",border:"1px solid #1d2a2d",borderRadius:14,padding:"18px 14px 10px"}}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
                {[0,0.25,0.5,0.75,1].map((t,i)=>(
                  <line key={i} x1={P} x2={W-P} y1={P+t*(H-2*P)} y2={P+t*(H-2*P)} stroke="#1d2a2d" strokeWidth="1"/>
                ))}
                <path d={path("spy")} fill="none" stroke="#62716e" strokeWidth="2"/>
                <path d={path("strategy")} fill="none" stroke="#34d39e" strokeWidth="2.5"/>
                {pts.length>0 && <>
                  <circle cx={x(pts.length-1)} cy={y(pts[pts.length-1].strategy)} r="3.5" fill="#34d39e"/>
                  <circle cx={x(pts.length-1)} cy={y(pts[pts.length-1].spy)} r="3" fill="#62716e"/>
                </>}
              </svg>
              <div style={{display:"flex",gap:18,padding:"6px 24px 8px",fontSize:12}}>
                <span style={{color:"#34d39e"}}>● Vaelor strategy</span>
                <span style={{color:"#94a4a1"}}>● S&amp;P 500</span>
                {sum?.asOf && <span style={{color:"#62716e",marginLeft:"auto"}}>as of {sum.asOf} · started {started}</span>}
              </div>
            </div>
          </>
        )}

        <p style={{color:"#4f5d5a",fontSize:10.5,lineHeight:1.5,marginTop:22,maxWidth:"80ch"}}>
          Strategy performance shown is the model's live, forward-only track record indexed to 100 at inception;
          it reflects the strategy, not any individual account, and excludes individual taxes, fees, and slippage.
          Past performance does not guarantee future results. For informational purposes only — not investment advice.
        </p>
      </div>
    </main>
  );
}
