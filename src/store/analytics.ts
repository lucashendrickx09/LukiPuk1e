import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { fetchMetrics } from '@/api/finnhub';
import { fetchDailyCandles } from '@/api/stooq';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';
import { AnalyticsResult, computeAnalytics } from '@/engine/analytics';
import { getSecret, KEYS } from '@/lib/secure';
import { Candle, KeyMetrics } from '@/types';
import { useMarket } from './market';
import { usePortfolio } from './portfolio';

// Caches the computed analytics so the screen shows instantly from the last
// session, and refreshes in the background. compute() is throttled by staleness
// so it can be called liberally (e.g. pre-warmed on app open) without re-fetching.

const STALE_MS = 15 * 60 * 1000;

interface AnalyticsState {
  result: AnalyticsResult | null;
  computedAt: number | null;
  computing: boolean;
  status: string;
  compute: (force?: boolean) => Promise<void>;
}

export const useAnalytics = create<AnalyticsState>()(
  persist(
    (set, get) => ({
      result: null,
      computedAt: null,
      computing: false,
      status: '',

      compute: async (force = false) => {
        if (get().computing) return;
        const positions = usePortfolio.getState().positions;
        if (positions.length === 0) {
          set({ result: null, computedAt: Date.now() });
          return;
        }
        const fresh =
          get().result && get().computedAt && Date.now() - (get().computedAt as number) < STALE_MS;
        if (!force && fresh) return;

        set({ computing: true });
        try {
          const syms = [...new Set(positions.map((p) => p.symbol))];
          const market = useMarket.getState();
          await market.refreshQuotes(syms);
          await market.ensureProfiles(syms);

          const key = await getSecret(KEYS.finnhub);
          const metricsBySymbol: Record<string, KeyMetrics> = {};
          if (key) {
            for (const sym of syms) {
              set({ status: `Fundamentals · ${sym}` });
              try {
                metricsBySymbol[sym] = await fetchMetrics(key, sym);
              } catch {
                // skip
              }
            }
          }

          const candlesBySymbol: Record<string, Candle[]> = {};
          for (const sym of syms) {
            set({ status: `Price history · ${sym}` });
            const c = await fetchDailyCandles(sym);
            if (c) candlesBySymbol[sym] = c;
          }
          set({ status: 'Benchmark · SPY' });
          const benchmark = await fetchDailyCandles('SPY');

          const profiles = useMarket.getState().profiles;
          const sectorOf = (sym: string) =>
            profiles[sym]?.sector ?? UNIVERSE_BY_SYMBOL.get(sym)?.fallbackSector ?? 'Other';

          const result = computeAnalytics({
            positions,
            quotes: useMarket.getState().quotes,
            metricsBySymbol,
            sectorOf,
            candlesBySymbol,
            benchmark,
          });
          set({ result, computedAt: Date.now(), computing: false, status: '' });
        } catch {
          set({ computing: false, status: '' });
        }
      },
    }),
    {
      name: 'stockpile.analytics',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ result: s.result, computedAt: s.computedAt }) as AnalyticsState,
    },
  ),
);
