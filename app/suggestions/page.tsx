"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Sug = {
  side: "BUY" | "SELL"; ticker: string; qty: number; price: number;
  reason: string; stop_loss?: number; take_profit?: number; targetWeightPct?: number;
};

export default function Suggestions() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const j = await fetch("/api/suggestions").then(r => r.json()).catch(() => null);
    setData(j); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function approve(s: Sug) {
    const id = `${s.side}-${s.ticker}`;
    setBusy(id);
    const body: any = { side: s.side, ticker: s.ticker, qty: s.qty };
    if (s.side === "BUY") {
      if (s.stop_loss) body.stop_loss = (s.price - s.stop_loss) / s.price;
      if (s.take_profit) body.take_profit = (s.take_profit - s.price) / s.price;
    }
    const r = await fetch("/api/trade", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setDone(d => ({ ...d, [id]: r.ok ? "done" : (j.error || "failed") }));
    setBusy(null);
  }

  const sugs: Sug[] = data?.suggestions ?? [];

  return (
    <main style={{minHeight:"100vh",background:"#050809",color:"#f4f8f7",
      fontFamily:"Inter,-apple-system,sans-serif",letterSpacing:"-0.01em"}}>
      <div style={{maxWidth:760,margin:"0 auto",padding:"26px 22px 60px"}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <Link href="/overview" style={{display:"flex",alignItems:"center",gap:10,textDecoration:"none",color:"#f4f8f7"}}>
            <span style={{width:13,height:13,border:"2px solid #34d39e",transform:"rotate(45deg)",borderRadius:2}}/>
            <span style={{fontWeight:800,letterSpacing:".18em",fontSize:16}}>VAELOR</span>
          </Link>
          <Link href="/overview" style={{color:"#34d39e",textDecoration:"none",fontWeight:600,fontSize:13}}>← Dashboard</Link>
        </div>

        <div style={{color:"#34d39e",fontSize:11,fontWeight:700,letterSpacing:".22em",textTransform:"uppercase"}}>Recommended Trades</div>
        <h1 style={{fontSize:27,fontWeight:800,letterSpacing:"-0.03em",margin:"10px 0 6px"}}>You review. You approve. You stay in control.</h1>
        <p style={{color:"#94a4a1",fontSize:13.5,lineHeight:1.5,maxWidth:"60ch"}}>
          The strategy suggests these moves with recommended entry, stop-loss, and take-profit prices.
          Nothing executes until <b style={{color:"#f4f8f7"}}>you</b> approve it.
        </p>

        {loading ? (
          <div style={{marginTop:34,color:"#62716e"}}>Loading suggestions…</div>
        ) : !sugs.length ? (
          <div style={{marginTop:28,padding:"24px",border:"1px solid #1d2a2d",borderRadius:14,background:"#10171a"}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>You're already aligned with the strategy.</div>
            <p style={{color:"#94a4a1",fontSize:13}}>No recommended changes right now. Check back after the next monthly rebalance.</p>
          </div>
        ) : (
          <>
            <div style={{display:"flex",gap:16,margin:"20px 0 14px",fontSize:12,color:"#94a4a1"}}>
              <span>As of <b style={{color:"#f4f8f7"}}>{String(data.asOf).slice(0,10)}</b></span>
              <span>Regime <b style={{color:data.regime==="risk_on"?"#34d39e":"#e8c069"}}>{data.regime}</b></span>
              <span>{data.counts.buy} buys · {data.counts.sell} sells</span>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {sugs.map((s) => {
                const id = `${s.side}-${s.ticker}`;
                const st = done[id];
                const isBuy = s.side === "BUY";
                return (
                  <div key={id} style={{background:"#10171a",border:"1px solid #1d2a2d",borderRadius:12,
                    padding:"14px 16px",display:"flex",alignItems:"center",gap:14}}>
                    <div style={{minWidth:54}}>
                      <span style={{fontSize:10,fontWeight:800,letterSpacing:".08em",padding:"3px 8px",borderRadius:6,
                        color:isBuy?"#04130d":"#fff",background:isBuy?"#34d39e":"#c0473f"}}>{s.side}</span>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:15}}>
                        {s.qty} {s.ticker} <span style={{color:"#94a4a1",fontWeight:500,fontSize:13}}>@ ~${s.price.toFixed(2)}</span>
                      </div>
                      <div style={{color:"#94a4a1",fontSize:11.5,marginTop:3,lineHeight:1.4}}>{s.reason}</div>
                      {isBuy && s.stop_loss && (
                        <div style={{fontSize:11,marginTop:4,color:"#7d8c89"}}>
                          Suggested exit: <span style={{color:"#c0473f"}}>stop ${s.stop_loss}</span> · <span style={{color:"#34d39e"}}>target ${s.take_profit}</span>
                        </div>
                      )}
                    </div>
                    <div style={{minWidth:96,textAlign:"right"}}>
                      {st === "done" ? (
                        <span style={{color:"#34d39e",fontSize:12,fontWeight:700}}>✓ Executed</span>
                      ) : st ? (
                        <span style={{color:"#c0473f",fontSize:11}}>{st}</span>
                      ) : (
                        <button onClick={() => approve(s)} disabled={busy===id}
                          style={{background:isBuy?"#34d39e":"transparent",color:isBuy?"#04130d":"#f4f8f7",
                            border:isBuy?"none":"1px solid #2b3a3d",fontWeight:700,fontSize:12.5,
                            padding:"8px 16px",borderRadius:8,cursor:"pointer",opacity:busy===id?0.5:1}}>
                          {busy===id?"…":"Approve"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p style={{color:"#4f5d5a",fontSize:10,lineHeight:1.5,marginTop:24,maxWidth:"80ch"}}>
          Recommendations only. Vaelor does not trade your account automatically — every order requires your explicit
          approval. Prices are estimates and may move before execution. Not investment advice.
        </p>
      </div>
    </main>
  );
}
