/**
 * One-time script — fetches the long company name for every ticker in
 * lib/universe.json and writes them to lib/universe-names.json as
 * { [ticker]: name }. Run with: npx tsx scripts/fetch-universe-names.ts
 *
 * Safe to re-run; it preserves whatever it already has if a ticker
 * fails (Yahoo Finance occasionally 429s; just rerun).
 */
import fs from "fs";
import path from "path";
import { UNIVERSE } from "../lib/universe";
import { getQuotes } from "../lib/yfinance";

const OUT = path.join(__dirname, "..", "lib", "universe-names.json");
const BATCH = 25;

async function main() {
  let acc: Record<string, string> = {};
  if (fs.existsSync(OUT)) {
    try { acc = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  }

  const todo = UNIVERSE.filter(t => !acc[t]);
  console.log(`Have ${Object.keys(acc).length} names; need ${todo.length} more.`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const quotes = await getQuotes(batch);
    let added = 0;
    for (const tk of batch) {
      const name = quotes[tk]?.name;
      if (name && name !== tk) { acc[tk] = name; added++; }
    }
    console.log(`Batch ${Math.floor(i / BATCH) + 1}: +${added}, total ${Object.keys(acc).length}`);
    // Save after each batch so a crash doesn't lose progress
    fs.writeFileSync(OUT, JSON.stringify(acc, Object.keys(acc).sort(), 2));
  }

  console.log(`✓ Wrote ${Object.keys(acc).length} names to ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
