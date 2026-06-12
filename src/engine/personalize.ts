import { CapTier, SignalSummary, SourceType, SwipeRecord } from '@/types';

// "Learn, but show why": right-swipes upweight similar profiles, left-swipes
// downweight them, and every card carries a human-readable tag explaining why
// it surfaced. Only the last 90 days of swipes count.

export interface TasteWeights {
  sector: Record<string, number>;
  capTier: Record<string, number>;
}

export function buildWeights(swipes: SwipeRecord[]): TasteWeights {
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  const weights: TasteWeights = { sector: {}, capTier: {} };
  for (const s of swipes) {
    if (new Date(s.at).getTime() < cutoff) continue;
    const w = s.direction === 'right' ? 2 : -1;
    weights.sector[s.sector] = (weights.sector[s.sector] ?? 0) + w;
    weights.capTier[s.capTier] = (weights.capTier[s.capTier] ?? 0) + w;
  }
  return weights;
}

export function tasteBonus(weights: TasteWeights, sector: string, capTier: CapTier): number {
  const s = weights.sector[sector] ?? 0;
  const c = weights.capTier[capTier] ?? 0;
  return Math.max(-12, Math.min(12, s * 3 + c * 1.5));
}

export function buildWhyTag(
  sourceTypes: SourceType[],
  signals: SignalSummary,
  bonus: number,
  sector: string,
): string {
  const parts: string[] = [];
  if (sourceTypes.includes('analyst') && signals.analyst) {
    parts.push(`${Math.round(signals.analyst.buyRatio * 100)}% analyst buy lean`);
  }
  if (sourceTypes.includes('news') && signals.news) {
    parts.push(`bullish coverage (${signals.news.articles} articles this week)`);
  }
  if (sourceTypes.includes('filing')) {
    parts.push('fresh company filing');
  }
  let tag = parts.length > 0 ? parts.join(' + ') : 'momentum screen';
  if (bonus >= 5) tag += ` · matches your right-swipes in ${sector}`;
  if (bonus <= -5) tag += ` · shown despite your ${sector} left-swipes`;
  return tag;
}
