import { CatalogEntry, Position } from '@/types';
import { fmtPct } from '@/utils/format';

// Portfolio suggestions — cross-references your holdings against your catalog:
// surfaces underperformers to review, strong catalog picks you don't own, sector
// concentration, and possible rotations. Educational only, never advice.

export type RecKind = 'trim' | 'add' | 'diversify' | 'rotate';

export interface Recommendation {
  id: string;
  kind: RecKind;
  title: string;
  detail: string;
  symbols: string[]; // related symbols (first is the tap-through target)
  severity: 'high' | 'medium' | 'low';
}

const UNDERPERFORM_PCT = -8;
const STRONG_SCORE = 65;
const CONCENTRATION = 0.4;

const combined = (e: CatalogEntry) => (e.card.longTermScore + e.card.momentumScore) / 2;

export function buildRecommendations(args: {
  positions: Position[];
  priceOf: (p: Position) => number;
  sectorOf: (symbol: string) => string;
  catalog: CatalogEntry[];
}): Recommendation[] {
  const { positions, priceOf, sectorOf, catalog } = args;
  if (positions.length === 0) return [];

  const recs: Recommendation[] = [];
  const owned = new Set(positions.map((p) => p.symbol));

  const withPl = positions.map((p) => {
    const price = priceOf(p);
    return {
      p,
      value: p.shares * price,
      plPct: ((price - p.buyPrice) / p.buyPrice) * 100,
    };
  });
  const total = withPl.reduce((s, x) => s + x.value, 0) || 1;

  const sectorValue = new Map<string, number>();
  for (const x of withPl) {
    const sec = sectorOf(x.p.symbol);
    sectorValue.set(sec, (sectorValue.get(sec) ?? 0) + x.value);
  }

  const picks = catalog
    .filter((e) => !owned.has(e.card.symbol))
    .sort((a, b) => combined(b) - combined(a));
  const bestPick = picks[0];

  // 1. Underperformers worth reviewing
  const losers = withPl
    .filter((x) => x.plPct <= UNDERPERFORM_PCT)
    .sort((a, b) => a.plPct - b.plPct);
  for (const l of losers.slice(0, 3)) {
    recs.push({
      id: 'trim-' + l.p.id,
      kind: 'trim',
      title: `Review ${l.p.symbol} · ${fmtPct(l.plPct)}`,
      detail: `${l.p.symbol} is among your weakest holdings. Re-check why you bought it — if the thesis has broken, trimming frees capital for a higher-conviction idea.`,
      symbols: [l.p.symbol],
      severity: l.plPct <= -20 ? 'high' : 'medium',
    });
  }

  // 2. Rotation: pair the worst loser with the best cross-sector catalog pick
  if (losers.length && bestPick && combined(bestPick) >= STRONG_SCORE) {
    const worst = losers[0];
    if (sectorOf(worst.p.symbol) !== bestPick.card.profile.sector) {
      recs.push({
        id: `rotate-${worst.p.symbol}-${bestPick.card.symbol}`,
        kind: 'rotate',
        title: `Rotate ${worst.p.symbol} → ${bestPick.card.symbol}?`,
        detail: `Your weakest holding ${worst.p.symbol} (${fmtPct(
          worst.plPct,
        )}) and your strongest catalog pick ${bestPick.card.symbol} (score ${Math.round(
          combined(bestPick),
        )}, ${bestPick.card.profile.sector}) are in different sectors — a candidate rotation if your conviction in ${worst.p.symbol} has faded.`,
        symbols: [worst.p.symbol, bestPick.card.symbol],
        severity: 'medium',
      });
    }
  }

  // 3. Sector concentration
  let topSector = '';
  let topWeight = 0;
  for (const [sec, val] of sectorValue) {
    const w = val / total;
    if (w > topWeight) {
      topWeight = w;
      topSector = sec;
    }
  }
  if (topWeight >= CONCENTRATION) {
    const diversifier = picks.find(
      (e) => e.card.profile.sector !== topSector && combined(e) >= 55,
    );
    recs.push({
      id: 'diversify-' + topSector,
      kind: 'diversify',
      title: `${Math.round(topWeight * 100)}% in ${topSector}`,
      detail: diversifier
        ? `${topSector} is your largest exposure. ${diversifier.card.symbol} in your catalog (${diversifier.card.profile.sector}) could spread that concentration.`
        : `${topSector} is your largest exposure. Catalog a strong name in another sector to balance it out.`,
      symbols: diversifier ? [diversifier.card.symbol] : [],
      severity: topWeight >= 0.6 ? 'high' : 'low',
    });
  }

  // 4. Strong catalog picks you don't own yet
  for (const e of picks.filter((p) => combined(p) >= STRONG_SCORE).slice(0, 2)) {
    if (recs.some((r) => r.kind === 'rotate' && r.symbols.includes(e.card.symbol))) continue;
    recs.push({
      id: 'add-' + e.card.symbol,
      kind: 'add',
      title: `Consider ${e.card.symbol} · score ${Math.round(combined(e))}`,
      detail: `You catalogued ${e.card.profile.name} but don't own it yet. ${e.card.thesis.hook}`,
      symbols: [e.card.symbol],
      severity: 'low',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
}

export function recKindLabel(kind: RecKind): string {
  return { trim: 'Review', add: 'Add', diversify: 'Diversify', rotate: 'Rotate' }[kind];
}
