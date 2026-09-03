/* eslint-disable no-console */
// Nightly cache builder.
//
// The whole point of this job is that the app never talks to Yahoo. It runs
// after the US close, writes public/data/index.json plus one chart file per
// company, and the PWA only ever reads those. Fetching per-swipe would
// rate-limit us, stutter the UI, and make the feed useless offline.
//
// Everything here is written to fail loudly rather than publish something
// plausible-looking and wrong. A half-populated universe produces wrong
// percentiles for *every* company, not just the missing ones, so a partial
// fetch aborts the write and yesterday's file stands.

import * as fs from 'fs';
import * as path from 'path';
import { Company, Flag, Metrics } from '../../src/screener/factors';
import { UNIVERSE } from './universe';

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const CHART_DIR = path.join(OUT_DIR, 'charts');
const INDEX_PATH = path.join(OUT_DIR, 'index.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Yahoo throttles hard. Sequential, spaced — a 150-name run takes ~8 minutes. */
const REQUEST_SPACING_MS = 1500;
const MAX_RETRIES = 3;
/** Below this share of the universe we refuse to publish. */
const MIN_COVERAGE = 0.9;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- handshake
interface Session {
  cookie: string;
  crumb: string;
}

/**
 * Some regions require a cookie + crumb before quoteSummary will answer.
 * If this fails we stop rather than write a file full of nulls.
 */
async function handshake(): Promise<Session> {
  const res = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('handshake: no cookie returned by fc.yahoo.com');

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('<')) throw new Error('handshake: no crumb returned');
  return { cookie, crumb };
}

async function getJson(url: string, session: Session): Promise<unknown> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Cookie: session.cookie, Accept: 'application/json' },
      });
      if (res.status === 404) return null; // delisted — not an error worth retrying
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      // Exponential backoff: 2s, 4s, 8s.
      if (attempt < MAX_RETRIES - 1) await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('request failed');
}

// ------------------------------------------------------------------ helpers
/** Yahoo wraps numbers as {raw, fmt}; sometimes it just sends the number. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && 'raw' in (v as Record<string, unknown>)) {
    const raw = (v as { raw: unknown }).raw;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
const get = (o: unknown, ...keys: string[]): unknown => {
  let cur: unknown = o;
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
};

// ------------------------------------------------------- derived quantities
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
}

/**
 * 12-month momentum skipping the most recent month. Short-term reversal is
 * well documented; including the last month just makes the factor noisier.
 */
function momentum12_1(closes: number[]): number | null {
  if (closes.length < 253) return null;
  const recent = closes[closes.length - 22]; // t-21
  const old = closes[closes.length - 253]; // t-252
  if (!old || !recent) return null;
  return recent / old - 1;
}

function annualisedVol(closes: number[]): number | null {
  if (closes.length < 60) return null;
  const window = closes.slice(-253);
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1] > 0 && window[i] > 0) rets.push(Math.log(window[i] / window[i - 1]));
  }
  if (rets.length < 30) return null;
  return stdev(rets) * Math.sqrt(252);
}

function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.min(worst, c / peak - 1);
  }
  return worst;
}

/** 3-year change in operating margin, from the income statement history. */
function marginTrend(summary: unknown): number | null {
  const rows = get(summary, 'incomeStatementHistory', 'incomeStatementHistory');
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const marginOf = (row: unknown): number | null => {
    const rev = num(get(row, 'totalRevenue'));
    const op = num(get(row, 'operatingIncome'));
    return rev && rev !== 0 && op !== null ? op / rev : null;
  };
  const newest = marginOf(rows[0]);
  const oldest = marginOf(rows[rows.length - 1]);
  return newest !== null && oldest !== null ? newest - oldest : null;
}

// --------------------------------------------------------------- per symbol
interface Fetched {
  company: Company;
  closes: number[];
  timestamps: number[];
  lastTimestamp: number;
}

async function fetchSymbol(symbol: string, session: Session): Promise<Fetched | null> {
  const modules = [
    'defaultKeyStatistics', 'financialData', 'summaryProfile', 'summaryDetail',
    'price', 'calendarEvents', 'incomeStatementHistory',
  ].join(',');
  const qs = await getJson(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=${modules}&crumb=${encodeURIComponent(session.crumb)}`,
    session,
  );
  const result = get(qs, 'quoteSummary', 'result');
  if (!Array.isArray(result) || result.length === 0) return null;
  const s = result[0];

  await sleep(REQUEST_SPACING_MS);

  const ch = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`,
    session,
  );
  const chartResult = get(ch, 'chart', 'result');
  if (!Array.isArray(chartResult) || chartResult.length === 0) return null;
  const c0 = chartResult[0];
  const timestamps = (get(c0, 'timestamp') as number[]) ?? [];
  const adj = get(c0, 'indicators', 'adjclose', '0', 'adjclose') as number[] | undefined;
  const raw = get(c0, 'indicators', 'quote', '0', 'close') as number[] | undefined;
  const series = (adj ?? raw ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (series.length < 60) return null;

  const price = num(get(s, 'price', 'regularMarketPrice'));
  const marketCap = num(get(s, 'price', 'marketCap'));
  const high52 = num(get(s, 'summaryDetail', 'fiftyTwoWeekHigh'));
  const freeCashflow = num(get(s, 'financialData', 'freeCashflow'));

  const metrics: Metrics = {
    forwardPE: num(get(s, 'defaultKeyStatistics', 'forwardPE')),
    trailingPE: num(get(s, 'summaryDetail', 'trailingPE')),
    pegRatio: num(get(s, 'defaultKeyStatistics', 'pegRatio')),
    priceToBook: num(get(s, 'defaultKeyStatistics', 'priceToBook')),
    evToEbitda: num(get(s, 'defaultKeyStatistics', 'enterpriseToEbitda')),
    priceToSales: num(get(s, 'summaryDetail', 'priceToSalesTrailing12Months')),
    fcfYield: freeCashflow !== null && marketCap ? freeCashflow / marketCap : null,
    returnOnEquity: num(get(s, 'financialData', 'returnOnEquity')),
    returnOnAssets: num(get(s, 'financialData', 'returnOnAssets')),
    grossMargins: num(get(s, 'financialData', 'grossMargins')),
    operatingMargins: num(get(s, 'financialData', 'operatingMargins')),
    profitMargins: num(get(s, 'financialData', 'profitMargins')),
    debtToEquity: num(get(s, 'financialData', 'debtToEquity')),
    currentRatio: num(get(s, 'financialData', 'currentRatio')),
    revenueGrowth: num(get(s, 'financialData', 'revenueGrowth')),
    earningsGrowth: num(get(s, 'financialData', 'earningsGrowth')),
    marginTrend: marginTrend(s),
    momentum12_1: momentum12_1(series),
    pctFrom52High: price !== null && high52 ? (price - high52) / high52 : null,
    volatility: annualisedVol(series),
    maxDrawdown: maxDrawdown(series),
    trailingEps: num(get(s, 'defaultKeyStatistics', 'trailingEps')),
    ebitda: num(get(s, 'financialData', 'ebitda')),
    freeCashflow,
  };

  const earningsRaw = get(s, 'calendarEvents', 'earnings', 'earningsDate');
  const earningsTs = Array.isArray(earningsRaw) ? num(earningsRaw[0]) : null;

  const company: Company = {
    symbol,
    name: str(get(s, 'price', 'longName')) ?? str(get(s, 'price', 'shortName')) ?? symbol,
    sector: str(get(s, 'summaryProfile', 'sector')) ?? 'Unknown',
    industry: str(get(s, 'summaryProfile', 'industry')),
    marketCap,
    price,
    changePct: num(get(s, 'price', 'regularMarketChangePercent')),
    currency: str(get(s, 'price', 'currency')),
    financialCurrency: str(get(s, 'price', 'financialCurrency')),
    employees: num(get(s, 'summaryProfile', 'fullTimeEmployees')),
    description: str(get(s, 'summaryProfile', 'longBusinessSummary')),
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: num(get(s, 'summaryDetail', 'fiftyTwoWeekLow')),
    dividendYield: num(get(s, 'summaryDetail', 'dividendYield')),
    nextEarnings: earningsTs ? new Date(earningsTs * 1000).toISOString() : null,
    totalRevenue: num(get(s, 'financialData', 'totalRevenue')),
    metrics,
    spark: series.slice(-90),
    flags: [],
  };

  return {
    company,
    closes: series,
    timestamps,
    lastTimestamp: timestamps[timestamps.length - 1] ?? 0,
  };
}

// -------------------------------------------------------------------- main
interface PrevIndex {
  builtAt?: string;
  companies?: { symbol: string; sector: string; splitFingerprint?: number | null }[];
}

/** Close ~250 sessions back; if it moves between runs, history was rewritten. */
function splitFingerprint(closes: number[]): number | null {
  const i = closes.length - 250;
  return i >= 0 ? closes[i] : null;
}

async function main() {
  fs.mkdirSync(CHART_DIR, { recursive: true });

  let prev: PrevIndex = {};
  if (fs.existsSync(INDEX_PATH)) {
    try {
      prev = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    } catch {
      console.warn('previous index.json is unreadable — treating as absent');
    }
  }
  const prevBySymbol = new Map(
    (prev.companies ?? []).map((c) => [c.symbol, c] as const),
  );

  let session: Session;
  try {
    session = await handshake();
    console.log('handshake ok');
  } catch (e) {
    console.error('FATAL: Yahoo handshake failed —', e instanceof Error ? e.message : e);
    console.error('Keeping the previous cache rather than writing a half-empty file.');
    process.exit(1);
    return;
  }

  const fetched: Fetched[] = [];
  const failures: string[] = [];

  for (const symbol of UNIVERSE) {
    try {
      const f = await fetchSymbol(symbol, session);
      if (f) {
        fetched.push(f);
        process.stdout.write('.');
      } else {
        failures.push(symbol);
        process.stdout.write('x');
      }
    } catch (e) {
      failures.push(symbol);
      process.stdout.write('!');
      console.error(`\n  ${symbol}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(REQUEST_SPACING_MS);
  }
  console.log('');

  // --- Failure mode 1: partial fetch. Percentiles from a partial universe are
  // wrong for every company, so publishing one is worse than publishing nothing.
  const coverage = fetched.length / UNIVERSE.length;
  console.log(`fetched ${fetched.length}/${UNIVERSE.length} (${(coverage * 100).toFixed(1)}%)`);
  if (failures.length) console.log('missing:', failures.join(', '));
  if (coverage < MIN_COVERAGE) {
    console.error(
      `FATAL: coverage ${(coverage * 100).toFixed(1)}% is below the ${MIN_COVERAGE * 100}% floor. ` +
        'Aborting the write; the previous index.json stands.',
    );
    process.exit(1);
  }

  // --- Failure mode 2: market holiday. Stale data presented as current is
  // worse than no update at all.
  const newest = Math.max(...fetched.map((f) => f.lastTimestamp));
  const newestDay = new Date(newest * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (newestDay !== today) {
    console.log(`Latest close is ${newestDay}, today is ${today} — likely a market holiday.`);
    if (process.env.FORCE_BUILD !== '1') {
      console.log('Nothing new to publish. Exiting without rewriting the cache.');
      return;
    }
  }

  // --- Failure modes 3-5: split rewrites, cross-currency, sector drift.
  const currencies = new Map<string, number>();
  for (const f of fetched) {
    const cur = f.company.financialCurrency ?? 'UNKNOWN';
    currencies.set(cur, (currencies.get(cur) ?? 0) + 1);
  }
  const majority = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const f of fetched) {
    const before = prevBySymbol.get(f.company.symbol);
    if (before && before.sector !== f.company.sector) {
      console.log(
        `SECTOR CHANGE ${f.company.symbol}: ${before.sector} -> ${f.company.sector} ` +
          '(its entire peer group, and therefore its score, has changed)',
      );
    }
    const fp = splitFingerprint(f.closes);
    if (before?.splitFingerprint != null && fp != null) {
      const drift = Math.abs(fp / before.splitFingerprint - 1);
      if (drift > 0.01) {
        console.log(
          `HISTORY REWRITTEN ${f.company.symbol}: close 250 sessions back moved ` +
            `${(drift * 100).toFixed(1)}% — probable split adjustment.`,
        );
      }
    }
    // Fundamentals are reported in the company's own currency; comparing a
    // EUR-reporting market cap against USD ones produces nonsense percentiles.
    if (majority && f.company.financialCurrency && f.company.financialCurrency !== majority) {
      f.company.flags.push('CROSS_CURRENCY' as Flag);
    }
  }

  // --- Write one chart file per company: daily for a year, weekly beyond.
  for (const f of fetched) {
    const n = f.closes.length;
    const dailyFrom = Math.max(0, n - 252);
    const points: { t: number; c: number }[] = [];
    for (let i = 0; i < dailyFrom; i += 5) points.push({ t: f.timestamps[i], c: f.closes[i] });
    for (let i = dailyFrom; i < n; i++) points.push({ t: f.timestamps[i], c: f.closes[i] });
    fs.writeFileSync(
      path.join(CHART_DIR, `${f.company.symbol}.json`),
      JSON.stringify({ symbol: f.company.symbol, points }),
    );
  }

  const index = {
    builtAt: new Date().toISOString(),
    universeSize: UNIVERSE.length,
    fetched: fetched.length,
    missing: failures,
    companies: fetched.map((f) => ({
      ...f.company,
      splitFingerprint: splitFingerprint(f.closes),
    })),
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));

  const bytes = fs.statSync(INDEX_PATH).size;
  console.log(`wrote index.json (${(bytes / 1024).toFixed(0)} KB) and ${fetched.length} chart files`);
  if (bytes > 1.5 * 1024 * 1024) {
    console.warn('WARNING: index.json is over the 1.5 MB budget — trim fields or the universe.');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
