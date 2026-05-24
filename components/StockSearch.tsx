"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Item = { t: string; n: string };

export default function StockSearch({
  value, onChange, placeholder = "Search ticker or company (e.g. AAPL, Apple)",
}: {
  value: string;
  onChange: (tk: string) => void;
  placeholder?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const id = useRef("st-" + Math.random().toString(36).slice(2));

  useEffect(() => { setQuery(value || ""); }, [value]);
  useEffect(() => {
    fetch("/api/universe").then(r => r.json()).then(j => {
      // New shape: { items: [{t,n}], universe: [t] }; old callers may still pull `universe`
      if (Array.isArray(j.items) && j.items.length) setItems(j.items);
      else setItems((j.universe ?? []).map((t: string) => ({ t, n: "" })));
    });
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return items;
    const qLower = q.toLowerCase();
    const starts: Item[] = [];
    const wordStarts: Item[] = []; // name begins with query (e.g. "Apple" → search "app")
    const contains: Item[] = [];
    for (const it of items) {
      if (it.t.startsWith(q)) starts.push(it);
      else if (it.n && it.n.toLowerCase().startsWith(qLower)) wordStarts.push(it);
      else if (it.t.includes(q) || (it.n && it.n.toLowerCase().includes(qLower))) contains.push(it);
    }
    return [...starts, ...wordStarts, ...contains];
  }, [query, items]);

  function pick(tk: string) {
    onChange(tk); setQuery(tk); setOpen(false); setIdx(0);
  }

  return (
    <div className="relative">
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <span className="pill-muted text-[10px] !py-0.5 !px-2">{items.length} stocks</span>
      </div>
      <input
        id={id.current}
        name={id.current}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        className="input font-mono tracking-wider pr-24"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setIdx(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && matches[idx]) { e.preventDefault(); pick(matches[idx].t); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-card2 border border-border1 rounded-lg shadow-xl">
          {matches.slice(0, 100).map((m, i) => (
            <li key={m.t}
                onMouseEnter={() => setIdx(i)}
                onMouseDown={() => pick(m.t)}
                className={[
                  "px-3 py-2 text-[13px] cursor-pointer flex items-baseline gap-3",
                  i === idx ? "bg-mint/10" : "hover:bg-card",
                ].join(" ")}>
              <span className={[
                "font-mono font-semibold tracking-wider min-w-[68px]",
                i === idx ? "text-mint" : "text-ink",
              ].join(" ")}>{m.t}</span>
              {m.n && (
                <span className={[
                  "truncate text-[12px]",
                  i === idx ? "text-mint/80" : "text-muted",
                ].join(" ")}>{m.n}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
