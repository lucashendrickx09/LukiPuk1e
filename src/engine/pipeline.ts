import {
  fetchCompanyNews,
  fetchMetrics,
  fetchProfile,
  fetchQuote,
  fetchRecommendationsCached,
} from '@/api/finnhub';
import { fetchRecent8KCount } from '@/api/edgar';
import { fetchDailyCandles, pctReturn } from '@/api/stooq';
import { UNIVERSE } from '@/data/universe';
import {
  BuildProgress,
  Candle,
  CompanyProfile,
  DeckCard,
  KeyMetrics,
  Quote,
  SignalSummary,
  SwipeRecord,
} from '@/types';
import { capTierOf, daysAgo, isoDate } from '@/utils/format';
import { analystSignal, filingSignal, newsSignal } from './signals';
import { longTermScore, momentumScore, positiveSourceTypes } from './score';
import { buildWeights, buildWhyTag, tasteBonus } from './personalize';
import { writeThesis } from './thesis';

// On-device deck build — the v0.1 stand-in for the nightly server pipeline.
//
// Stage 1: cached analyst-trend lookup per universe symbol → analyst-positive
//          survivors (the reliable free-tier signal).
// Stage 2: news + price history for the strongest survivors. No hard
//          multi-source gate — an analyst buy-lean is itself a valid reason to
//          surface a stock; extra agreeing sources (news/filing) just rank it
//          higher. (A strict gate starves the deck because free-tier news
//          sentiment is weak and SEC filing checks are CORS-blocked in the web app.)
// Stage 3: rank with style lean + taste + source agreement, cap to the deck
//          size, then fetch fundamentals and write theses for the final cards only.

export interface PipelineConfig {
  finnhubKey: string;
  anthropicKey: string | null;
  thesisModel: string;
  strictness: 1 | 2 | 3;
  cardsPerDay: number;
  ltWeight: number;
  moWeight: number;
  excludedSymbols: Set<string>; // owned + catalogued + cooldown
  swipes: SwipeRecord[];
}

interface Enriched {
  symbol: string;
  profile: CompanyProfile;
  quote: Quote | null;
  signals: SignalSummary;
  candles: Candle[] | null;
  lt: number;
  mo: number;
}

export async function buildDeck(
  config: PipelineConfig,
  onProgress: (p: BuildProgress) => void,
): Promise<DeckCard[]> {
  const candidates = UNIVERSE.filter((u) => !config.excludedSymbols.has(u.symbol));

  // Stage 1 — analyst recommendation trends (cached per symbol for a few days).
  const stage1: { symbol: string; analyst: SignalSummary['analyst'] }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const u = candidates[i];
    onProgress({
      phase: 'analysts',
      done: i,
      total: candidates.length,
      message: `Reading analyst ratings · ${u.symbol}`,
    });
    try {
      const trends = await fetchRecommendationsCached(config.finnhubKey, u.symbol);
      stage1.push({ symbol: u.symbol, analyst: analystSignal(trends) });
    } catch (e) {
      if (e instanceof Error && e.message.includes('key rejected')) throw e;
      stage1.push({ symbol: u.symbol, analyst: null });
    }
  }

  // Survivors: the street leans buy. Sort by conviction and cap the deep scan
  // so stage 2 stays bounded regardless of universe size.
  const maxDeep = Math.max(config.cardsPerDay * 2, 14);
  const survivors = stage1
    .filter((s) => s.analyst?.positive)
    .sort((a, b) => (b.analyst?.buyRatio ?? 0) - (a.analyst?.buyRatio ?? 0))
    .slice(0, maxDeep);

  // Stage 2 — news + price history for survivors. Every survivor is eligible.
  const from = isoDate(daysAgo(7));
  const to = isoDate(new Date());
  const enriched: Enriched[] = [];

  for (let i = 0; i < survivors.length; i++) {
    const s = survivors[i];
    onProgress({
      phase: 'news',
      done: i,
      total: survivors.length,
      message: `Reading news · ${s.symbol}`,
    });
    try {
      const profile = await fetchProfile(config.finnhubKey, s.symbol);
      const quote = await fetchQuote(config.finnhubKey, s.symbol);
      const news = await fetchCompanyNews(config.finnhubKey, s.symbol, from, to);
      const newsSig = newsSignal(news);
      const otherPositive = Boolean(s.analyst?.positive || newsSig?.positive);
      const recent8K = newsSig?.positive ? await fetchRecent8KCount(s.symbol) : null;
      const signals: SignalSummary = {
        analyst: s.analyst,
        news: newsSig,
        filing: filingSignal(recent8K, otherPositive),
      };
      const candles = await fetchDailyCandles(s.symbol);
      enriched.push({
        symbol: s.symbol,
        profile,
        quote,
        signals,
        candles,
        lt: longTermScore(signals, {}),
        mo: momentumScore(signals, candles),
      });
    } catch {
      // One bad symbol never kills the build.
    }
  }

  // Stage 3 — rank, cap, then fetch fundamentals + write theses for finalists.
  const weights = buildWeights(config.swipes);
  const ranked = enriched
    .map((e) => {
      const types = positiveSourceTypes(e.signals);
      const bonus = tasteBonus(weights, e.profile.sector, capTierOf(e.profile.marketCapM));
      // Agreement boost: more independent positive sources rank higher, and
      // meeting the chosen strictness gives an extra lift — but nothing is
      // excluded, so the deck is never empty when survivors exist.
      const agreement = (types.length >= config.strictness ? 8 : 0) + types.length * 2;
      return {
        ...e,
        types,
        bonus,
        rank: e.lt * config.ltWeight + e.mo * config.moWeight + bonus + agreement,
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, config.cardsPerDay);

  const cards: DeckCard[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const e = ranked[i];
    onProgress({
      phase: 'thesis',
      done: i,
      total: ranked.length,
      message: `Analyzing · ${e.symbol}`,
    });
    let metrics: KeyMetrics = {};
    try {
      metrics = await fetchMetrics(config.finnhubKey, e.symbol);
    } catch {
      // fundamentals optional
    }
    const capTier = capTierOf(e.profile.marketCapM);
    const lt = longTermScore(e.signals, metrics); // richer once fundamentals are in
    const thesis = await writeThesis(config.anthropicKey, config.thesisModel, {
      symbol: e.symbol,
      name: e.profile.name,
      sector: e.profile.sector,
      capTier,
      price: e.quote?.price ?? 0,
      longTermScore: lt,
      momentumScore: e.mo,
      signals: e.signals,
      metrics,
      return1M: e.candles ? pctReturn(e.candles, 21) : null,
      return3M: e.candles ? pctReturn(e.candles, 63) : null,
    });
    cards.push({
      symbol: e.symbol,
      profile: e.profile,
      metrics,
      capTier,
      price: e.quote?.price ?? 0,
      changePct: e.quote?.changePct ?? 0,
      longTermScore: lt,
      momentumScore: e.mo,
      signals: e.signals,
      sourceTypes: e.types,
      whyTag: buildWhyTag(e.types, e.signals, e.bonus, e.profile.sector),
      thesis,
      builtAt: new Date().toISOString(),
    });
  }

  onProgress({ phase: 'done', done: cards.length, total: cards.length, message: 'Deck ready' });
  return cards;
}
