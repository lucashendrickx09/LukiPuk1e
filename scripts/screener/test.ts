/* eslint-disable no-console */
// The test fixtures from §8 of the spec. These exist because a subtly wrong
// score renders as a very attractive wrong number — the UI gives you no signal
// that anything is off. Run with: npm run screener:test

import { Company, DEFAULT_WEIGHTS, Metrics } from '../../src/screener/factors';
import { median, percentileRank } from '../../src/screener/percentile';
import { bucketScore, compositeScore, Buckets, ScoredCompany } from '../../src/screener/score';
import { buildFeed, FeedState, isHidden } from '../../src/screener/feed';

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  }
};
const near = (a: number | null, b: number, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

const NO_METRICS: Metrics = {
  forwardPE: null, trailingPE: null, pegRatio: null, priceToBook: null, evToEbitda: null,
  priceToSales: null, fcfYield: null, returnOnEquity: null, returnOnAssets: null,
  grossMargins: null, operatingMargins: null, profitMargins: null, debtToEquity: null,
  currentRatio: null, revenueGrowth: null, earningsGrowth: null, marginTrend: null,
  momentum12_1: null, pctFrom52High: null, volatility: null, maxDrawdown: null,
  trailingEps: null, ebitda: null, freeCashflow: null,
};

function mk(symbol: string, sector: string, metrics: Partial<Metrics>): Company {
  return {
    symbol, name: symbol, sector, industry: null, marketCap: 10e9, price: 100, changePct: 0,
    currency: 'USD', financialCurrency: 'USD', employees: null, description: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, dividendYield: null, nextEarnings: null,
    totalRevenue: null, metrics: { ...NO_METRICS, ...metrics }, spark: [], flags: [],
  };
}

// ---------------------------------------------------------------- percentileRank
console.log('\npercentileRank');
{
  const pop = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // By hand for value 7, direction 'higher': six values below, one equal.
  //   (6 + 0.5*1) / 10 * 100 = 65
  check('known 10-value array matches the manual calculation',
    near(percentileRank(7, pop, 'higher'), 65), percentileRank(7, pop, 'higher'));

  // Same value, inverted: three above, one equal -> (3 + 0.5)/10*100 = 35.
  check("direction 'lower' correctly inverts",
    near(percentileRank(7, pop, 'lower'), 35), percentileRank(7, pop, 'lower'));
  check("'higher' and 'lower' are complements",
    near((percentileRank(7, pop, 'higher') as number) + (percentileRank(7, pop, 'lower') as number), 100));

  check('ties get the midpoint',
    near(percentileRank(5, [5, 5, 5, 5], 'higher'), 50), percentileRank(5, [5, 5, 5, 5], 'higher'));

  check('single-element population returns null', percentileRank(5, [5], 'higher') === null);
  check('empty population returns null', percentileRank(5, [], 'higher') === null);
  check('does not return 0 or NaN for thin populations',
    percentileRank(5, [5], 'higher') !== 0 && !Number.isNaN(percentileRank(5, [5], 'higher') as number));

  check('median of an even population is the midpoint', near(median([1, 2, 3, 4]), 2.5));
  check('median of an empty population is null', median([]) === null);
}

// ------------------------------------------------------------------- bucketScore
console.log('\nbucketScore');
{
  // Peers with everything present, so percentiles are computable.
  const peers = [1, 2, 3, 4, 5, 6].map((i) =>
    mk('P' + i, 'Tech', {
      forwardPE: 10 + i, evToEbitda: 8 + i, fcfYield: 0.01 * i, priceToSales: i,
      trailingEps: 5, ebitda: 1e9, freeCashflow: 1e9,
    }),
  );

  // Negative earnings AND negative EBITDA: two valuation gates fail.
  const loss = mk('LOSS', 'Tech', {
    forwardPE: 12, evToEbitda: 9, fcfYield: 0.04, priceToSales: 3,
    trailingEps: -1.5, ebitda: -2e8, freeCashflow: 5e8,
  });
  const v = bucketScore(loss, 'valuation', [...peers, loss]);
  const names = v.breakdown.map((f) => f.name).sort();
  check('negative earnings excludes forwardPE', !names.includes('forwardPE'), names);
  check('negative EBITDA excludes evToEbitda', !names.includes('evToEbitda'), names);
  check('priceToSales is still scored', names.includes('priceToSales'), names);
  check('positive FCF keeps fcfYield', names.includes('fcfYield'), names);
  check('coverage reported as 2, not 4', v.coverage === 2, v.coverage);
  check('bucket still scores at exactly half coverage', v.score !== null, v);

  // Quality: only 2 of 5 factors present -> below the half-coverage bar.
  const thin = mk('THIN', 'Tech', { returnOnEquity: 0.2, grossMargins: 0.5 });
  const qPeers = [1, 2, 3, 4].map((i) =>
    mk('Q' + i, 'Tech', {
      returnOnEquity: 0.1 * i, grossMargins: 0.1 * i, profitMargins: 0.1 * i,
      debtToEquity: 10 * i, currentRatio: i,
    }),
  );
  const q = bucketScore(thin, 'quality', [...qPeers, thin]);
  check('missing 3 of 5 quality factors leaves the bucket unscored', q.score === null, q);
  check('unscored bucket still reports its coverage', q.coverage === 2, q.coverage);
  check('unscored bucket carries a flag', q.flag === 'QUALITY_INSUFFICIENT_DATA', q.flag);

  // All factors present -> plain mean of the percentiles.
  const mPeers = [1, 2, 3, 4].map((i) =>
    mk('M' + i, 'Tech', { momentum12_1: 0.1 * i, pctFrom52High: -0.1 * i }),
  );
  const subject = mk('SUB', 'Tech', { momentum12_1: 0.25, pctFrom52High: -0.15 });
  const all = [...mPeers, subject];
  const m = bucketScore(subject, 'momentum', all);
  const expected =
    ((percentileRank(0.25, all.map((c) => c.metrics.momentum12_1 as number), 'higher') as number) +
      (percentileRank(-0.15, all.map((c) => c.metrics.pctFrom52High as number), 'higher') as number)) / 2;
  check('all factors present equals the plain mean of the percentiles',
    near(m.score, expected, 1e-9), { got: m.score, expected });
}

// ---------------------------------------------------------------- compositeScore
console.log('\ncompositeScore');
{
  const B = (v: number | null, q: number | null, g: number | null, mo: number | null): Buckets => ({
    valuation: { score: v, coverage: v === null ? 0 : 4, possible: 4, breakdown: [] },
    quality: { score: q, coverage: q === null ? 0 : 5, possible: 5, breakdown: [] },
    growth: { score: g, coverage: g === null ? 0 : 3, possible: 3, breakdown: [] },
    momentum: { score: mo, coverage: mo === null ? 0 : 2, possible: 2, breakdown: [] },
  });

  const one = compositeScore(B(null, 80, 60, 40), DEFAULT_WEIGHTS, {}, 'Tech', 0);
  const wsum = Object.values(one.effectiveWeights).reduce((s, w) => s + (w as number), 0);
  check('one bucket null: remaining weights renormalise to 1', near(wsum, 1, 1e-12), wsum);
  // 0.30/0.65*80 + 0.25/0.65*60 + 0.10/0.65*40 = 67.6923...
  const manual = (0.3 * 80 + 0.25 * 60 + 0.1 * 40) / 0.65;
  check('renormalised composite matches the manual calculation',
    near(one.raw, manual, 1e-9), { got: one.raw, manual });

  const none = compositeScore(B(null, null, null, null), DEFAULT_WEIGHTS, {}, 'Tech', 0.5);
  check('all buckets null returns null and does not throw', none.raw === null && none.adjusted === null);

  const l0 = compositeScore(B(70, 70, 70, 70), DEFAULT_WEIGHTS, { Tech: 0.4 }, 'Tech', 0);
  check('lambda 0 leaves adjusted equal to raw', near(l0.adjusted, l0.raw as number), l0);

  const l1 = compositeScore(B(70, 70, 70, 70), DEFAULT_WEIGHTS, { Tech: 0.4 }, 'Tech', 1);
  check('lambda 1 with 40% sector weight gives raw * 0.6',
    near(l1.adjusted, (l1.raw as number) * 0.6, 1e-9), { raw: l1.raw, adjusted: l1.adjusted });
}

// ---------------------------------------------------------------- feed ordering
console.log('\nfeed ordering');
{
  const now = new Date('2026-09-03T12:00:00Z');
  const sc = (symbol: string, sector: string, adjusted: number): ScoredCompany => ({
    company: mk(symbol, sector, {}),
    buckets: {} as Buckets,
    composite: { raw: adjusted, adjusted, sectorWeight: 0, penalty: 0, effectiveWeights: {} },
    sectorRank: 0, sectorSize: 0, flags: [],
  });

  // Expired dismissal.
  const expired: FeedState = {
    OLD: { action: 'dismissed', at: '2026-01-01T00:00:00Z', expiresAt: '2026-04-01T00:00:00Z' },
  };
  const live: FeedState = {
    NEW: { action: 'dismissed', at: '2026-09-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' },
  };
  check('expired dismissal reappears', isHidden(expired.OLD, now) === false);
  check('live dismissal stays hidden', isHidden(live.NEW, now) === true);

  // Snooze until earnings.
  const before: FeedState = { X: { action: 'snoozed', at: '2026-08-20T00:00:00Z', until: '2026-10-16T00:00:00Z' } };
  const after: FeedState = { X: { action: 'snoozed', at: '2026-08-20T00:00:00Z', until: '2026-09-02T00:00:00Z' } };
  check('snoozed ticker stays hidden before earnings', isHidden(before.X, now) === true);
  check('snoozed ticker reappears the day after its earnings date', isHidden(after.X, now) === false);
  check('watchlisted tickers leave the feed', isHidden({ action: 'watchlist', at: '2026-01-01T00:00:00Z' }, now) === true);

  // Diversification slot, with one sector dominating every top rank.
  const dominated: ScoredCompany[] = [];
  for (let i = 0; i < 20; i++) dominated.push(sc('T' + i, 'Technology', 100 - i));
  for (let i = 0; i < 5; i++) dominated.push(sc('H' + i, 'Healthcare', 40 - i)); // all rank below
  const feed = buildFeed(dominated, {}, {
    minMarketCap: 0,
    portfolioSectorWeights: { Technology: 1.0 }, // Healthcare held at 0%
    now,
  });
  check('the every-7th slot fires even when one sector dominates',
    feed[6]?.company.sector === 'Healthcare', feed.slice(0, 8).map((f) => f.company.symbol + ':' + f.company.sector));
  check('the injected card is flagged visibly',
    feed[6]?.flags.includes('OUTSIDE_YOUR_SECTORS') === true, feed[6]?.flags);
  check('the 14th slot is also a diversification pick',
    feed[13]?.company.sector === 'Healthcare', feed[13]?.company.symbol);
  check('no company appears twice',
    new Set(feed.map((f) => f.company.symbol)).size === feed.length);
  check('every eligible company still appears', feed.length === dominated.length, feed.length);

  // Market cap floor.
  const small = sc('TINY', 'Technology', 99);
  small.company.marketCap = 1e8;
  const floored = buildFeed([...dominated, small], {}, {
    minMarketCap: 2e9, portfolioSectorWeights: {}, now,
  });
  check('market cap floor excludes small caps',
    !floored.some((f) => f.company.symbol === 'TINY'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
