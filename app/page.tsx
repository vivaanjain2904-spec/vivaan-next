import { redirect } from "next/navigation";
import Link from "next/link";
import { readSession } from "@/lib/auth";
import Logo from "@/components/Logo";

export default async function RootIndex() {
  const s = await readSession();
  if (s) redirect("/overview");
  return <LandingPage />;
}

/* ────────────────────────────────────────────────────────────
   PUBLIC LANDING PAGE
   - Same colors / fonts / logo as the rest of Vaelor
   - Mobile-first, fully responsive
   - No external assets — uses an inline CSS mock of the dashboard
     so it works without any image hosting
   ──────────────────────────────────────────────────────────── */
function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <NavBar />
      <Hero />
      <FeaturesSection />
      <HowItWorks />
      <CTASection />
      <FooterBar />
    </div>
  );
}

function NavBar() {
  return (
    <header className="border-b border-border1/50 sticky top-0 z-40 bg-bg/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Logo size="sm" showTagline={false} />
        <nav className="flex items-center gap-1 sm:gap-3">
          <a href="#features" className="hidden sm:inline text-[13px] text-ink2 hover:text-ink transition-colors px-3 py-2">
            Features
          </a>
          <a href="#how" className="hidden sm:inline text-[13px] text-ink2 hover:text-ink transition-colors px-3 py-2">
            How it works
          </a>
          <Link href="/login" className="text-[13px] text-ink2 hover:text-ink transition-colors px-3 py-2">
            Sign in
          </Link>
          <Link href="/register" className="btn-mint text-[13px] !py-2">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border1/50">
      {/* Ambient drifting aura — two layers for depth */}
      <div className="absolute inset-0 pointer-events-none animate-aura">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(52,211,153,0.18), transparent 60%)",
          }}
        />
      </div>
      <div
        className="absolute inset-0 pointer-events-none animate-aura"
        style={{ animationDelay: "2s" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 55% 40% at 78% 8%, rgba(31,122,82,0.18), transparent 65%)",
          }}
        />
      </div>
      <div className="absolute inset-0 dot-grid opacity-25 pointer-events-none" />

      {/* Orbital ring decoration (very subtle) */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] pointer-events-none opacity-30 hidden sm:block animate-orbit">
        <div className="absolute inset-0 rounded-full border border-mint/10" />
        <div className="absolute inset-12 rounded-full border border-mint/8" />
      </div>

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-12 sm:pb-20 text-center">
        <div className="inline-flex items-center gap-2 pill-mint mb-8 animate-rise">
          <span className="text-mint animate-pulse-dot">●</span>
          ATR-based smart stops · ML signals · Auto-execution
        </div>

        <h1 className="font-sans text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.05] animate-rise delay-1">
          Paper trading <br className="sm:hidden" />
          with{" "}
          <span className="bg-gradient-to-r from-mint via-mint to-vaelor bg-clip-text text-transparent">
            real edge.
          </span>
        </h1>

        <p className="text-base sm:text-xl text-ink2 max-w-2xl mx-auto mb-10 leading-relaxed animate-rise delay-2">
          Volatility-adjusted stops, walk-forward ML signals, and hands-off
          execution via Alpaca. Built for traders who can&apos;t stare at a screen
          all day.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-14 sm:mb-20 animate-rise delay-3">
          <Link
            href="/register"
            className="btn-mint text-base !px-7 !py-3.5 inline-flex items-center justify-center gap-2 group animate-glow"
          >
            Start free
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round"
                 className="w-4 h-4 transition-transform group-hover:translate-x-0.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          <Link
            href="/login"
            className="btn-ghost text-base !px-7 !py-3.5 inline-flex items-center justify-center"
          >
            I have an account
          </Link>
        </div>

        <div className="animate-rise delay-4">
          <MockDashboard />
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="border-b border-border1/50 py-20 sm:py-28">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-mint mb-3">
            What you get
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">
            Vaelor pages you when something matters.
            <br />
            <span className="text-ink2 font-semibold">And stays quiet otherwise.</span>
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
          <FeatureCard delay={1} icon={<IconTarget />}
            title="ATR-based smart stops"
            desc="No more flat 5% stops shaking you out of NVDA and letting KO bleed. Each position's stop-loss & take-profit comes from that stock's own 14-day ATR. Trailing logic ratchets the stop tighter as positions run — up 20%, you're locked in for +5% no matter what." />
          <FeatureCard delay={2} icon={<IconChart />}
            title="ML drop-probability signals"
            desc="Every 15 minutes, every holding gets a 0–1 risk score blending RSI, 20/50-day moving averages, and 1-month momentum. When risk crosses your threshold, you know before the bleed. Walk-forward validated — no curve-fitted backtests." />
          <FeatureCard delay={3} icon={<IconBell />}
            title="Multi-channel alerts"
            desc="Email (via Resend), mobile push (via ntfy), Discord webhooks, and browser notifications. All four fire when a position trips a threshold. ≤15-minute latency during US market hours. Configure once, never miss again." />
          <FeatureCard delay={4} icon={<IconCpu />}
            title="Hands-off execution"
            desc="Connect a free Alpaca paper account and Vaelor fires sells automatically when signals trip. Conviction-based sizing — stronger signals get bigger bets, weaker ones get smaller. Bear-regime filter pauses new buys when SPY breaks its 50-day MA." />
          <FeatureCard delay={5} icon={<IconTrending />}
            title="Real performance dashboard"
            desc="Win rate, profit factor, alpha vs S&P 500, realized vs unrealized P&L, top winners/losers, per-position contribution. Backed by FIFO-matched closed round-trips — no smoothing, no cherry-picking." />
          <FeatureCard delay={6} icon={<IconZap />}
            title="Built-in backtest engine"
            desc="Replay any strategy on real historical data. Compare to buy-and-hold. See whether your edge is actually edge or just lucky timing. Test before you trust." />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="border-b border-border1/50 py-20 sm:py-28 bg-card/30">
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-mint mb-3">
            How it works
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
            Up and running in 60 seconds.
          </h2>
        </div>

        <div className="space-y-10">
          <Step
            n={1}
            title="Sign up free"
            desc="No credit card, no data subscription. Start with $100,000 of paper cash on the house."
          />
          <Step
            n={2}
            title="Build a portfolio"
            desc="Seed 10 popular stocks in one click, or browse 546+ tickers with full company names and live quotes."
          />
          <Step
            n={3}
            title="Set thresholds — or don't"
            desc="One-click 'Apply Recommendation' uses each stock's volatility to set sensible stop-loss & take-profit, plus a smart review window."
          />
          <Step
            n={4}
            title="Live alerts on every channel"
            desc="The moment a position hits stop-loss, take-profit, or your ML risk threshold, you're notified across email, push, and Discord."
          />
          <Step
            n={5}
            title="Optional: hands-off auto-trade"
            desc="Connect an Alpaca paper account and Vaelor executes for you. You stay in school. The bot stays awake."
          />
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="relative overflow-hidden border-b border-border1/50">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(52,211,153,0.08), transparent 60%)",
        }}
      />
      <div className="relative max-w-4xl mx-auto px-5 sm:px-8 py-20 sm:py-24 text-center">
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">
          Ready to test your strategy?
        </h2>
        <p className="text-base sm:text-lg text-ink2 mb-10">
          Free forever. No card needed. Paper trading from day one.
        </p>
        <Link
          href="/register"
          className="btn-mint text-base !px-8 !py-3.5 inline-flex items-center gap-2 group"
        >
          Get started free
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round"
               className="w-4 h-4 transition-transform group-hover:translate-x-0.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </div>
    </section>
  );
}

function FooterBar() {
  return (
    <footer className="py-10">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo size="sm" showTagline={false} />
          <span className="text-[11px] text-muted">© 2026 · vaelor.dev</span>
        </div>
        <div className="flex items-center gap-5 text-[12px] text-muted">
          <a
            href="https://github.com/vivaanjain2904-spec/vivaan-next"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink2 transition-colors"
          >
            GitHub
          </a>
          <span className="text-border2">·</span>
          <a
            href="mailto:vivaanjain2904@gmail.com"
            className="hover:text-ink2 transition-colors"
          >
            Contact
          </a>
          <span className="text-border2">·</span>
          <Link href="/login" className="hover:text-ink2 transition-colors">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ──────── Sub-components ──────── */

function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay?: 1|2|3|4|5|6 }) {
  return (
    <div className={[
      "panel hover:border-mint/30 transition-all duration-300 group cursor-default",
      "hover:translate-y-[-2px] hover:shadow-[0_8px_24px_-8px_rgba(52,211,153,0.18)]",
      "animate-rise",
      delay ? `delay-${delay}` : "",
    ].join(" ")}>
      <div className="w-11 h-11 rounded-lg bg-mint/10 border border-mint/20 flex items-center justify-center text-mint mb-5 group-hover:bg-mint/15 group-hover:border-mint/40 group-hover:scale-105 transition-all duration-200">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-ink mb-2 group-hover:text-mint transition-colors">
        {title}
      </h3>
      <p className="text-[13px] text-ink2 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ─────────── Lucide-style SVG icons (stroke-based, brand-consistent) ─────────── */

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "w-5 h-5",
};

function IconTarget() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-6 4 4 4-7" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function IconCpu() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  );
}
function IconTrending() {
  return (
    <svg {...ICON_PROPS}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
function IconZap() {
  return (
    <svg {...ICON_PROPS}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="flex gap-5 sm:gap-7">
      <div className="flex-shrink-0 w-11 h-11 rounded-full bg-mint/10 border border-mint/30 flex items-center justify-center font-mono text-mint font-bold">
        {n}
      </div>
      <div className="pt-1.5">
        <h3 className="text-lg font-semibold text-ink mb-1">{title}</h3>
        <p className="text-[14px] text-ink2 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ──────── Mock dashboard (inline CSS, no external screenshots) ──────── */

function MockDashboard() {
  return (
    <div className="relative max-w-5xl mx-auto">
      <div className="panel p-4 sm:p-6 text-left relative shadow-2xl shadow-mint/10 backdrop-blur-sm">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2.5 h-2.5 rounded-full bg-red/50" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber/50" />
          <span className="w-2.5 h-2.5 rounded-full bg-mint/50" />
          <span className="text-[10px] text-muted font-mono ml-2">vaelor.dev/overview</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-mint">
            <span className="w-1.5 h-1.5 rounded-full bg-mint animate-pulse-dot" />
            Live
          </span>
        </div>

        {/* KPIs */}
        <div className="flex flex-wrap gap-2.5 mb-5">
          <MockKpi label="Total Value" value="$104,287" sub="+4.29%" tone="mint" />
          <MockKpi label="Win Rate" value="62%" sub="34W · 21L" tone="mint" />
          <MockKpi label="vs S&P" value="+2.1%" sub="alpha" tone="mint" />
          <MockKpi label="Profit Factor" value="1.84" sub="avg W/L" tone="mint" />
        </div>

        {/* Alerts */}
        <div className="text-[10px] font-semibold text-ink2 uppercase tracking-wider mb-2">
          Recent alerts
        </div>
        <div className="space-y-1.5 mb-5">
          <div className="panel py-2.5 px-3 text-[12px] flex items-center gap-2 border-l-2 border-l-mint">
            <span className="text-mint text-[12px]">●</span>
            <span className="text-ink">NVDA hit take-profit · $185.30 (+14.4%)</span>
          </div>
          <div className="panel py-2.5 px-3 text-[12px] flex items-center gap-2 border-l-2 border-l-amber">
            <span className="text-amber text-[12px]">●</span>
            <span className="text-ink">META ML risk: 72% drop probability</span>
          </div>
        </div>

        {/* Holdings table */}
        <div className="text-[10px] font-semibold text-ink2 uppercase tracking-wider mb-2">
          Holdings
        </div>
        <div className="panel p-0 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-right px-2 py-2">Price</th>
                <th className="text-right px-2 py-2">P&L</th>
                <th className="text-right px-3 py-2">ML</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <MockRow tk="AAPL" name="Apple Inc."        px="$308.82" pnl="+12.3%" pnlPos ml="22%" mlTone="mint" />
              <MockRow tk="NVDA" name="NVIDIA Corp."      px="$185.30" pnl="+14.4%" pnlPos ml="31%" mlTone="muted" />
              <MockRow tk="META" name="Meta Platforms"    px="$612.45" pnl="-3.1%"  ml="72%" mlTone="red" />
              <MockRow tk="KO"   name="Coca-Cola Co."     px="$71.20"  pnl="+1.8%"  pnlPos ml="18%" mlTone="mint" />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MockKpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "mint" | "red" }) {
  return (
    <div className="flex-1 min-w-[120px] panel !p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className={`font-mono text-base font-bold ${tone === "mint" ? "text-mint" : "text-red"}`}>{value}</div>
      <div className="text-[10px] text-muted">{sub}</div>
    </div>
  );
}

function MockRow({ tk, name, px, pnl, pnlPos, ml, mlTone }: {
  tk: string; name: string; px: string; pnl: string; pnlPos?: boolean;
  ml: string; mlTone: "mint" | "red" | "muted";
}) {
  const pillCls =
    mlTone === "mint" ? "bg-mint/10 text-mint" :
    mlTone === "red"  ? "bg-redd/10 text-red" :
                        "bg-card2 text-ink2 border border-border1";
  return (
    <tr className="border-b border-border1/50 last:border-b-0">
      <td className="px-3 py-2 font-sans">
        <div className="text-ink font-semibold text-[12px]">{tk}</div>
        <div className="text-muted text-[10px] truncate max-w-[120px]">{name}</div>
      </td>
      <td className="px-2 py-2 text-right text-ink">{px}</td>
      <td className={`px-2 py-2 text-right font-semibold ${pnlPos ? "text-mint" : "text-red"}`}>{pnl}</td>
      <td className="px-3 py-2 text-right">
        <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${pillCls}`}>{ml}</span>
      </td>
    </tr>
  );
}
