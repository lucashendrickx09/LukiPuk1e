import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Position } from '@/types';
import { DEMO_POSITIONS } from '@/data/demo';

interface PortfolioState {
  positions: Position[];
  addPosition: (p: Omit<Position, 'id'>) => void;
  importPositions: (list: Omit<Position, 'id'>[], replace: boolean) => void;
  removePosition: (id: string) => void;
  loadSamplePortfolio: () => void;
  clearAll: () => void;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set) => ({
      positions: [],
      addPosition: (p) =>
        set((s) => ({
          positions: [...s.positions, { ...p, id: `${p.symbol}-${Date.now()}` }],
        })),
      importPositions: (list, replace) =>
        set((s) => {
          const mapped = list.map((p, i) => ({ ...p, id: `${p.symbol}-${Date.now()}-${i}` }));
          return { positions: replace ? mapped : [...s.positions, ...mapped] };
        }),
      removePosition: (id) =>
        set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
      loadSamplePortfolio: () =>
        set({
          positions: DEMO_POSITIONS.map((p) => ({ ...p, id: `${p.symbol}-demo` })),
        }),
      clearAll: () => set({ positions: [] }),
    }),
    { name: 'stockpile.portfolio', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
