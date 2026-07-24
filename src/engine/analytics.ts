import { Candle, KeyMetrics, Position, Quote } from '@/types';

// Institutional-style portfolio analytics: risk-adjusted return, market
// sensitivity, and diversification. History-based metrics need daily candles;
// when those aren't available the result flags it so the UI can degrade
// gracefully. Beta/valuation come from per-stock fundamentals (no history).

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const RF = 0.04; // assumed annual risk-free rate
const TRADING_DAYS = 252;

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function cov(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}
function corr(a: number[], b: number[]): number {
  const sa = std(a);
  const sb = std(b);
  if (sa === 0 || sb === 0) return 0;
  return cov(a, b) / (sa * sb);
}

function dailyReturns(candles: Candle[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1].close;
    if (p > 0) m.set(candles[i].date, candles[i].close / p - 1);
  }
  return m;
}

export interface CorrCell {
  a: string;
  b: string;
  value: number;
}

export interface AnalyticsResult {
  // overview
  totalValue: number;
  totalPlPct: number;
  dayPct: number;
  holdings: number;
  // diversification (no history needed)
  effectiveHoldings: number; // 1 / HHI
  hhi: number;
  topWeightSymbol: string;
  topWeightPct: number;
  topSector: string;
  topSectorPct: number;
  // weighted fundamentals (from per-stock metrics)
  weightedBeta: number | null;
  weightedPE: number | null;
  weightedDivYield: number | null;
  // risk-adjusted (history)
  hasHistory: boolean;
  annReturnPct: number;
  annVolPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  bestDayPct: number;
  worstDayPct: number;
  upDaysPct: number;
  windowDays: number;
  // market sensitivity vs benchmark (history)
  hasBenchmark: boolean;
  betaRegression: number;
  alphaPct: number;
  rSquaredPct: number;
  informationRatio: number;
  // correlations among holdings
  correlations: CorrCell[];
  corrSymbols: string[];
  // --- visual series ---
  monthlyReturns: { label: string; value: number }[]; // % per calendar month
  drawdownSeries: number[]; // % below running peak, <= 0
  equityCurve: number[]; // growth of 1 unit over the window
  benchEquityCurve: number[]; // benchmark, same window
  benchAnnReturnPct: number;
  benchAnnVolPct: number;
  benchMaxDrawdownPct: number;
  contributors: { symbol: string; pl: number; sharePct: number }[]; // P/L attribution
  sectorWeights: { label: string; value: number }[];
  capWeights: { label: string; value: number }[];
  positionWeights: { label: string; value: number }[];
}

export function computeAnalytics(args: {
  positions: Position[];
  quotes: Record<string, Quote>;
  metricsBySymbol: Record<string, KeyMetrics>;
  sectorOf: (symbol: string) => string;
  /** Market-cap tier per symbol, for the cap-size breakdown. */
  capTierOf?: (symbol: string) => string;
  candlesBySymbol: Record<string, Candle[]>;
  benchmark: Candle[] | null;
}): AnalyticsResult {
  const { positions, quotes, metricsBySymbol, sectorOf, candlesBySymbol, benchmark } = args;
  const capTierLabelFor = args.capTierOf ?? (() => 'Unclassified');
  const priceOf = (p: Position) => quotes[p.symbol]?.price ?? p.buyPrice;

  // Positions are stored as individual lots; collapse them to one row per
  // symbol first. Keying by symbol without this would overwrite duplicate lots
  // (wrong weights/HHI) and double-count them in the return series.
  const bySymbol = new Map<string, { symbol: string; value: number; cost: number; dayChange: number }>();
  for (const p of positions) {
    const row = bySymbol.get(p.symbol) ?? { symbol: p.symbol, value: 0, cost: 0, dayChange: 0 };
    row.value += p.shares * priceOf(p);
    row.cost += p.shares * p.buyPrice;
    row.dayChange += p.shares * (quotes[p.symbol]?.change ?? 0);
    bySymbol.set(p.symbol, row);
  }
  const rows = [...bySymbol.values()];
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const dayChange = rows.reduce((s, r) => s + r.dayChange, 0);
  const totalPlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  const dayBase = totalValue - dayChange;
  const dayPct = dayBase > 0 ? (dayChange / dayBase) * 100 : 0;

  const weights = new Map(rows.map((r) => [r.symbol, totalValue > 0 ? r.value / totalValue : 0]));

  // Diversification
  const hhi = [...weights.values()].reduce((s, w) => s + w * w, 0);
  const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0] ?? ['', 0];
  const sectorW = new Map<string, number>();
  for (const [sym, w] of weights) {
    const sec = sectorOf(sym);
    sectorW.set(sec, (sectorW.get(sec) ?? 0) + w);
  }
  const topSec = [...sectorW.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

  // Weighted fundamentals (renormalised over the weight we have data for)
  const wAvg = (pick: (m: KeyMetrics) => number | undefined, guard?: (v: number) => boolean) => {
    let acc = 0;
    let cover = 0;
    for (const [sym, w] of weights) {
      const v = metricsBySymbol[sym] ? pick(metricsBySymbol[sym]) : undefined;
      if (v === undefined || !isFinite(v) || (guard && !guard(v))) continue;
      acc += w * v;
      cover += w;
    }
    return cover > 0 ? acc / cover : null;
  };
  const weightedBeta = wAvg((m) => m.beta);
  const weightedPE = wAvg((m) => m.peTTM, (v) => v > 0);
  const weightedDivYield = wAvg((m) => m.dividendYield);

  // History-based portfolio daily returns (current-weight approximation)
  const series = rows
    .map((row) => ({
      w: weights.get(row.symbol) ?? 0,
      r: candlesBySymbol[row.symbol]
        ? dailyReturns(candlesBySymbol[row.symbol])
        : new Map<string, number>(),
    }))
    .filter((s) => s.r.size > 0 && s.w > 0);

  let portByDate: { date: string; r: number }[] = [];
  if (series.length > 0) {
    const wsum = series.reduce((s, x) => s + x.w, 0) || 1;
    const common = [...series[0].r.keys()].filter((d) => series.every((s) => s.r.has(d)));
    portByDate = common
      .slice(-TRADING_DAYS)
      .map((d) => ({ date: d, r: series.reduce((s, x) => s + (x.w / wsum) * (x.r.get(d) as number), 0) }));
  }
  const portRet = portByDate.map((x) => x.r);
  const hasHistory = portRet.length >= 30;

  const annReturn = mean(portRet) * TRADING_DAYS;
  const annVol = std(portRet) * Math.sqrt(TRADING_DAYS);
  const sharpe = annVol > 0 ? (annReturn - RF) / annVol : 0;
  const downside = portRet.map((r) => Math.min(r - RF / TRADING_DAYS, 0));
  const downsideDev = Math.sqrt(mean(downside.map((d) => d * d))) * Math.sqrt(TRADING_DAYS);
  const sortino = downsideDev > 0 ? (annReturn - RF) / downsideDev : 0;

  let peak = 1;
  let cum = 1;
  let mdd = 0;
  for (const r of portRet) {
    cum *= 1 + r;
    peak = Math.max(peak, cum);
    if (peak > 0) mdd = Math.min(mdd, (cum - peak) / peak);
  }
  const upDays = portRet.filter((r) => r > 0).length;

  // Benchmark sensitivity
  let hasBenchmark = false;
  let betaRegression = 0;
  let alphaPct = 0;
  let rSquaredPct = 0;
  let informationRatio = 0;
  if (hasHistory && benchmark) {
    const benchRet = dailyReturns(benchmark);
    const paired = portByDate.filter((x) => benchRet.has(x.date));
    if (paired.length >= 30) {
      const p = paired.map((x) => x.r);
      const b = paired.map((x) => benchRet.get(x.date) as number);
      const varB = std(b) ** 2;
      betaRegression = varB > 0 ? cov(p, b) / varB : 0;
      const benchAnn = mean(b) * TRADING_DAYS;
      const portAnn = mean(p) * TRADING_DAYS;
      alphaPct = (portAnn - (RF + betaRegression * (benchAnn - RF))) * 100;
      rSquaredPct = corr(p, b) ** 2 * 100;
      const diff = p.map((v, i) => v - b[i]);
      const te = std(diff) * Math.sqrt(TRADING_DAYS);
      informationRatio = te > 0 ? (mean(diff) * TRADING_DAYS) / te : 0;
      hasBenchmark = true;
    }
  }

  // Correlation matrix among the top holdings (by weight)
  const correlations: CorrCell[] = [];
  const topSyms = sorted.slice(0, 6).map(([s]) => s).filter((s) => candlesBySymbol[s]);
  const retMaps = new Map(topSyms.map((s) => [s, dailyReturns(candlesBySymbol[s])]));
  for (let i = 0; i < topSyms.length; i++) {
    for (let j = i + 1; j < topSyms.length; j++) {
      const ra = retMaps.get(topSyms[i])!;
      const rb = retMaps.get(topSyms[j])!;
      const dates = [...ra.keys()].filter((d) => rb.has(d)).slice(-TRADING_DAYS);
      if (dates.length < 30) continue;
      const a = dates.map((d) => ra.get(d) as number);
      const b = dates.map((d) => rb.get(d) as number);
      correlations.push({ a: topSyms[i], b: topSyms[j], value: corr(a, b) });
    }
  }

  // ---- visual series -------------------------------------------------
  // Equity curve + drawdown path from the portfolio's daily returns.
  const equityCurve: number[] = [];
  const drawdownSeries: number[] = [];
  {
    let c = 1;
    let pk = 1;
    for (const r of portRet) {
      c *= 1 + r;
      pk = Math.max(pk, c);
      equityCurve.push(c);
      drawdownSeries.push(pk > 0 ? ((c - pk) / pk) * 100 : 0);
    }
  }

  // Calendar-month returns for the bar chart.
  const monthAgg = new Map<string, number>();
  for (const { date, r } of portByDate) {
    const m = date.slice(0, 7);
    monthAgg.set(m, (monthAgg.get(m) ?? 1) * (1 + r));
  }
  const monthlyReturns = [...monthAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([m, growth]) => ({
      label: MONTH_LABELS[parseInt(m.slice(5, 7), 10) - 1] ?? m.slice(5, 7),
      value: (growth - 1) * 100,
    }));

  // Benchmark stats + curve over the same window.
  let benchEquityCurve: number[] = [];
  let benchAnnReturnPct = 0;
  let benchAnnVolPct = 0;
  let benchMaxDrawdownPct = 0;
  if (benchmark) {
    const bRet = dailyReturns(benchmark);
    const dates = portByDate.filter((x) => bRet.has(x.date)).map((x) => x.date);
    const b = dates.map((d) => bRet.get(d) as number);
    if (b.length >= 2) {
      benchAnnReturnPct = mean(b) * TRADING_DAYS * 100;
      benchAnnVolPct = std(b) * Math.sqrt(TRADING_DAYS) * 100;
      let c = 1;
      let pk = 1;
      let dd = 0;
      for (const r of b) {
        c *= 1 + r;
        pk = Math.max(pk, c);
        dd = Math.min(dd, (c - pk) / pk);
        benchEquityCurve.push(c);
      }
      benchMaxDrawdownPct = dd * 100;
    }
  }

  // P/L attribution — who actually drove the gains.
  const totalAbsPl = rows.reduce((s, r) => s + Math.abs(r.value - r.cost), 0) || 1;
  const contributors = rows
    .map((r) => ({
      symbol: r.symbol,
      pl: r.value - r.cost,
      sharePct: (Math.abs(r.value - r.cost) / totalAbsPl) * 100,
    }))
    .sort((a, b) => b.pl - a.pl);

  const sectorWeights = [...sectorW.entries()]
    .map(([label, w]) => ({ label, value: w * 100 }))
    .sort((a, b) => b.value - a.value);

  const capBuckets = new Map<string, number>();
  for (const [sym, w] of weights) {
    const tier = capTierLabelFor(sym);
    capBuckets.set(tier, (capBuckets.get(tier) ?? 0) + w * 100);
  }
  const capWeights = [...capBuckets.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const positionWeights = [...weights.entries()]
    .map(([label, w]) => ({ label, value: w * 100 }))
    .sort((a, b) => b.value - a.value);

  return {
    monthlyReturns,
    drawdownSeries,
    equityCurve,
    benchEquityCurve,
    benchAnnReturnPct,
    benchAnnVolPct,
    benchMaxDrawdownPct,
    contributors,
    sectorWeights,
    capWeights,
    positionWeights,
    corrSymbols: topSyms,
    totalValue,
    totalPlPct,
    dayPct,
    holdings: positions.length,
    effectiveHoldings: hhi > 0 ? 1 / hhi : 0,
    hhi,
    topWeightSymbol: top[0] as string,
    topWeightPct: (top[1] as number) * 100,
    topSector: topSec[0] as string,
    topSectorPct: (topSec[1] as number) * 100,
    weightedBeta,
    weightedPE,
    weightedDivYield,
    hasHistory,
    annReturnPct: annReturn * 100,
    annVolPct: annVol * 100,
    sharpe,
    sortino,
    maxDrawdownPct: mdd * 100,
    bestDayPct: portRet.length ? Math.max(...portRet) * 100 : 0,
    worstDayPct: portRet.length ? Math.min(...portRet) * 100 : 0,
    upDaysPct: portRet.length ? (upDays / portRet.length) * 100 : 0,
    windowDays: portRet.length,
    hasBenchmark,
    betaRegression,
    alphaPct,
    rSquaredPct,
    informationRatio,
    correlations,
  };
}
