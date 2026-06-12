import { CompanyProfile, KeyMetrics, Quote } from '@/types';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';

const BASE = 'https://finnhub.io/api/v1';

// Finnhub free tier allows 60 calls/min. All requests go through one promise
// chain spaced ~1.1s apart so a full deck build can never trip the limit.
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const MIN_GAP_MS = 1100;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = next.catch(() => undefined);
  return next as Promise<T>;
}

async function get<T>(key: string, path: string, params: Record<string, string>): Promise<T> {
  return throttled(async () => {
    const qs = new URLSearchParams({ ...params, token: key }).toString();
    const res = await fetch(`${BASE}${path}?${qs}`);
    if (res.status === 429) throw new Error('Finnhub rate limit hit — try again in a minute');
    if (res.status === 401 || res.status === 403) throw new Error('Finnhub API key rejected');
    if (!res.ok) throw new Error(`Finnhub error ${res.status}`);
    return (await res.json()) as T;
  });
}

export async function fetchQuote(key: string, symbol: string): Promise<Quote | null> {
  const q = await get<{ c: number; d: number; dp: number; pc: number }>(key, '/quote', {
    symbol,
  });
  if (!q || !q.c) return null;
  return {
    price: q.c,
    change: q.d ?? 0,
    changePct: q.dp ?? 0,
    prevClose: q.pc ?? q.c,
    updatedAt: Date.now(),
  };
}

export async function fetchProfile(key: string, symbol: string): Promise<CompanyProfile> {
  const fallback = UNIVERSE_BY_SYMBOL.get(symbol);
  try {
    const p = await get<{
      name?: string;
      finnhubIndustry?: string;
      marketCapitalization?: number;
      logo?: string;
      weburl?: string;
      exchange?: string;
    }>(key, '/stock/profile2', { symbol });
    return {
      symbol,
      name: p.name || fallback?.fallbackName || symbol,
      sector: p.finnhubIndustry || fallback?.fallbackSector || 'Unknown',
      marketCapM: p.marketCapitalization ?? 0,
      logo: p.logo || undefined,
      weburl: p.weburl,
      exchange: p.exchange,
    };
  } catch {
    return {
      symbol,
      name: fallback?.fallbackName || symbol,
      sector: fallback?.fallbackSector || 'Unknown',
      marketCapM: 0,
    };
  }
}

export interface RecommendationTrend {
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
}

export async function fetchRecommendations(
  key: string,
  symbol: string,
): Promise<RecommendationTrend[]> {
  const rows = await get<RecommendationTrend[]>(key, '/stock/recommendation', { symbol });
  return Array.isArray(rows) ? rows : [];
}

export interface NewsItem {
  datetime: number;
  headline: string;
  source: string;
  summary: string;
  url: string;
}

export async function fetchCompanyNews(
  key: string,
  symbol: string,
  from: string,
  to: string,
): Promise<NewsItem[]> {
  const rows = await get<NewsItem[]>(key, '/company-news', { symbol, from, to });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchMetrics(key: string, symbol: string): Promise<KeyMetrics> {
  try {
    const m = await get<{ metric?: Record<string, number | null> }>(key, '/stock/metric', {
      symbol,
      metric: 'all',
    });
    const metric = m.metric ?? {};
    const num = (k: string) => {
      const v = metric[k];
      return typeof v === 'number' && isFinite(v) ? v : undefined;
    };
    return {
      peTTM: num('peTTM'),
      week52High: num('52WeekHigh'),
      week52Low: num('52WeekLow'),
      grossMarginTTM: num('grossMarginTTM'),
      revenueGrowthTTMYoy: num('revenueGrowthTTMYoy'),
      dividendYield: num('dividendYieldIndicatedAnnual'),
      beta: num('beta'),
    };
  } catch {
    return {};
  }
}

export interface SearchHit {
  symbol: string;
  description: string;
}

export async function searchSymbols(key: string, query: string): Promise<SearchHit[]> {
  const res = await get<{ result?: { symbol: string; description: string; type: string }[] }>(
    key,
    '/search',
    { q: query },
  );
  return (res.result ?? [])
    .filter((r) => !r.symbol.includes('.') || r.symbol.endsWith('.B'))
    .slice(0, 8)
    .map((r) => ({ symbol: r.symbol, description: r.description }));
}
