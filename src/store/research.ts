import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_RESEARCH_MODEL } from '@/api/anthropic';
import {
  PortfolioContext,
  ResearchDepth,
  researchCompany,
  searchesPerCompany,
  synthesizeRebalance,
} from '@/engine/deepResearch';
import { buildHoldings } from '@/lib/holdings';
import { getSecret, KEYS } from '@/lib/secure';
import { useCatalog } from '@/store/catalog';
import { useMarket } from '@/store/market';
import { usePortfolio } from '@/store/portfolio';
import { DeepResearchReport, ResearchProgress, ResearchRun } from '@/types';
import { isoDate } from '@/utils/format';

// Deep research runs on demand and is the most expensive thing the app does, so
// results are persisted: a brief stays readable (and attached to its company)
// until you deliberately re-run it.

export type ResearchScope = 'holdings' | 'candidates' | 'all';

export const SCOPE_OPTIONS: { key: ResearchScope; label: string; help: string }[] = [
  { key: 'holdings', label: 'My holdings', help: 'Does each position still deserve the capital?' },
  { key: 'candidates', label: 'Catalog picks', help: 'Do any shortlisted names deserve a place?' },
  { key: 'all', label: 'Everything', help: 'Both, plus the switches between them.' },
];

/** Companies researched at once. Each is one Claude call with live web search. */
const CONCURRENCY = 3;
/** Hard cap so an over-full catalog can't launch a runaway (and costly) run. */
const MAX_COMPANIES = 14;

const idle: ResearchProgress = { phase: 'idle', done: 0, total: 0, message: '' };

interface ResearchState {
  /** Latest brief per symbol. */
  reports: Record<string, DeepResearchReport>;
  /** Newest first; trimmed to the last few. */
  runs: ResearchRun[];
  progress: ResearchProgress;
  running: boolean;
  error: string | null;
  /** Cash the investor could deploy — used to size buy actions. */
  cashUsd: number;
  depth: ResearchDepth;
  model: string;
  setCash: (v: number) => void;
  setDepth: (v: ResearchDepth) => void;
  setModel: (v: string) => void;
  /** Symbols a run with this scope would cover, in priority order. */
  plan: (scope: ResearchScope) => string[];
  run: (scope: ResearchScope) => Promise<void>;
  cancel: () => void;
  clearAll: () => void;
}

let abort: AbortController | null = null;

/** Snapshot of the portfolio the research is judged against. */
function portfolioContext(cashUsd: number): PortfolioContext {
  const holdings = buildHoldings({
    positions: usePortfolio.getState().positions,
    quotes: useMarket.getState().quotes,
    profiles: useMarket.getState().profiles,
  });
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const bySector = new Map<string, number>();
  for (const h of holdings) bySector.set(h.sector, (bySector.get(h.sector) ?? 0) + h.value);

  // Prices for everything in scope — holdings from live quotes, catalogued
  // candidates from their quote or, failing that, the price on their card.
  const quotes = useMarket.getState().quotes;
  const prices: Record<string, number> = {};
  for (const h of holdings) prices[h.symbol] = h.price;
  for (const e of useCatalog.getState().entries) {
    const p = quotes[e.card.symbol]?.price ?? e.card.price;
    if (p > 0) prices[e.card.symbol] = p;
  }

  return {
    prices,
    asOf: isoDate(new Date()),
    totalValueUsd: total,
    cashUsd,
    holdings: holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      shares: h.shares,
      avgCost: h.avgCost,
      price: h.price,
      valueUsd: h.value,
      weightPct: total > 0 ? (h.value / total) * 100 : 0,
      plPct: h.plPct,
      sector: h.sector,
    })),
    sectorWeights: [...bySector.entries()]
      .map(([sector, v]) => ({ sector, pct: total > 0 ? (v / total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct),
  };
}

export const useResearch = create<ResearchState>()(
  persist(
    (set, get) => ({
      reports: {},
      runs: [],
      progress: idle,
      running: false,
      error: null,
      cashUsd: 0,
      depth: 'deep',
      model: DEFAULT_RESEARCH_MODEL,

      setCash: (cashUsd) => set({ cashUsd: Math.max(0, cashUsd) }),
      setDepth: (depth) => set({ depth }),
      setModel: (model) => set({ model }),

      plan: (scope) => {
        const ctx = portfolioContext(get().cashUsd);
        // Biggest positions first: those decisions move the most money.
        const owned = [...ctx.holdings]
          .sort((a, b) => b.valueUsd - a.valueUsd)
          .map((h) => h.symbol);
        const ownedSet = new Set(owned);
        const candidates = useCatalog
          .getState()
          .entries.filter((e) => !ownedSet.has(e.card.symbol))
          .sort(
            (a, b) =>
              b.card.longTermScore + b.card.momentumScore -
              (a.card.longTermScore + a.card.momentumScore),
          )
          .map((e) => e.card.symbol);

        const list =
          scope === 'holdings'
            ? owned
            : scope === 'candidates'
              ? candidates
              : // Interleave so a long holdings list can't starve the candidates.
                interleave(owned, candidates);
        return list.slice(0, MAX_COMPANIES);
      },

      run: async (scope) => {
        if (get().running) return;
        const apiKey = await getSecret(KEYS.anthropic);
        if (!apiKey) {
          set({ error: 'Add your Anthropic API key in Settings to run deep research.' });
          return;
        }

        const symbols = get().plan(scope);
        if (symbols.length === 0) {
          set({
            error:
              scope === 'candidates'
                ? 'Catalog some companies in Discover first — there is nothing to research.'
                : 'Add some holdings first — there is nothing to research.',
          });
          return;
        }

        abort = new AbortController();
        const signal = abort.signal;
        const { depth, model, cashUsd } = get();
        const ctx = portfolioContext(cashUsd);
        const ownedSet = new Set(ctx.holdings.map((h) => h.symbol));
        const catalog = useCatalog.getState().entries;
        const startedAt = new Date().toISOString();

        set({
          running: true,
          error: null,
          progress: {
            phase: 'planning',
            done: 0,
            total: symbols.length + 1,
            message: `Researching ${symbols.length} companies across filings, Wall Street, institutions and Congress…`,
          },
        });

        const reports: DeepResearchReport[] = [];
        const failures: { symbol: string; reason: string }[] = [];
        let done = 0;

        const researchOne = async (symbol: string) => {
          if (signal.aborted) return;
          const holding = ctx.holdings.find((h) => h.symbol === symbol);
          const entry = catalog.find((e) => e.card.symbol === symbol);
          const profile = useMarket.getState().profiles[symbol];
          set({
            progress: {
              phase: 'company',
              done,
              total: symbols.length + 1,
              message: `Reading sources on ${symbol}…`,
            },
          });
          try {
            const report = await researchCompany({
              apiKey,
              model,
              depth,
              signal,
              portfolio: ctx,
              input: {
                symbol,
                name: holding?.name ?? entry?.card.profile.name ?? profile?.name ?? symbol,
                sector: holding?.sector ?? entry?.card.profile.sector ?? profile?.sector,
                owned: ownedSet.has(symbol),
                shares: holding?.shares,
                avgCost: holding?.avgCost,
                price: holding?.price ?? entry?.card.price,
                positionValueUsd: holding?.valueUsd,
                portfolioWeightPct: holding?.weightPct,
                plPct: holding?.plPct,
                firstBuyDate: usePortfolio
                  .getState()
                  .positions.filter((p) => p.symbol === symbol)
                  .map((p) => p.buyDate)
                  .sort()[0],
                existingThesis: entry?.card.thesis.hook,
              },
            });
            reports.push(report);
            set((s) => ({ reports: { ...s.reports, [symbol]: report } }));
          } catch (e) {
            if (signal.aborted) return;
            failures.push({
              symbol,
              reason: e instanceof Error ? e.message : 'research call failed',
            });
          } finally {
            done += 1;
            set({
              progress: {
                phase: 'company',
                done,
                total: symbols.length + 1,
                message: `${done} of ${symbols.length} companies researched`,
              },
            });
          }
        };

        try {
          await pool(symbols, CONCURRENCY, researchOne);
          if (signal.aborted) throw new Error('cancelled');

          if (reports.length === 0) {
            throw new Error(failures[0]?.reason ?? 'No company could be researched.');
          }

          set({
            progress: {
              phase: 'synthesis',
              done: symbols.length,
              total: symbols.length + 1,
              message: 'Weighing it all up and sizing the moves…',
            },
          });

          const synth = await synthesizeRebalance({
            apiKey,
            model,
            reports,
            // Re-snapshot: prices may have moved during a long run.
            portfolio: portfolioContext(get().cashUsd),
            signal,
          });

          const run: ResearchRun = {
            id: 'run-' + startedAt,
            startedAt,
            finishedAt: new Date().toISOString(),
            model,
            symbols,
            portfolioView: synth.portfolioView,
            actions: synth.actions,
            method: synth.method,
            failures,
          };
          set((s) => ({
            runs: [run, ...s.runs].slice(0, 5),
            running: false,
            progress: {
              phase: 'done',
              done: symbols.length + 1,
              total: symbols.length + 1,
              message: `${reports.length} briefs · ${synth.actions.length} suggested move${
                synth.actions.length === 1 ? '' : 's'
              }`,
            },
          }));
        } catch (e) {
          const cancelled = signal.aborted;
          set({
            running: false,
            error: cancelled ? null : e instanceof Error ? e.message : 'Deep research failed.',
            progress: cancelled
              ? idle
              : { ...get().progress, phase: 'error', message: 'Research stopped' },
          });
        } finally {
          abort = null;
        }
      },

      cancel: () => {
        abort?.abort();
        abort = null;
        set({ running: false, progress: idle });
      },

      clearAll: () => set({ reports: {}, runs: [], progress: idle, error: null }),
    }),
    {
      name: 'stockpile.research',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) =>
        ({
          reports: s.reports,
          runs: s.runs,
          cashUsd: s.cashUsd,
          depth: s.depth,
          model: s.model,
        }) as ResearchState,
    },
  ),
);

/** Estimated web searches a run of this size will make. */
export function estimateSearches(companies: number, depth: ResearchDepth): number {
  return companies * searchesPerCompany(depth);
}

function interleave(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}
