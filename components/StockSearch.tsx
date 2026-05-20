"use client";
import { useEffect, useMemo, useState } from "react";

export default function StockSearch({
  value, onChange, placeholder = "Search 600+ stocks…",
}: {
  value: string;
  onChange: (tk: string) => void;
  placeholder?: string;
}) {
  const [universe, setUniverse] = useState<string[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen]   = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    fetch("/api/universe").then(r => r.json()).then(j => setUniverse(j.universe ?? []));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return universe.slice(0, 30);
    return universe.filter(t => t.startsWith(q) || t.includes(q)).slice(0, 30);
  }, [query, universe]);

  return (
    <div className="relative">
      <input
        className="input font-mono uppercase tracking-wider"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto bg-card border border-border1 rounded-lg shadow-glow2">
          {matches.map(t => (
            <li key={t}
                className="px-3 py-2 text-sm font-mono cursor-pointer hover:bg-mint/10 hover:text-mint"
                onMouseDown={() => { onChange(t); setQuery(t); setOpen(false); }}>
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
