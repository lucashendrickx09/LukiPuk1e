import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle } from '@/types';
import { todayKey } from '@/utils/format';

// Stooq serves free end-of-day history as CSV with no API key. Daily data only
// changes once per day, so candles are cached for the calendar day.

const CACHE_PREFIX = 'stockpile.candles.';

function toStooqSymbol(symbol: string): string {
  // BRK.B -> brk-b.us
  return symbol.toLowerCase().replace('.', '-') + '.us';
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

  try {
    const url = `https://stooq.com/q/d/l/?s=${toStooqSymbol(symbol)}&i=d`;
    const res = await fetch(url);
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
    if (candles.length === 0) return null;
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ day: todayKey(), candles }));
    return candles;
  } catch {
    return null;
  }
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
