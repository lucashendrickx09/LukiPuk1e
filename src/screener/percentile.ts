/**
 * Percentile rank, not z-score.
 *
 * Financial ratios have brutal outliers — one company at a P/E of 400 wrecks a
 * z-score distribution for everyone else in the sector. Percentile rank is
 * immune to that by construction: it only cares about ordering.
 *
 * Returns 0–100 where higher is always better, whichever way the factor points.
 * Returns null when the population is too small to rank against, rather than 0
 * or NaN — a percentile computed against one peer is not a percentile.
 */
export function percentileRank(
  value: number,
  population: number[],
  direction: 'higher' | 'lower',
): number | null {
  const valid = population.filter((v) => v !== null && Number.isFinite(v));
  if (valid.length < 2) return null;
  const below = valid.filter((v) => (direction === 'higher' ? v < value : v > value)).length;
  const equal = valid.filter((v) => v === value).length;
  return ((below + 0.5 * equal) / valid.length) * 100;
}

/** Median of a population, for the "sector median" column on the detail view. */
export function median(population: number[]): number | null {
  const valid = population.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}
