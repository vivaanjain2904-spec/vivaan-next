"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export default function StockSearch({
  value, onChange, placeholder = "Search ticker (e.g. AAPL, NVDA, TSLA)",
}: {
  value: string;
  onChange: (tk: string) => void;
  placeholder?: string;
}) {
  const [universe, setUniverse] = useState<string[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [idx, setIdx]   = useState(0);
  const id = useRef("st-" + Math.random().toString(36).slice(2));

  useEffect(() => { setQuery(value || ""); }, [value]);
  useEffect(() => {
    fetch("/api/universe").then(r => r.json()).then(j => setUniverse(j.universe ?? []));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return universe.slice(0, 30);
    const starts = universe.filter(t => t.startsWith(q));
    const contains = universe.filter(t => !t.startsWith(q) && t.includes(q));
    return [...starts, ...contains].slice(0, 30);
  }, [query, universe]);

  function pick(tk: string) {
    onChange(tk); setQuery(tk); setOpen(false); setIdx(0);
  }

  return (
    <div className="relative">
      <input
        id={id.current}
        name={id.current}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="input font-mono uppercase tracking-wider"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setIdx(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && matches[idx]) { e.preventDefault(); pick(matches[idx]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-card2 border border-border1 rounded-lg shadow-xl">
          {matches.map((t, i) => (
            <li key={t}
                onMouseEnter={() => setIdx(i)}
                onMouseDown={() => pick(t)}
                className={[
                  "px-3 py-2 text-[13px] font-mono cursor-pointer",
                  i === idx ? "bg-mint/10 text-mint" : "text-ink2 hover:bg-card",
                ].join(" ")}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
