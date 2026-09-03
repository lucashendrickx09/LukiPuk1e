import {
  BUCKETS,
  BucketName,
  Company,
  FACTORS,
  Flag,
  gateSatisfied,
  MIN_SECTOR_PEERS,
} from './factors';
import { percentileRank } from './percentile';

// Scoring runs entirely on the cached universe — no network, no per-swipe work.
// Percentiles are sector-relative, missing factors are dropped rather than
// filled in, and a bucket that loses too many factors goes unscored instead of
// pretending a two-factor average is a quality score.

export interface FactorScore {
  name: string;
  /** Raw value as reported. */
  raw: number;
  /** 0–100 within the peer group, higher always better. */
  pct: number;
}

export interface BucketResult {
  score: number | null;
  coverage: number;
  /** How many factors the bucket could have scored. */
  possible: number;
  breakdown: FactorScore[];
  flag?: Flag;
}

/**
 * Score one bucket against a peer group.
 *
 * The peer population is filtered by the same gate as the company, so a
 * negative-earnings company is not ranked on P/E against companies that have
 * one — it is simply not ranked on P/E at all.
 */
export function bucketScore(
  company: Company,
  bucketName: BucketName,
  sectorPeers: Company[],
): BucketResult {
  const factors = FACTORS[bucketName];
  const scored: FactorScore[] = [];

  for (const [name, def] of Object.entries(factors)) {
    if (!gateSatisfied(company, def.requires)) continue;
    const raw = company.metrics[name as keyof Company['metrics']];
    if (raw === null || !Number.isFinite(raw)) continue;

    const peerValues = sectorPeers
      .filter((p) => gateSatisfied(p, def.requires))
      .map((p) => p.metrics[name as keyof Company['metrics']])
      .filter((v): v is number => v !== null && Number.isFinite(v));

    const pct = percentileRank(raw as number, peerValues, def.dir);
    if (pct !== null) scored.push({ name, raw: raw as number, pct });
  }

  const possible = Object.keys(factors).length;
  // Half the bucket's factors, rounded up — below that the average is not
  // measuring what the bucket claims to measure.
  const required = Math.ceil(possible / 2);
  if (scored.length < required) {
    return {
      score: null,
      coverage: scored.length,
      possible,
      breakdown: scored,
      flag: `${bucketName.toUpperCase()}_INSUFFICIENT_DATA` as Flag,
    };
  }

  const score = scored.reduce((s, f) => s + f.pct, 0) / scored.length;
  return { score, coverage: scored.length, possible, breakdown: scored };
}

export type Buckets = Record<BucketName, BucketResult>;

export function scoreAllBuckets(company: Company, sectorPeers: Company[]): Buckets {
  return {
    valuation: bucketScore(company, 'valuation', sectorPeers),
    quality: bucketScore(company, 'quality', sectorPeers),
    growth: bucketScore(company, 'growth', sectorPeers),
    momentum: bucketScore(company, 'momentum', sectorPeers),
  };
}

export interface Composite {
  raw: number | null;
  adjusted: number | null;
  sectorWeight: number;
  penalty: number;
  /** Weights actually used after unscored buckets were redistributed. */
  effectiveWeights: Partial<Record<BucketName, number>>;
}

/**
 * Combine bucket scores into one number, then penalise sectors the user is
 * already heavy in.
 *
 * This inverts the usual recommender logic on purpose. A recommender boosts
 * what resembles what you already hold; here a sector held at 40% has its
 * scores multiplied by 0.8 at the default lambda, so a name from that sector
 * has to genuinely outrank the alternatives to reach the top of the feed.
 */
export function compositeScore(
  buckets: Buckets,
  weights: Record<BucketName, number>,
  portfolioSectorWeights: Record<string, number>,
  sector: string,
  lambda = 0.5,
): Composite {
  const scored = BUCKETS.filter((b) => buckets[b].score !== null);
  const totalW = scored.reduce((s, b) => s + weights[b], 0);

  const w = portfolioSectorWeights[sector] ?? 0; // 0–1
  if (totalW === 0) {
    return { raw: null, adjusted: null, sectorWeight: w, penalty: 0, effectiveWeights: {} };
  }

  // Unscored buckets give their weight back to the ones that did score.
  const effectiveWeights: Partial<Record<BucketName, number>> = {};
  for (const b of scored) effectiveWeights[b] = weights[b] / totalW;

  const raw = scored.reduce(
    (s, b) => s + (buckets[b].score as number) * (weights[b] / totalW),
    0,
  );
  const adjusted = raw * (1 - lambda * w);

  return { raw, adjusted, sectorWeight: w, penalty: raw - adjusted, effectiveWeights };
}

/**
 * Group the universe by sector, falling back to the whole universe for sectors
 * too thin to rank within. A percentile against three peers is noise wearing a
 * number's clothes, so those companies carry a flag saying so.
 */
export function peerGroups(universe: Company[]): {
  peersFor: (company: Company) => Company[];
  smallSectors: Set<string>;
} {
  const bySector = new Map<string, Company[]>();
  for (const c of universe) {
    const list = bySector.get(c.sector);
    if (list) list.push(c);
    else bySector.set(c.sector, [c]);
  }
  const smallSectors = new Set<string>();
  for (const [sector, list] of bySector) {
    if (list.length < MIN_SECTOR_PEERS) smallSectors.add(sector);
  }
  return {
    peersFor: (company) =>
      smallSectors.has(company.sector) ? universe : (bySector.get(company.sector) ?? [company]),
    smallSectors,
  };
}

export interface ScoredCompany {
  company: Company;
  buckets: Buckets;
  composite: Composite;
  /** Position within its own sector on the adjusted score, 1-based. */
  sectorRank: number;
  sectorSize: number;
  flags: Flag[];
}

/** Score the whole universe. Pure — same input, same output, no clock, no network. */
export function scoreUniverse(
  universe: Company[],
  weights: Record<BucketName, number>,
  portfolioSectorWeights: Record<string, number>,
  lambda = 0.5,
): ScoredCompany[] {
  const { peersFor, smallSectors } = peerGroups(universe);

  const scored: ScoredCompany[] = universe.map((company) => {
    const buckets = scoreAllBuckets(company, peersFor(company));
    const composite = compositeScore(
      buckets,
      weights,
      portfolioSectorWeights,
      company.sector,
      lambda,
    );
    const flags: Flag[] = [...company.flags];
    if (smallSectors.has(company.sector)) flags.push('SMALL_SECTOR_PEER_GROUP');
    for (const b of BUCKETS) {
      const f = buckets[b].flag;
      if (f) flags.push(f);
    }
    if (composite.penalty > 0) flags.push('CONCENTRATION_PENALTY');
    return { company, buckets, composite, sectorRank: 0, sectorSize: 0, flags };
  });

  // Rank within sector on the adjusted score, so the card can say "#3 of 47".
  const bySector = new Map<string, ScoredCompany[]>();
  for (const s of scored) {
    const list = bySector.get(s.company.sector);
    if (list) list.push(s);
    else bySector.set(s.company.sector, [s]);
  }
  for (const list of bySector.values()) {
    const ranked = [...list]
      .filter((s) => s.composite.adjusted !== null)
      .sort((a, b) => (b.composite.adjusted as number) - (a.composite.adjusted as number));
    ranked.forEach((s, i) => {
      s.sectorRank = i + 1;
      s.sectorSize = ranked.length;
    });
  }

  return scored;
}
