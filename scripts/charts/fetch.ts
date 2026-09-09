/* eslint-disable no-console */
// Price-history cache builder.
//
// Why this exists: the PWA cannot fetch price history itself. Stooq and Yahoo
// both serve daily closes for free, and neither sends CORS headers, so a
// browser `fetch` to either one fails before it starts — which is why every
// chart in the web build was empty. The app's own origin is the one host it
// can always reach, so history is fetched here and committed under
// public/data/charts/, which GitHub Pages then serves alongside the app.
//
// Unlike the screener index, this job publishes whatever it manages to fetch.
// Percentiles need the whole universe to be correct, so a partial screener run
// is worthless; a chart is per-company, so 140 working charts beat none.

import * as fs from 'fs';
import * as path from 'path';
import { UNIVERSE as APP_UNIVERSE } from '../../src/data/universe';
import { UNIVERSE as SCREENER_UNIVERSE } from '../screener/universe';
import { EXTRA_SYMBOLS } from './extra';

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const CHART_DIR = path.join(OUT_DIR, 'charts');
const MANIFEST_PATH = path.join(OUT_DIR, 'charts.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Daily closes kept per symbol — about 19 months, so a 1Y range has headroom. */
const KEEP_DAYS = 400;
const REQUEST_SPACING_MS = 400;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Candle {
  date: string; // YYYY-MM-DD
  close: number;
}

// ------------------------------------------------------------------ sources

/** Stooq: free EOD CSV, no key. `BRK.B` is `brk-b.us`. */
async function fromStooq(symbol: string): Promise<Candle[] | null> {
  const s = symbol.toLowerCase().replace(/[.]/g, '-') + '.us';
  const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`stooq HTTP ${res.status}`);
  const csv = (await res.text()).trim();
  // Stooq answers "Exceeded the daily hits limit" and similar as plain text
  // with a 200, so the header line is the only proof this is really data.
  if (!csv.startsWith('Date')) {
    throw new Error(`stooq: ${csv.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
  const out: Candle[] = [];
  for (const line of csv.split('\n').slice(1)) {
    const [date, , , , close] = line.split(',');
    const c = Number.parseFloat(close);
    if (date && Number.isFinite(c)) out.push({ date, close: c });
  }
  return out.length >= 30 ? out : null;
}

/**
 * Yahoo's chart endpoint — the fallback when Stooq refuses a symbol or a
 * runner.
 *
 * Note this is not the endpoint the screener job uses. That one calls
 * `quoteSummary` for fundamentals, which is throttled far harder and answers
 * 429 to everything from a GitHub runner. Plain chart data is cheaper, so it
 * is worth trying even though the screener cannot get through. The two API
 * hosts are rate-limited separately, so each is its own source.
 */
async function fromYahooHost(host: string, symbol: string): Promise<Candle[] | null> {
  const url =
    `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!ts || !closes || ts.length !== closes.length) return null;
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: +c.toFixed(4) });
    }
  }
  return out.length >= 30 ? out : null;
}

const SOURCES: { name: string; get: (s: string) => Promise<Candle[] | null> }[] = [
  { name: 'stooq', get: fromStooq },
  { name: 'yahoo1', get: (s) => fromYahooHost('query1.finance.yahoo.com', s) },
  { name: 'yahoo2', get: (s) => fromYahooHost('query2.finance.yahoo.com', s) },
];

/**
 * How many symbols in a row a source has thrown on before it is written off
 * for the rest of the run.
 */
const GIVE_UP_AFTER = 8;

/**
 * Try each source in turn, retrying transient failures.
 *
 * A source can be blocked for the entire run rather than for one ticker —
 * Yahoo answers 429 to every request from a GitHub runner, which is exactly
 * how the screener job came back with 0 of 164. `health` counts consecutive
 * throws per source and drops one that is clearly not talking to us, so a
 * dead source costs a handful of requests instead of three per symbol for the
 * whole universe. A "no data" answer is a fact about the ticker, not the
 * source, so it does not count against it.
 */
async function fetchHistory(
  symbol: string,
  health: Map<string, number>,
): Promise<{ candles: Candle[]; source: string } | { error: string }> {
  const errors: string[] = [];
  for (const src of SOURCES) {
    if ((health.get(src.name) ?? 0) >= GIVE_UP_AFTER) continue;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const candles = await src.get(symbol);
        health.set(src.name, 0);
        if (candles && candles.length) return { candles, source: src.name };
        errors.push(`${src.name}: no data`);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt === MAX_RETRIES) {
          const n = (health.get(src.name) ?? 0) + 1;
          health.set(src.name, n);
          errors.push(`${src.name}: ${msg}`);
          if (n === GIVE_UP_AFTER) {
            console.log(`  (${src.name} has failed ${n} symbols running — skipping it from here)`);
          }
        } else {
          await sleep(800 * (attempt + 1));
        }
      }
    }
  }
  return { error: errors.join(' | ') || 'no source produced data' };
}

// -------------------------------------------------------------------- main

function symbolList(): string[] {
  const set = new Set<string>();
  for (const s of SCREENER_UNIVERSE) set.add(s.toUpperCase());
  // The deck's own candidate list, so every company that can reach a card or
  // the catalog has a chart.
  for (const e of APP_UNIVERSE) set.add(e.symbol.toUpperCase());
  for (const s of EXTRA_SYMBOLS) set.add(s.toUpperCase());
  // Anything already published keeps being refreshed, so a symbol added once
  // by hand does not silently go stale later.
  if (fs.existsSync(CHART_DIR)) {
    for (const f of fs.readdirSync(CHART_DIR)) {
      if (f.endsWith('.json')) set.add(f.slice(0, -5).toUpperCase());
    }
  }
  // Symbols passed to the workflow by hand, e.g. holdings outside the universe.
  for (const s of (process.env.EXTRA_SYMBOLS ?? '').split(/[,\s]+/)) {
    const t = s.trim().toUpperCase();
    if (t) set.add(t);
  }
  return [...set].sort();
}

async function main() {
  fs.mkdirSync(CHART_DIR, { recursive: true });
  const symbols = symbolList();
  console.log(`fetching daily history for ${symbols.length} symbols`);

  const health = new Map<string, number>();
  const written: string[] = [];
  const failed: { symbol: string; error: string }[] = [];
  const bySource: Record<string, number> = {};

  for (const symbol of symbols) {
    const got = await fetchHistory(symbol, health);
    if ('error' in got) {
      failed.push({ symbol, error: got.error });
      console.log(`  ${symbol}: ${got.error}`);
    } else {
      bySource[got.source] = (bySource[got.source] ?? 0) + 1;
      const candles = got.candles.slice(-KEEP_DAYS);
      fs.writeFileSync(
        path.join(CHART_DIR, `${symbol}.json`),
        JSON.stringify({
          symbol,
          source: got.source,
          updated: candles[candles.length - 1].date,
          candles: candles.map((c) => [c.date, c.close]),
        }),
      );
      written.push(symbol);
    }
    await sleep(REQUEST_SPACING_MS);
  }

  if (written.length === 0) {
    console.error('FATAL: no symbol produced history from any source.');
    if (failed.length) console.error(`first error: ${failed[0].error}`);
    process.exit(1);
  }

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({
      builtAt: new Date().toISOString(),
      count: written.length,
      symbols: written,
      failed: failed.map((f) => f.symbol),
    }),
  );

  const sources = Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`\nwrote ${written.length} chart files (${sources})`);
  if (failed.length) console.log(`missing ${failed.length}: ${failed.map((f) => f.symbol).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
