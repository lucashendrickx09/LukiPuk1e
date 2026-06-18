import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { fetchProfile, fetchQuote } from '@/api/finnhub';
import { getSecret, KEYS } from '@/lib/secure';
import { CompanyProfile, Quote } from '@/types';
import { DEMO_QUOTES } from '@/data/demo';

// Market data cache. Quotes + profiles persist between sessions so the last
// known prices/logos render instantly on open, then refresh in the background.

const QUOTE_TTL_MS = 3 * 60 * 1000;

interface MarketState {
  quotes: Record<string, Quote>;
  profiles: Record<string, CompanyProfile>;
  refreshing: boolean;
  lastError: string | null;
  refreshQuotes: (symbols: string[], force?: boolean) => Promise<void>;
  ensureProfiles: (symbols: string[]) => Promise<void>;
}

export const useMarket = create<MarketState>()(
  persist(
    (set, get) => ({
      quotes: {},
      profiles: {},
      refreshing: false,
      lastError: null,

      refreshQuotes: async (symbols, force = false) => {
        if (get().refreshing) return;
        const key = await getSecret(KEYS.finnhub);
        if (!key) {
          // Demo mode: serve canned quotes for known symbols.
          const demo: Record<string, Quote> = {};
          for (const s of symbols) if (DEMO_QUOTES[s]) demo[s] = DEMO_QUOTES[s];
          set((st) => ({ quotes: { ...st.quotes, ...demo } }));
          return;
        }
        const now = Date.now();
        const stale = symbols.filter(
          (s) => force || !get().quotes[s] || now - get().quotes[s].updatedAt > QUOTE_TTL_MS,
        );
        if (stale.length === 0) return;
        set({ refreshing: true, lastError: null });
        try {
          for (const symbol of stale) {
            const q = await fetchQuote(key, symbol);
            if (q) set((st) => ({ quotes: { ...st.quotes, [symbol]: q } }));
          }
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Quote refresh failed' });
        } finally {
          set({ refreshing: false });
        }
      },

      ensureProfiles: async (symbols) => {
        const key = await getSecret(KEYS.finnhub);
        if (!key) return;
        const missing = symbols.filter((s) => !get().profiles[s]);
        for (const symbol of missing) {
          const p = await fetchProfile(key, symbol);
          set((st) => ({ profiles: { ...st.profiles, [symbol]: p } }));
        }
      },
    }),
    {
      name: 'stockpile.market',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ quotes: s.quotes, profiles: s.profiles }) as MarketState,
    },
  ),
);

