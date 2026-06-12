import { isoDate, daysAgo } from '@/utils/format';

// SEC EDGAR full-text search — free, no key, but rate-limited (10 req/s) and
// it requires a descriptive User-Agent. This signal is strictly best-effort:
// any failure returns null and the pipeline treats the filing source as
// unavailable rather than negative.

const UA = 'Stockpile personal investing app (contact: app user)';

export async function fetchRecent8KCount(symbol: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      q: `"${symbol}"`,
      forms: '8-K',
      dateRange: 'custom',
      startdt: isoDate(daysAgo(10)),
      enddt: isoDate(new Date()),
    });
    const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${params.toString()}`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { hits?: { total?: { value?: number } } };
    const total = json.hits?.total?.value;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}
