import { DIVERSIFY_EVERY, Flag } from './factors';
import { ScoredCompany } from './score';

// Feed state is swipe *bookkeeping* — seen, snoozed, watchlisted. It never
// feeds back into the score. The ranking answers to the user's weights, not to
// what they happened to swipe on last week.

export type FeedAction = 'dismissed' | 'watchlist' | 'snoozed';

export interface FeedEntry {
  action: FeedAction;
  /** ISO timestamp of the swipe. */
  at: string;
  /** Dismissals only — when the company becomes eligible again. */
  expiresAt?: string;
  /** Snoozes only — the earnings date it is parked until. */
  until?: string;
  /** Watchlist only — why you flagged it, captured at the moment you did. */
  note?: string;
}

export type FeedState = Record<string, FeedEntry>;

export interface FeedOptions {
  minMarketCap: number;
  portfolioSectorWeights: Record<string, number>;
  /** Injected so ordering is testable without touching the clock. */
  now?: Date;
}

/**
 * Is this company currently hidden by a swipe?
 *
 * Dismissals expire on purpose. A company you passed on at $200 is a different
 * proposition at $120, and permanent dismissal quietly shrinks the universe
 * until the feed runs dry with no indication why.
 */
export function isHidden(entry: FeedEntry | undefined, now: Date): boolean {
  if (!entry) return false;
  switch (entry.action) {
    case 'watchlist':
      return true; // already saved; it doesn't need to come round again
    case 'dismissed':
      return entry.expiresAt ? new Date(entry.expiresAt) > now : true;
    case 'snoozed':
      // Comes back the day after the earnings date it was parked until.
      return entry.until ? new Date(entry.until) > now : false;
    default:
      return false;
  }
}

/**
 * Order the feed.
 *
 * Every seventh slot is reserved for the best company from a sector the user
 * holds none of, so the feed cannot collapse into a single theme even if the
 * weights are set oddly.
 */
export function buildFeed(
  scored: ScoredCompany[],
  state: FeedState,
  opts: FeedOptions,
): ScoredCompany[] {
  const now = opts.now ?? new Date();

  const eligible = scored
    .filter((s) => s.composite.adjusted !== null)
    .filter((s) => !isHidden(state[s.company.symbol], now))
    .filter((s) => (s.company.marketCap ?? 0) >= opts.minMarketCap)
    .sort((a, b) => (b.composite.adjusted as number) - (a.composite.adjusted as number));

  const heldSector = (sector: string) => (opts.portfolioSectorWeights[sector] ?? 0) > 0;
  const outsiders = eligible.filter((s) => !heldSector(s.company.sector));

  const feed: ScoredCompany[] = [];
  const used = new Set<string>();
  let mainIdx = 0;
  let outIdx = 0;

  const total = eligible.length;
  while (feed.length < total) {
    const position = feed.length + 1; // 1-based
    const wantOutsider = position % DIVERSIFY_EVERY === 0;

    if (wantOutsider) {
      while (outIdx < outsiders.length && used.has(outsiders[outIdx].company.symbol)) outIdx++;
      if (outIdx < outsiders.length) {
        const pick = outsiders[outIdx++];
        used.add(pick.company.symbol);
        feed.push({
          ...pick,
          flags: [...pick.flags, 'OUTSIDE_YOUR_SECTORS' as Flag],
        });
        continue;
      }
      // No unheld sector left to show — fall through to the ranked list.
    }

    while (mainIdx < eligible.length && used.has(eligible[mainIdx].company.symbol)) mainIdx++;
    if (mainIdx >= eligible.length) break;
    const pick = eligible[mainIdx++];
    used.add(pick.company.symbol);
    feed.push(pick);
  }

  return feed;
}

/** Sector weights from the user's holdings, as fractions summing to 1. */
export function sectorWeightsFromHoldings(
  holdings: { sector: string; value: number }[],
): Record<string, number> {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const h of holdings) out[h.sector] = (out[h.sector] ?? 0) + h.value / total;
  return out;
}

export function dismissEntry(now: Date, days: number): FeedEntry {
  const expires = new Date(now);
  expires.setDate(expires.getDate() + days);
  return { action: 'dismissed', at: now.toISOString(), expiresAt: expires.toISOString() };
}

export function snoozeEntry(now: Date, earnings: string | null): FeedEntry {
  return {
    action: 'snoozed',
    at: now.toISOString(),
    // Without a known earnings date there is nothing to wait for, so it simply
    // reappears on the next build rather than vanishing.
    until: earnings ?? undefined,
  };
}

export function watchlistEntry(now: Date, note?: string): FeedEntry {
  return { action: 'watchlist', at: now.toISOString(), note };
}
