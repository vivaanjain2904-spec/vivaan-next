/* Brand preview — visit /brand to pick a logo/font combo */
const FONTS = [
  { id: 1, name: "Cinzel",            font: "'Cinzel', serif",            weight: 900, ls: "0.18em", vibe: "Roman empire · carved in marble · sophisticated old-money evil" },
  { id: 2, name: "Cinzel Decorative", font: "'Cinzel Decorative', serif", weight: 900, ls: "0.14em", vibe: "Secret society · ornate · masonic" },
  { id: 3, name: "Cormorant SC",      font: "'Cormorant SC', serif",      weight: 700, ls: "0.12em", vibe: "Luxury wealth firm · refined · expensive" },
  { id: 4, name: "Orbitron",          font: "'Orbitron', sans-serif",     weight: 900, ls: "0.22em", vibe: "Cyberpunk megacorp · Tyrell / Cyberdyne" },
  { id: 5, name: "Audiowide",         font: "'Audiowide', sans-serif",    weight: 400, ls: "0.10em", vibe: "Tron · sci-fi corporate · neon" },
  { id: 6, name: "Bebas Neue",        font: "'Bebas Neue', sans-serif",   weight: 400, ls: "0.28em", vibe: "Modern brand · ad-agency bold · narrow tall" },
  { id: 7, name: "Major Mono",        font: "'Major Mono Display', monospace", weight: 400, ls: "0.20em", vibe: "Hacker terminal · Mr. Robot · cryptic" },
  { id: 8, name: "Playfair Display",  font: "'Playfair Display', serif",  weight: 900, ls: "0.06em", vibe: "Editorial luxe · NYT · Bloomberg" },
];

const MARKS: { id: string; label: string; el: JSX.Element }[] = [
  { id: "square",   label: "Square V",   el: (<div className="w-16 h-16 rounded-md bg-mint/15 border border-mint/40 flex items-center justify-center"><span className="text-mint text-3xl font-extrabold leading-none">V</span></div>) },
  { id: "circle",   label: "Medallion",  el: (<div className="w-16 h-16 rounded-full border-2 border-mint flex items-center justify-center"><span className="text-mint text-2xl font-extrabold leading-none">V</span></div>) },
  { id: "hex",      label: "Hexagon",    el: (<svg width="64" height="64" viewBox="0 0 64 64"><polygon points="32,4 58,18 58,46 32,60 6,46 6,18" fill="none" stroke="#34d399" strokeWidth="2"/><text x="32" y="42" textAnchor="middle" fill="#34d399" fontSize="26" fontWeight="900" fontFamily="serif">V</text></svg>) },
  { id: "triangle", label: "Pyramid",    el: (<svg width="64" height="64" viewBox="0 0 64 64"><polygon points="32,6 60,58 4,58" fill="none" stroke="#34d399" strokeWidth="2"/><text x="32" y="50" textAnchor="middle" fill="#34d399" fontSize="22" fontWeight="900" fontFamily="serif">V</text></svg>) },
  { id: "eye",      label: "All-Seeing", el: (<svg width="64" height="64" viewBox="0 0 64 64"><ellipse cx="32" cy="32" rx="28" ry="14" fill="none" stroke="#34d399" strokeWidth="2"/><circle cx="32" cy="32" r="6" fill="#34d399"/></svg>) },
  { id: "minimal",  label: "Minimal",    el: (<div className="text-mint text-4xl font-thin tracking-tight">V</div>) },
];

export default function BrandPreview() {
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cormorant+SC:wght@600;700&family=Orbitron:wght@700;900&family=Audiowide&family=Bebas+Neue&family=Major+Mono+Display&family=Playfair+Display:wght@800;900&display=swap" />
      <div className="max-w-[1200px] mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-ink mb-2">Pick your VAELOR look</h1>
        <p className="text-muted text-sm mb-8">
          Click any combo to apply it (or just tell me the font number + mark name).
          Each cell shows the wordmark in a different font.
        </p>

        <h2 className="section-h">Wordmark fonts</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {FONTS.map(f => (
            <div key={f.id} className="panel">
              <div className="text-[11px] text-muted mb-3 flex items-center justify-between">
                <span><span className="text-mint font-bold">#{f.id}</span> &nbsp;{f.name}</span>
                <span className="text-[10px] text-muted/70">{f.vibe}</span>
              </div>
              <div
                style={{
                  fontFamily: f.font,
                  fontWeight: f.weight,
                  letterSpacing: f.ls,
                  textTransform: "uppercase",
                  fontSize: "2.2rem",
                  lineHeight: 1,
                  background: "linear-gradient(180deg, #f5f7f6 0%, #34d399 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 0 20px rgba(52,211,153,0.3))",
                }}
              >
                VAELOR
              </div>
              <div className="text-[10px] text-muted mt-2 tracking-[0.25em] uppercase">Portfolio Agent</div>
            </div>
          ))}
        </div>

        <h2 className="section-h">Logo marks (the icon next to the name)</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mb-12">
          {MARKS.map(m => (
            <div key={m.id} className="panel flex flex-col items-center gap-3">
              {m.el}
              <div className="text-[11px] text-muted">{m.label}</div>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="text-sm text-ink2 mb-3">
            <b className="text-mint">Tell me your picks like:</b>
          </div>
          <div className="font-mono text-[12px] text-ink2 bg-card2 p-3 rounded-lg">
            "font #4, hexagon mark" &nbsp;or&nbsp; "Orbitron + pyramid"
          </div>
          <div className="text-[11px] text-muted mt-3">
            My recommendation for "evil corp" vibe: <b className="text-mint">Orbitron + Hexagon</b> (Cyberdyne)
            &nbsp;or&nbsp; <b className="text-mint">Cinzel + Pyramid</b> (Illuminati).
          </div>
        </div>
      </div>
    </>
  );
}
