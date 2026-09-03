// Factor definitions for the swipe screener.
//
// Every factor carries a direction — whether a larger raw value is better — and
// an optional gate that must hold before the factor means anything at all. A
// company with negative earnings has no meaningful P/E, so the gate drops the
// factor rather than substituting a placeholder.

export type Direction = 'higher' | 'lower';
export type Gate = 'positiveEarnings' | 'positiveEbitda' | 'positiveFcf' | null;

export interface FactorDef {
  dir: Direction;
  requires: Gate;
}

export type BucketName = 'valuation' | 'quality' | 'growth' | 'momentum';

export const FACTORS: Record<BucketName, Record<string, FactorDef>> = {
  valuation: {
    forwardPE: { dir: 'lower', requires: 'positiveEarnings' },
    evToEbitda: { dir: 'lower', requires: 'positiveEbitda' },
    fcfYield: { dir: 'higher', requires: 'positiveFcf' },
    priceToSales: { dir: 'lower', requires: null },
  },
  quality: {
    returnOnEquity: { dir: 'higher', requires: null },
    grossMargins: { dir: 'higher', requires: null },
    profitMargins: { dir: 'higher', requires: null },
    debtToEquity: { dir: 'lower', requires: null },
    currentRatio: { dir: 'higher', requires: null },
  },
  growth: {
    revenueGrowth: { dir: 'higher', requires: null },
    earningsGrowth: { dir: 'higher', requires: null },
    marginTrend: { dir: 'higher', requires: null }, // 3y change in operating margin
  },
  momentum: {
    momentum12_1: { dir: 'higher', requires: null },
    pctFrom52High: { dir: 'higher', requires: null },
  },
};

export const BUCKETS: BucketName[] = ['valuation', 'quality', 'growth', 'momentum'];

/** User-adjustable in settings; must sum to 1. */
export const DEFAULT_WEIGHTS: Record<BucketName, number> = {
  valuation: 0.35,
  quality: 0.3,
  growth: 0.25,
  momentum: 0.1,
};

export const DEFAULT_LAMBDA = 0.5;
export const DEFAULT_MIN_MARKET_CAP = 2_000_000_000;
export const DEFAULT_DISMISS_DAYS = 90;

/** A sector needs this many peers before its percentiles mean anything. */
export const MIN_SECTOR_PEERS = 8;

/** Every Nth feed slot is reserved for a sector at zero portfolio weight. */
export const DIVERSIFY_EVERY = 7;

export type Flag =
  | 'SMALL_SECTOR_PEER_GROUP'
  | 'VALUATION_INSUFFICIENT_DATA'
  | 'QUALITY_INSUFFICIENT_DATA'
  | 'GROWTH_INSUFFICIENT_DATA'
  | 'MOMENTUM_INSUFFICIENT_DATA'
  | 'CONCENTRATION_PENALTY'
  | 'OUTSIDE_YOUR_SECTORS'
  | 'CROSS_CURRENCY';

export interface Metrics {
  // Valuation
  forwardPE: number | null;
  trailingPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  fcfYield: number | null;
  // Quality
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  // Growth
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  marginTrend: number | null;
  // Momentum / risk
  momentum12_1: number | null;
  pctFrom52High: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  // Gate inputs
  trailingEps: number | null;
  ebitda: number | null;
  freeCashflow: number | null;
}

export interface Company {
  symbol: string;
  name: string;
  sector: string;
  industry: string | null;
  marketCap: number | null;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  financialCurrency: string | null;
  employees: number | null;
  description: string | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  dividendYield: number | null;
  nextEarnings: string | null;
  totalRevenue: number | null;
  metrics: Metrics;
  /** 90 daily closes for the card sparkline. */
  spark: number[];
  flags: Flag[];
}

/**
 * Gates decide whether a factor is meaningful for this company at all — not
 * whether it scores well. A failed gate removes the factor from both the
 * company's score and the peer population it would have been ranked against.
 */
export function gateSatisfied(company: Company, requirement: Gate): boolean {
  const m = company.metrics;
  switch (requirement) {
    case 'positiveEarnings':
      return m.trailingEps !== null && m.trailingEps > 0;
    case 'positiveEbitda':
      return m.ebitda !== null && m.ebitda > 0;
    case 'positiveFcf':
      return m.freeCashflow !== null && m.freeCashflow > 0;
    case null:
      return true;
    default:
      return true;
  }
}

/** Human-readable reason a bucket went unscored, for the card. */
export function unscoredReason(company: Company, bucket: BucketName): string {
  if (bucket === 'valuation') {
    const m = company.metrics;
    if (m.trailingEps !== null && m.trailingEps <= 0) return 'Valuation not scored — negative earnings.';
    if (m.ebitda !== null && m.ebitda <= 0) return 'Valuation not scored — negative EBITDA.';
  }
  return `${bucket[0].toUpperCase()}${bucket.slice(1)} not scored — not enough data.`;
}
