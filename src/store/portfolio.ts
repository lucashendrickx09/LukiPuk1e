import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Position } from '@/types';
import { DEMO_POSITIONS } from '@/data/demo';

interface PortfolioState {
  positions: Position[];
  addPosition: (p: Omit<Position, 'id'>) => void;
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
