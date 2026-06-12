import { CapTier } from '@/types';

export function fmtMoney(v: number, digits = 2): string {
  if (!isFinite(v)) return '–';
  return (
    '$' +
    v.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}

export function fmtCompact(v: number): string {
  if (!isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (abs >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  return fmtMoney(v, 0);
}

export function fmtPct(v: number, signed = true): string {
  if (!isFinite(v)) return '–';
  const sign = signed && v > 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
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
