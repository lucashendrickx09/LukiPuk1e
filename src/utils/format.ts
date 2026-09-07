import { CapTier } from '@/types';

/**
 * U+2212 MINUS SIGN, not a hyphen. It is the same width as the digits in a
 * tabular-figure font, so a column of negatives lines up with the positives.
 */
export const MINUS = '−';

/**
 * Money, with the sign OUTSIDE the currency symbol: −$146.50, never $-146.50.
 * Every negative amount in the app used to read the second way while the
 * heatmap hand-rolled the first, so one screen showed a loss two ways.
 */
export function fmtMoney(v: number, digits = 2): string {
  if (!isFinite(v)) return '–';
  const body = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (v < 0 ? MINUS : '') + '$' + body;
}

/** Money that always carries its direction: +$1,204.00 / −$146.50. */
export function fmtMoneySigned(v: number, digits = 2): string {
  if (!isFinite(v)) return '–';
  return (v > 0 ? '+' : '') + fmtMoney(v, digits);
}

export function fmtCompact(v: number): string {
  if (!isFinite(v)) return '–';
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
  return fmtMoney(v, 0);
}

export function fmtPct(v: number, signed = true): string {
  if (!isFinite(v)) return '–';
  const sign = signed && v > 0 ? '+' : '';
  return (sign + v.toFixed(2) + '%').replace('-', MINUS);
}

/** ▲ / ▼ / nothing — so direction survives a colour-blind reader. */
export function dirGlyph(v: number): string {
  if (v > 0) return '▲';
  if (v < 0) return '▼';
  return '';
}

/** "Updated 09:41" — the freshness stamp that sits under a cached price. */
export function fmtClock(ts: number): string {
  if (!ts || !isFinite(ts)) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function capTierOf(marketCapM: number): CapTier {
  if (marketCapM >= 200_000) return 'Mega-cap';
  if (marketCapM >= 10_000) return 'Large-cap';
  if (marketCapM >= 2_000) return 'Mid-cap';
  return 'Small-cap';
}

export function capTierLabel(tier: CapTier): string {
  switch (tier) {
    case 'Mega-cap':
      return 'Mega-cap · household name';
    case 'Large-cap':
      return 'Large-cap · well known';
    case 'Mid-cap':
      return 'Mid-cap · established';
    case 'Small-cap':
      return 'Small-cap · under the radar';
  }
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function todayKey(): string {
  return isoDate(new Date());
}
