import {
  fetchCompanyNews,
  fetchMetrics,
  fetchProfile,
  fetchQuote,
  fetchRecommendations,
} from '@/api/finnhub';
import { fetchRecent8KCount } from '@/api/edgar';
import { fetchDailyCandles, pctReturn } from '@/api/stooq';
import { UNIVERSE } from '@/data/universe';
import { BuildProgress, DeckCard, SignalSummary, SwipeRecord } from '@/types';
import { capTierOf, daysAgo, isoDate } from '@/utils/format';
import { analystSignal, filingSignal, newsSignal } from './signals';
import { longTermScore, momentumScore, passesGate, positiveSourceTypes } from './score';
import { buildWeights, buildWhyTag, tasteBonus } from './personalize';
import { writeThesis } from './thesis';
import { ThesisInput } from '@/api/anthropic';

// On-device deck build — the v0.1 stand-in for the nightly server pipeline.
// Pure orchestration over the engine modules, so the same logic can lift into
// a Supabase scheduled function in v0.2 unchanged.
//
// Stage 1: one cheap analyst-trend call per universe symbol.
// Stage 2: news + filings + fundamentals + price history for the survivors.
// Gate:    >= `strictness` independent positive source types.
// Stage 3: rank with taste weights, then write theses for the final deck only.

export interface PipelineConfig {
  finnhubKey: string;
  anthropicKey: string | null;
  thesisModel: string;
  strictness: 1 | 2 | 3;
  cardsPerDay: number;
  // Style lean from Settings: how the two scores blend into the deck ranking.
  ltWeight: number;
  moWeight: number;
  excludedSymbols: Set<string>; // owned + catalogued + cooldown
  swipes: SwipeRecord[];
}

export async function buildDeck(
  config: PipelineConfig,
  onProgress: (p: BuildProgress) => void,
): Promise<DeckCard[]> {
  const candidates = UNIVERSE.filter((u) => !config.excludedSymbols.has(u.symbol));

  // Stage 1 — analyst recommendation trends across the whole universe.
  const stage1: { symbol: string; analyst: SignalSummary['analyst'] }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const u = candidates[i];
    onProgress({
      phase: 'analysts',
      done: i,
      total: candidates.length,
      message: `Reading analyst trends · ${u.symbol}`,
    });
    try {
      const trends = await fetchRecommendations(config.finnhubKey, u.symbol);
      stage1.push({ symbol: u.symbol, analyst: analystSignal(trends) });
    } catch (e) {
      if (e instanceof Error && e.message.includes('key rejected')) throw e;
      stage1.push({ symbol: u.symbol, analyst: null });
    }
  }

  // Survivors: strictness 1 lets a lone strong analyst signal through; above
  // that, analyst-positive is the cheap prerequisite for the news/filing pass.
  // ETFs rarely carry analyst ratings, so they go through on momentum review.
  const survivors = stage1.filter((s) => {
    const isEtf = UNIVERSE.find((u) => u.symbol === s.symbol)?.etf;
    return s.analyst?.positive || (isEtf && config.strictness === 1);
  });

  // Stage 2 — deep signals for survivors only.
  const from = isoDate(daysAgo(7));
  const to = isoDate(new Date());
  const enriched: {
    symbol: string;
    signals: SignalSummary;
    lt: number;
    mo: number;
    input: ThesisInput;
  }[] = [];

  for (let i = 0; i < survivors.length; i++) {
    const s = survivors[i];
    onProgress({
      phase: 'news',
      done: i,
      total: survivors.length,
      message: `Reading news & filings · ${s.symbol}`,
    });
    try {
      const [news, profile, metrics, quote] = [
        await fetchCompanyNews(config.finnhubKey, s.symbol, from, to),
        await fetchProfile(config.finnhubKey, s.symbol),
        await fetchMetrics(config.finnhubKey, s.symbol),
        await fetchQuote(config.finnhubKey, s.symbol),
      ];
      const newsSig = newsSignal(news);
      const otherPositive = Boolean(s.analyst?.positive || newsSig?.positive);
      const recent8K = otherPositive ? await fetchRecent8KCount(s.symbol) : null;
      const signals: SignalSummary = {
        analyst: s.analyst,
        news: newsSig,
        filing: filingSignal(recent8K, otherPositive),
      };
      const types = positiveSourceTypes(signals);
      if (!passesGate(types, config.strictness)) continue;

      const candles = await fetchDailyCandles(s.symbol);
      const lt = longTermScore(signals, metrics);
      const mo = momentumScore(signals, candles);
      const capTier = capTierOf(profile.marketCapM);
      enriched.push({
        symbol: s.symbol,
        signals,
        lt,
        mo,
        input: {
          symbol: s.symbol,
          name: profile.name,
          sector: profile.sector,
          capTier,
          price: quote?.price ?? 0,
          longTermScore: lt,
          momentumScore: mo,
          signals,
          metrics: { ...metrics },
          return1M: candles ? pctReturn(candles, 21) : null,
          return3M: candles ? pctReturn(candles, 63) : null,
        },
      });
      // Stash profile/quote for card assembly without refetching.
      profileCache.set(s.symbol, { profile, quotePrice: quote?.price ?? 0, quotePct: quote?.changePct ?? 0 });
    } catch {
      // One bad symbol never kills the build.
    }
  }

  // Stage 3 — personalization rank, cap to deck size, write theses.
  const weights = buildWeights(config.swipes);
  const ranked = enriched
    .map((e) => {
      const cached = profileCache.get(e.symbol)!;
      const bonus = tasteBonus(weights, cached.profile.sector, capTierOf(cached.profile.marketCapM));
      return { ...e, bonus, rank: e.lt * config.ltWeight + e.mo * config.moWeight + bonus };
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
      message: `Writing thesis · ${e.symbol}`,
    });
    const cached = profileCache.get(e.symbol)!;
    const capTier = capTierOf(cached.profile.marketCapM);
    const types = positiveSourceTypes(e.signals);
    const thesis = await writeThesis(config.anthropicKey, config.thesisModel, e.input);
    cards.push({
      symbol: e.symbol,
      profile: cached.profile,
      metrics: e.input.metrics,
      capTier,
      price: cached.quotePrice,
      changePct: cached.quotePct,
      longTermScore: e.lt,
      momentumScore: e.mo,
      signals: e.signals,
      sourceTypes: types,
      whyTag: buildWhyTag(types, e.signals, e.bonus, cached.profile.sector),
      thesis,
      builtAt: new Date().toISOString(),
    });
  }

  onProgress({ phase: 'done', done: cards.length, total: cards.length, message: 'Deck ready' });
  return cards;
}

const profileCache = new Map<
  string,
  { profile: DeckCard['profile']; quotePrice: number; quotePct: number }
>();
