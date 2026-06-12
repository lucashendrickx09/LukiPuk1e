import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CatalogEntry, DeckCard, SwipeRecord } from '@/types';

// Swipe history + the catalog of right-swiped companies.
// Left swipe -> 21-day cooldown before the symbol can reappear in a deck.

const COOLDOWN_DAYS = 21;

interface CatalogState {
  entries: CatalogEntry[];
  swipes: SwipeRecord[];
  swipe: (card: DeckCard, direction: 'left' | 'right') => void;
  removeFromCatalog: (symbol: string) => void;
  catalogSymbols: () => string[];
  cooldownSymbols: () => string[];
  cooldownActive: (symbol: string) => boolean;
  resetPersonalization: () => void;
  clearAll: () => void;
}

export const useCatalog = create<CatalogState>()(
  persist(
    (set, get) => ({
      entries: [],
      swipes: [],

      swipe: (card, direction) => {
        const record: SwipeRecord = {
          symbol: card.symbol,
          direction,
          sector: card.profile.sector,
          capTier: card.capTier,
          at: new Date().toISOString(),
        };
        set((s) => ({
          swipes: [...s.swipes, record],
          entries:
            direction === 'right' && !s.entries.some((e) => e.card.symbol === card.symbol)
              ? [{ card, addedAt: record.at }, ...s.entries]
              : s.entries,
        }));
      },

      removeFromCatalog: (symbol) =>
        set((s) => ({ entries: s.entries.filter((e) => e.card.symbol !== symbol) })),

      catalogSymbols: () => get().entries.map((e) => e.card.symbol),

      cooldownSymbols: () => {
        const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 3600 * 1000;
        const inCatalog = new Set(get().catalogSymbols());
        return get()
          .swipes.filter(
            (s) =>
              s.direction === 'left' &&
              new Date(s.at).getTime() > cutoff &&
              !inCatalog.has(s.symbol),
          )
          .map((s) => s.symbol);
      },

      cooldownActive: (symbol) => get().cooldownSymbols().includes(symbol),

      resetPersonalization: () => set({ swipes: [] }),

      clearAll: () => set({ entries: [], swipes: [] }),
    }),
    { name: 'stockpile.catalog', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
