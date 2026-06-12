import { NewsItem, RecommendationTrend } from '@/api/finnhub';
import { SignalSummary } from '@/types';

// Cheap structured signals — stage one of the hybrid pipeline. These decide
// WHICH companies are worth spending an LLM call on; the prose comes later.

export function analystSignal(trends: RecommendationTrend[]): SignalSummary['analyst'] {
  if (!trends.length) return null;
  const ratio = (t: RecommendationTrend) => {
    const total = t.strongBuy + t.buy + t.hold + t.sell + t.strongSell;
    return total > 0 ? (t.strongBuy + t.buy) / total : 0;
  };
  const latest = trends[0];
  const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;
  if (total < 3) return null; // too thin a consensus to mean anything
  const buyRatio = ratio(latest);
  const past = trends[Math.min(2, trends.length - 1)];
  const delta = buyRatio - ratio(past);
  // Positive when the street clearly leans buy, or the lean is improving.
  const positive = buyRatio >= 0.6 || (buyRatio >= 0.5 && delta > 0.02);
  return { positive, buyRatio, delta, total };
}

const POSITIVE_WORDS = [
  'beat', 'beats', 'tops', 'record', 'surge', 'surges', 'soar', 'soars', 'jump', 'jumps',
  'rally', 'upgrade', 'upgraded', 'raises', 'raised', 'boost', 'boosts', 'strong', 'growth',
  'profit', 'wins', 'win', 'approval', 'approved', 'expands', 'expansion', 'partnership',
  'breakthrough', 'outperform', 'buyback', 'dividend increase', 'guidance raise', 'bullish',
];

const NEGATIVE_WORDS = [
  'miss', 'misses', 'falls', 'fall', 'drop', 'drops', 'plunge', 'plunges', 'sink', 'sinks',
  'downgrade', 'downgraded', 'cuts', 'cut', 'lawsuit', 'probe', 'investigation', 'recall',
  'layoffs', 'weak', 'warning', 'warns', 'decline', 'bearish', 'fraud', 'fine', 'penalty',
  'underperform', 'guidance cut', 'shortfall', 'halt', 'delisting',
];

export function newsSignal(items: NewsItem[]): SignalSummary['news'] {
  if (items.length < 3) return null; // not enough coverage to read a direction
  let pos = 0;
  let neg = 0;
  for (const item of items) {
    const text = (item.headline + ' ' + (item.summary || '')).toLowerCase();
    if (POSITIVE_WORDS.some((w) => text.includes(w))) pos++;
    if (NEGATIVE_WORDS.some((w) => text.includes(w))) neg++;
  }
  const scored = pos + neg;
  const score = scored > 0 ? (pos - neg) / scored : 0;
  const positive = score >= 0.25 && pos >= 2;
  const topHeadlines = items
    .slice(0, 25)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 5)
    .map((n) => ({ headline: n.headline, source: n.source, url: n.url }));
  return { positive, score, articles: items.length, topHeadlines };
}

export function filingSignal(
  recent8K: number | null,
  otherSignalsPositive: boolean,
): SignalSummary['filing'] {
  if (recent8K === null) return null;
  // An 8-K is direction-less on its own — it confirms a real catalyst exists.
  // It only counts as a positive source when news/analyst direction is positive.
  return { positive: recent8K > 0 && otherSignalsPositive, recent8K };
}
