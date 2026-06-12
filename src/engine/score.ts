import { Candle, KeyMetrics, SignalSummary, SourceType } from '@/types';
import { pctReturn, sma } from '@/api/stooq';

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// Long-term score: quality + street conviction + sane valuation. 0–100.
export function longTermScore(signals: SignalSummary, metrics: KeyMetrics): number {
  let score = 50;
  if (signals.analyst) {
    score += (signals.analyst.buyRatio - 0.5) * 60; // street lean: ±30
    score += Math.max(-10, Math.min(10, signals.analyst.delta * 100)); // improving lean
  }
  if (metrics.grossMarginTTM !== undefined) {
    score += metrics.grossMarginTTM > 40 ? 8 : metrics.grossMarginTTM > 25 ? 3 : -4;
  }
  if (metrics.revenueGrowthTTMYoy !== undefined) {
    score += metrics.revenueGrowthTTMYoy > 15 ? 8 : metrics.revenueGrowthTTMYoy > 5 ? 4 : -3;
  }
  if (metrics.peTTM !== undefined) {
    if (metrics.peTTM > 0 && metrics.peTTM < 35) score += 5;
    else if (metrics.peTTM > 80 || metrics.peTTM <= 0) score -= 6;
  }
  if (metrics.dividendYield !== undefined && metrics.dividendYield > 1.5) score += 3;
  return clamp(score);
}

// Momentum score: attention + price strength. 0–100.
export function momentumScore(signals: SignalSummary, candles: Candle[] | null): number {
  let score = 50;
  if (signals.news) {
    score += signals.news.score * 20; // sentiment direction: ±20
    score += Math.min(10, signals.news.articles / 4); // coverage velocity
  }
  if (signals.filing?.positive) score += 5;
  if (candles && candles.length > 60) {
    const r1m = pctReturn(candles, 21);
    const r3m = pctReturn(candles, 63);
    const ma50 = sma(candles, 50);
    const last = candles[candles.length - 1].close;
    if (r1m !== null) score += Math.max(-12, Math.min(12, r1m));
    if (r3m !== null) score += Math.max(-8, Math.min(8, r3m / 3));
    if (ma50 !== null) score += last > ma50 ? 6 : -6;
  }
  return clamp(score);
}

export function positiveSourceTypes(signals: SignalSummary): SourceType[] {
  const types: SourceType[] = [];
  if (signals.analyst?.positive) types.push('analyst');
  if (signals.news?.positive) types.push('news');
  if (signals.filing?.positive) types.push('filing');
  return types;
}

// The consensus gate from the spec: how many independent source types must
// agree before a company earns a swipe card. Strictness comes from Settings.
export function passesGate(sourceTypes: SourceType[], strictness: 1 | 2 | 3): boolean {
  return sourceTypes.length >= strictness;
}
