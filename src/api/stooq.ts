import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Candle } from '@/types';
import { todayKey } from '@/utils/format';

// Daily price history.
//
// The web build cannot fetch this from a market data host: neither Stooq nor
// Yahoo sends CORS headers, so the browser blocks the request before it is
// made, and every chart in the PWA came back empty. So a nightly job commits
// the history under public/data/charts/ and Pages serves it from the app's own
// origin — the one host the browser will always talk to.
//
// Native builds have no CORS restriction, so they read Stooq directly and get
// today's close without waiting for the nightly job.

const CACHE_PREFIX = 'stockpile.candles.';

function toStooqSymbol(symbol: string): string {
  // BRK.B -> brk-b.us
  return symbol.toLowerCase().replace(/[.]/g, '-') + '.us';
}

/** Base path the app is served under ('' locally, '/LukiPuk1e' on Pages). */
function baseUrl(): string {
  const w = globalThis as { __STOCKPILE_BASE__?: string };
  return w.__STOCKPILE_BASE__ ?? '';
}

/**
 * Filenames follow whichever form the symbol was published under, and the
 * separator in a class-B ticker is written both ways depending on the source.
 */
function candidateNames(symbol: string): string[] {
  const upper = symbol.toUpperCase();
  const swapped = upper.includes('.')
    ? upper.replace(/[.]/g, '-')
    : upper.includes('-')
      ? upper.replace(/-/g, '.')
      : null;
  return swapped ? [upper, swapped] : [upper];
}

async function fromPublishedCache(symbol: string): Promise<Candle[] | null> {
  for (const name of candidateNames(symbol)) {
    try {
      const res = await fetch(`${baseUrl()}/data/charts/${encodeURIComponent(name)}.json`);
      if (!res.ok) continue;
      const json = (await res.json()) as { candles?: [string, number][] };
      const rows = json.candles;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const candles = rows
        .filter((r) => Array.isArray(r) && typeof r[0] === 'string' && Number.isFinite(r[1]))
        .map(([date, close]) => ({ date, close }));
      if (candles.length) return candles;
    } catch {
      // try the next spelling, then the live source
    }
  }
  return null;
}

async function fromStooq(symbol: string): Promise<Candle[] | null> {
  try {
    const res = await fetch(`https://stooq.com/q/d/l/?s=${toStooqSymbol(symbol)}&i=d`);
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 30 || !lines[0].startsWith('Date')) return null;
    const candles: Candle[] = [];
    for (const line of lines.slice(1).slice(-520)) {
      const [date, , , , close] = line.split(',');
      const c = parseFloat(close);
      if (date && isFinite(c)) candles.push({ date, close: c });
    }
    return candles.length ? candles : null;
  } catch {
    return null;
  }
}

export async function fetchDailyCandles(symbol: string): Promise<Candle[] | null> {
  const cacheKey = CACHE_PREFIX + symbol;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { day: string; candles: Candle[] };
      if (parsed.day === todayKey() && parsed.candles.length > 0) return parsed.candles;
    }
  } catch {
    // fall through to network
  }

  // On the web the published cache is the only source that can succeed; on
  // native the live source is fresher, so it goes first.
  const order =
    Platform.OS === 'web' ? [fromPublishedCache, fromStooq] : [fromStooq, fromPublishedCache];

  for (const source of order) {
    const candles = await source(symbol);
    if (candles && candles.length) {
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ day: todayKey(), candles }));
      } catch {
        // a full quota should not cost us the data we just fetched
      }
      return candles;
    }
  }
  return null;
}

export function lastNCandles(candles: Candle[], days: number): Candle[] {
  return candles.slice(-days);
}

export function pctReturn(candles: Candle[], days: number): number | null {
  if (candles.length < 2) return null;
  const recent = candles[candles.length - 1].close;
  const past = candles[Math.max(0, candles.length - 1 - days)].close;
  if (!past) return null;
  return ((recent - past) / past) * 100;
}

export function sma(candles: Candle[], days: number): number | null {
  if (candles.length < days) return null;
  const window = candles.slice(-days);
  return window.reduce((s, c) => s + c.close, 0) / days;
}
