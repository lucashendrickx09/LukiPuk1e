import { CompanyProfile, Position, Quote } from '@/types';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';

// Aggregates position lots into one row per symbol, and provides the sort
// options used by the Portfolio screen.

export interface Holding {
  symbol: string;
  name: string;
  lots: Position[];
  shares: number;
  avgCost: number; // weighted average cost per share
  cost: number; // total invested
  price: number; // current (or last known) price
  value: number;
  pl: number; // total gain/loss in $
  plPct: number;
  dayChange: number; // $ move today across the position
  dayChangePct: number;
  sector: string;
  marketCapM: number;
  firstBuyDate: string;
}

export type SortKey =
  | 'value'
  | 'plPct'
  | 'pl'
  | 'dayChangePct'
  | 'marketCap'
  | 'alpha';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'value', label: 'Largest stake' },
  { key: 'plPct', label: '% gain' },
  { key: 'pl', label: 'Total gain' },
  { key: 'dayChangePct', label: 'Today’s move' },
  { key: 'marketCap', label: 'Market cap' },
  { key: 'alpha', label: 'A–Z' },
];

export function buildHoldings(args: {
  positions: Position[];
  quotes: Record<string, Quote>;
  profiles: Record<string, CompanyProfile>;
}): Holding[] {
  const { positions, quotes, profiles } = args;
  const bySymbol = new Map<string, Position[]>();
  for (const p of positions) {
    const list = bySymbol.get(p.symbol);
    if (list) list.push(p);
    else bySymbol.set(p.symbol, [p]);
  }

  const out: Holding[] = [];
  for (const [symbol, lots] of bySymbol) {
    const shares = lots.reduce((s, l) => s + l.shares, 0);
    if (shares <= 0) continue;
    const cost = lots.reduce((s, l) => s + l.shares * l.buyPrice, 0);
    const avgCost = shares > 0 ? cost / shares : 0;
    const quote = quotes[symbol];
    const price = quote?.price ?? avgCost;
    const value = shares * price;
    const pl = value - cost;
    const dayChange = shares * (quote?.change ?? 0);
    const profile = profiles[symbol];
    out.push({
      symbol,
      name: profile?.name ?? lots[0].name ?? UNIVERSE_BY_SYMBOL.get(symbol)?.fallbackName ?? symbol,
      lots: [...lots].sort((a, b) => a.buyDate.localeCompare(b.buyDate)),
      shares,
      avgCost,
      cost,
      price,
      value,
      pl,
      plPct: cost > 0 ? (pl / cost) * 100 : 0,
      dayChange,
      dayChangePct: quote?.changePct ?? 0,
      sector:
        profile?.sector ?? UNIVERSE_BY_SYMBOL.get(symbol)?.fallbackSector ?? 'Other',
      marketCapM: profile?.marketCapM ?? 0,
      firstBuyDate: lots.reduce((min, l) => (l.buyDate < min ? l.buyDate : min), lots[0].buyDate),
    });
  }
  return out;
}

export function sortHoldings(holdings: Holding[], key: SortKey): Holding[] {
  const copy = [...holdings];
  switch (key) {
    case 'plPct':
      return copy.sort((a, b) => b.plPct - a.plPct);
    case 'pl':
      return copy.sort((a, b) => b.pl - a.pl);
    case 'dayChangePct':
      return copy.sort((a, b) => b.dayChangePct - a.dayChangePct);
    case 'marketCap':
      return copy.sort((a, b) => b.marketCapM - a.marketCapM);
    case 'alpha':
      return copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
    case 'value':
    default:
      return copy.sort((a, b) => b.value - a.value);
  }
}
