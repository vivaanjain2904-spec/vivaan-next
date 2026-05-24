"use client";
import { useEffect, useState } from "react";

/**
 * Hook that returns a { ticker → company name } map for the universe.
 * Caches the result module-side so multiple components don't refetch.
 * Initial render returns an empty object; the map populates on next tick.
 */
let _cache: Record<string, string> | null = null;
let _inflight: Promise<Record<string, string>> | null = null;

function loadNames(): Promise<Record<string, string>> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = fetch("/api/universe")
    .then(r => r.json())
    .then(j => {
      const map: Record<string, string> = {};
      for (const it of (j.items ?? [])) map[it.t] = it.n;
      _cache = map;
      return map;
    })
    .catch(() => ({}));
  return _inflight;
}

export function useTickerNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>(_cache ?? {});
  useEffect(() => {
    if (_cache) return;
    loadNames().then(setNames);
  }, []);
  return names;
}
