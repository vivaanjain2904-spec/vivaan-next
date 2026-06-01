import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Founder · Vaelor",
  description: "Vivaan Jain — founder of Vaelor, an autonomous AI investing platform.",
};

/* ────────────────────────────────────────────────────────────
   FOUNDER / ABOUT PAGE — /founder
   Matches the site design system (Inter, mint accent, panel/
   section-h classes, dark theme tokens). SVG icons, no emoji.
   ──────────────────────────────────────────────────────────── */

const SOCIALS = [
  { label: "LinkedIn", href: "https://linkedin.com/in/vivaanjain2904", icon: "linkedin" },
  { label: "Portfolio", href: "https://vivaanjainportfolio.com", icon: "globe" },
  { label: "Email", href: "mailto:vivaanjain2904@gmail.com", icon: "mail" },
  { label: "GitHub", href: "https://github.com/vivaanjain2904-spec", icon: "github" },
];

function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const c = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "linkedin": return <svg viewBox="0 0 24 24" className={className} {...c}><path d="M4 4h4v16H4zM6 2.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/><path d="M10 9h3.6v1.9h.1c.5-.9 1.7-1.9 3.5-1.9 3.7 0 4.4 2.4 4.4 5.6V20H18v-4.5c0-1.1 0-2.5-1.5-2.5s-1.8 1.2-1.8 2.4V20H10z"/></svg>;
    case "globe": return <svg viewBox="0 0 24 24" className={className} {...c}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>;
    case "mail": return <svg viewBox="0 0 24 24" className={className} {...c}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>;
    case "github": return <svg viewBox="0 0 24 24" className={className} {...c}><path d="M9 19c-4 1.5-4-2-6-2m12 4v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>;
    case "download": return <svg viewBox="0 0 24 24" className={className} {...c}><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>;
    case "spark": return <svg viewBox="0 0 24 24" className={className} {...c}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>;
    case "check": return <svg viewBox="0 0 24 24" className={className} {...c}><path d="m20 6-11 11-5-5"/></svg>;
    default: return null;
  }
}

const SKILLS = {
  "Finance": ["DCF & 3-Statement Modeling", "LBO / Comps / Precedent Txns", "Equity Research", "Scenario & Variance Analysis"],
  "Engineering": ["Python (pandas, scikit-learn)", "TypeScript / React / Next.js", "SQL / PostgreSQL", "Git, Vercel, cloud deploy"],
  "Quant / ML": ["Cross-sectional factor models", "Walk-forward backtesting", "Risk modeling & sizing", "NLP sentiment (VADER)"],
};

const TIMELINE = [
  { period: "2026", title: "Founder — Vaelor", detail: "Designed, built, and deployed an autonomous AI investing platform end-to-end: ML research pipeline, live auto-rebalancing, risk controls. Live at vaelor.dev." },
  { period: "2024", title: "Office Aide — ESSE Trading Impex LLP", detail: "Operations support at an international trading firm." },
  { period: "2023", title: "Finance Intern — InnoLearn Solutions", detail: "Financial analysis and modeling support." },
];

export default function FounderPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Nav */}
      <header className="border-b border-border1/50 sticky top-0 z-40 bg-bg/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link href="/welcome"><Logo size="sm" showTagline={false} /></Link>
          <nav className="flex items-center gap-3">
            <Link href="/track-record" className="text-[13px] text-mint hover:opacity-80 transition-opacity px-3 py-2">Live results</Link>
            <Link href="/welcome" className="text-[13px] text-ink2 hover:text-ink transition-colors px-3 py-2">Home</Link>
            <Link href="/register" className="btn-mint text-[13px] !py-2">Get started</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 sm:px-8">

        {/* Hero */}
        <section className="relative pt-16 pb-12 border-b border-border1/50 overflow-hidden">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full pointer-events-none"
               style={{ background: "radial-gradient(circle, rgba(52,211,153,0.10), transparent 70%)" }} />
          <div className="relative flex flex-col sm:flex-row gap-8 items-start">
            <div className="shrink-0">
              <div className="w-24 h-24 rounded-2xl border border-border2 bg-bg2 flex items-center justify-center">
                <span className="text-4xl font-bold text-mint tracking-tight">VJ</span>
              </div>
            </div>
            <div>
              <div className="inline-flex items-center gap-2 text-mint text-[11px] font-semibold tracking-[0.2em] uppercase mb-3">
                <Icon name="spark" className="w-3.5 h-3.5" /> Founder
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05]">Vivaan Jain</h1>
              <p className="text-ink2 text-lg mt-3 max-w-2xl leading-relaxed">
                Economics &amp; Finance student at Arizona State University — and the solo
                founder, researcher, and engineer behind <span className="text-mint font-medium">Vaelor</span>.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 mt-6">
                {SOCIALS.map(s => (
                  <a key={s.label} href={s.href} target="_blank" rel="noreferrer"
                     className="btn-ghost text-[12.5px] inline-flex items-center gap-2">
                    <Icon name={s.icon} className="w-3.5 h-3.5" /> {s.label}
                  </a>
                ))}
                <a href="/Vivaan-Jain-Resume.pdf" target="_blank" rel="noreferrer"
                   className="btn-mint text-[12.5px] inline-flex items-center gap-2">
                  <Icon name="download" className="w-3.5 h-3.5" /> Resume
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Story */}
        <section className="py-12 border-b border-border1/50">
          <div className="section-h">The story behind Vaelor</div>
          <div className="grid sm:grid-cols-3 gap-6 mt-5">
            <p className="text-ink2 leading-relaxed sm:col-span-2 text-[15px]">
              I wanted to know whether a disciplined, automated strategy could genuinely
              beat the market — not in theory, but proven and running live. So I built the
              whole thing myself: a machine-learning research pipeline that ranks the market,
              a strategy validated with walk-forward backtesting across nine years and every
              market regime, and an autonomous agent that trades and protects a portfolio with
              no human in the loop. Then I deployed it for real and started a public track
              record. <span className="text-ink">Vaelor is the result — honest, transparent, and live.</span>
            </p>
            <div className="panel space-y-4">
              <Stat label="Built & deployed" value="End-to-end, solo" />
              <Stat label="Strategy validated" value="9 yrs · 5/5 regimes" />
              <Stat label="Status" value="Live · forward-testing" />
            </div>
          </div>
        </section>

        {/* Skills */}
        <section className="py-12 border-b border-border1/50">
          <div className="section-h">What I bring</div>
          <div className="grid sm:grid-cols-3 gap-5 mt-5">
            {Object.entries(SKILLS).map(([group, items]) => (
              <div key={group} className="panel">
                <div className="text-mint text-[12px] font-semibold tracking-wide uppercase mb-3">{group}</div>
                <ul className="space-y-2.5">
                  {items.map(it => (
                    <li key={it} className="flex items-start gap-2 text-[13.5px] text-ink2">
                      <Icon name="check" className="w-3.5 h-3.5 text-mint mt-0.5 shrink-0" /> {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Education + Timeline */}
        <section className="py-12 border-b border-border1/50">
          <div className="grid sm:grid-cols-2 gap-10">
            <div>
              <div className="section-h">Education</div>
              <div className="panel mt-5">
                <div className="font-semibold text-ink">Arizona State University</div>
                <div className="text-ink2 text-[14px] mt-1">W. P. Carey School of Business</div>
                <div className="text-ink2 text-[14px]">B.S. Economics &amp; Finance (Dual Major)</div>
                <div className="flex gap-4 mt-3 text-[12.5px] text-muted">
                  <span>GPA 3.47</span><span className="text-border2">·</span>
                  <span>Dean&apos;s List</span><span className="text-border2">·</span>
                  <span>Grad March 2028</span>
                </div>
                <div className="mt-3 text-[12px] text-muted">SIE Exam — in progress</div>
              </div>
            </div>
            <div>
              <div className="section-h">Experience</div>
              <div className="mt-5 space-y-4">
                {TIMELINE.map((t, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="shrink-0 w-12 text-[12px] text-mint font-mono pt-0.5">{t.period}</div>
                    <div className="border-l border-border1 pl-4 pb-1">
                      <div className="font-semibold text-ink text-[14px]">{t.title}</div>
                      <div className="text-ink2 text-[13px] mt-1 leading-relaxed">{t.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-14 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Let&apos;s talk.</h2>
          <p className="text-ink2 mt-3 max-w-xl mx-auto">
            Open to feedback, partnership, and early support as Vaelor grows.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
            <a href="mailto:vivaanjain2904@gmail.com" className="btn-mint text-[13px] inline-flex items-center gap-2">
              <Icon name="mail" className="w-4 h-4" /> Get in touch
            </a>
            <Link href="/track-record" className="btn-ghost text-[13px]">See the live results</Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-10 border-t border-border1/50">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size="sm" showTagline={false} />
            <span className="text-[11px] text-muted">© 2026 · vaelor.dev</span>
          </div>
          <div className="flex items-center gap-5 text-[12px] text-muted">
            <Link href="/welcome" className="hover:text-ink2 transition-colors">Home</Link>
            <span className="text-border2">·</span>
            <Link href="/track-record" className="hover:text-ink2 transition-colors">Live results</Link>
            <span className="text-border2">·</span>
            <a href="mailto:vivaanjain2904@gmail.com" className="hover:text-ink2 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted uppercase tracking-wide">{label}</div>
      <div className="text-ink font-semibold text-[15px] mt-0.5">{value}</div>
    </div>
  );
}
