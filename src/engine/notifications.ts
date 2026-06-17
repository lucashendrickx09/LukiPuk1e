import { CatalogEntry, NotificationDraft, Position, Quote } from '@/types';
import { fmtMoney, fmtPct } from '@/utils/format';

// Pure generators for the notification types. Each returns a draft (or null);
// the store handles dedupe, persistence, and OS delivery.

export function buildMorningDebrief(
  positions: Position[],
  quotes: Record<string, Quote>,
  day: string,
): NotificationDraft | null {
  if (positions.length === 0) return null;
  const priceOf = (p: Position) => quotes[p.symbol]?.price ?? p.buyPrice;
  const totalValue = positions.reduce((s, p) => s + p.shares * priceOf(p), 0);
  const totalCost = positions.reduce((s, p) => s + p.shares * p.buyPrice, 0);
  const totalPlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  const dayChange = positions.reduce((s, p) => s + p.shares * (quotes[p.symbol]?.change ?? 0), 0);
  const dayBase = totalValue - dayChange;
  const dayPct = dayBase > 0 ? (dayChange / dayBase) * 100 : 0;

  const moves = positions
    .map((p) => ({ sym: p.symbol, pct: quotes[p.symbol]?.changePct ?? 0 }))
    .sort((a, b) => b.pct - a.pct);
  const best = moves[0];
  const worst = moves[moves.length - 1];

  const sign = dayChange >= 0 ? '+' : '';
  const title = `Morning debrief: ${sign}${fmtMoney(dayChange, 0)} today`;
  let body = `Portfolio ${fmtMoney(totalValue, 0)} · ${fmtPct(totalPlPct)} all-time. Today ${fmtPct(dayPct)}.`;
  if (best && worst && best.sym !== worst.sym) {
    body += ` ${best.sym} led (${fmtPct(best.pct)}); ${worst.sym} lagged (${fmtPct(worst.pct)}).`;
  }
  const severity = Math.abs(dayPct) >= 3 ? 'important' : 'normal';
  return {
    key: `debrief-${day}`,
    type: 'debrief',
    severity,
    title,
    body,
    symbols: positions.map((p) => p.symbol),
  };
}

export function buildCatalogAlerts(
  entries: CatalogEntry[],
  quotes: Record<string, Quote>,
  day: string,
): NotificationDraft[] {
  const out: NotificationDraft[] = [];
  for (const e of entries) {
    const q = quotes[e.card.symbol];
    if (!q) continue;
    const pct = q.changePct;
    if (Math.abs(pct) < 5) continue;
    const severity = Math.abs(pct) >= 10 ? 'urgent' : 'important';
    const dir = pct >= 0 ? 'jumped' : 'dropped';
    out.push({
      key: `catalog-${e.card.symbol}-${day}`,
      type: 'catalog',
      severity,
      title: `${e.card.symbol} ${dir} ${fmtPct(pct)} today`,
      body: `${e.card.profile.name} moved ${fmtPct(pct)} today — it's on your catalog watchlist.`,
      symbols: [e.card.symbol],
    });
  }
  return out;
}

export function buildMarketRecap(headlines: { headline: string }[], day: string): NotificationDraft {
  if (headlines.length === 0) {
    return {
      key: `market-${day}`,
      type: 'market',
      severity: 'normal',
      title: 'Market recap',
      body: 'Add a Finnhub key in Settings to get live market headlines here each day.',
    };
  }
  const body = headlines
    .slice(0, 3)
    .map((h) => `• ${h.headline}`)
    .join('\n');
  return {
    key: `market-${day}`,
    type: 'market',
    severity: 'normal',
    title: 'Market recap — top stories',
    body,
  };
}
