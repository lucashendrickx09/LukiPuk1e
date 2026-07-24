import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Position } from '@/types';
import { DEMO_POSITIONS } from '@/data/demo';
import { isoDate } from '@/utils/format';

// Positions are stored as individual lots (one row per purchase), which keeps
// cost basis accurate when you buy the same stock more than once. The UI
// aggregates lots by symbol (see lib/holdings.ts); buying appends a lot and
// selling draws down lots FIFO.

interface PortfolioState {
  positions: Position[];
  addPosition: (p: Omit<Position, 'id'>) => void;
  importPositions: (list: Omit<Position, 'id'>[], replace: boolean) => void;
  removePosition: (id: string) => void;
  /** Add shares of a symbol as a new lot. */
  buyShares: (args: {
    symbol: string;
    name: string;
    shares: number;
    price: number;
    date?: string;
  }) => void;
  /** Sell shares of a symbol, drawing down lots oldest-first. Emptied lots are removed. */
  sellShares: (symbol: string, shares: number) => void;
  /** Remove every lot of a symbol. */
  removeSymbol: (symbol: string) => void;
  loadSamplePortfolio: () => void;
  clearAll: () => void;
}

let seq = 0;
const newId = (symbol: string) => `${symbol}-${Date.now()}-${seq++}`;

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set) => ({
      positions: [],

      addPosition: (p) => set((s) => ({ positions: [...s.positions, { ...p, id: newId(p.symbol) }] })),

      importPositions: (list, replace) =>
        set((s) => {
          const mapped = list.map((p) => ({ ...p, id: newId(p.symbol) }));
          return { positions: replace ? mapped : [...s.positions, ...mapped] };
        }),

      removePosition: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),

      buyShares: ({ symbol, name, shares, price, date }) =>
        set((s) => ({
          positions: [
            ...s.positions,
            {
              id: newId(symbol),
              symbol,
              name,
              shares,
              buyPrice: price,
              buyDate: date ?? isoDate(new Date()),
            },
          ],
        })),

      sellShares: (symbol, shares) =>
        set((s) => {
          let remaining = shares;
          const lots = s.positions
            .filter((p) => p.symbol === symbol)
            .sort((a, b) => a.buyDate.localeCompare(b.buyDate)); // oldest first
          const drained = new Map<string, number>();
          for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(lot.shares, remaining);
            drained.set(lot.id, lot.shares - take);
            remaining -= take;
          }
          return {
            positions: s.positions
              .map((p) => (drained.has(p.id) ? { ...p, shares: drained.get(p.id) as number } : p))
              // Drop emptied lots (tiny epsilon guards float drift).
              .filter((p) => p.shares > 1e-9),
          };
        }),

      removeSymbol: (symbol) =>
        set((s) => ({ positions: s.positions.filter((p) => p.symbol !== symbol) })),

      loadSamplePortfolio: () =>
        set({ positions: DEMO_POSITIONS.map((p) => ({ ...p, id: newId(p.symbol) })) }),

      clearAll: () => set({ positions: [] }),
    }),
    { name: 'stockpile.portfolio', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
