import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { buildDeck } from '@/engine/pipeline';
import { getSecret, KEYS } from '@/lib/secure';
import { BuildProgress, DeckCard } from '@/types';
import { todayKey } from '@/utils/format';
import { DEMO_DECK } from '@/data/demo';
import { useSettings } from './settings';
import { usePortfolio } from './portfolio';
import { useCatalog } from './catalog';

interface DeckState {
  cards: DeckCard[];
  builtDay: string | null; // YYYY-MM-DD of the last successful build
  progress: BuildProgress;
  consumeTopCard: () => void;
  build: (force?: boolean) => Promise<void>;
  loadDemoDeck: () => void;
  clearDeck: () => void;
}

const IDLE: BuildProgress = { phase: 'idle', done: 0, total: 0, message: '' };

export const useDeck = create<DeckState>()(
  persist(
    (set, get) => ({
      cards: [],
      builtDay: null,
      progress: IDLE,

      consumeTopCard: () => set((s) => ({ cards: s.cards.slice(1) })),

      loadDemoDeck: () => {
        const { cooldownActive, catalogSymbols } = useCatalog.getState();
        const cards = DEMO_DECK.filter(
          (c) => !cooldownActive(c.symbol) && !catalogSymbols().includes(c.symbol),
        );
        set({ cards, builtDay: todayKey(), progress: IDLE });
      },

      clearDeck: () => set({ cards: [], builtDay: null, progress: IDLE }),

      build: async (force = false) => {
        const { progress, builtDay } = get();
        if (progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error') {
          return; // already building
        }
        if (!force && builtDay === todayKey() && get().cards.length > 0) return;

        const finnhubKey = await getSecret(KEYS.finnhub);
        if (!finnhubKey) {
          get().loadDemoDeck();
          return;
        }
        const anthropicKey = await getSecret(KEYS.anthropic);
        const settings = useSettings.getState();
        const owned = usePortfolio.getState().positions.map((p) => p.symbol);
        const catalog = useCatalog.getState();
        const excluded = new Set<string>([
          ...owned,
          ...catalog.catalogSymbols(),
          ...catalog.cooldownSymbols(),
        ]);

        const leanWeights = {
          longterm: { ltWeight: 0.7, moWeight: 0.3 },
          balanced: { ltWeight: 0.5, moWeight: 0.5 },
          momentum: { ltWeight: 0.3, moWeight: 0.7 },
        }[settings.styleLean];

        const onProgress = (p: BuildProgress) => set({ progress: p });
        try {
          const cards = await buildDeck(
            {
              finnhubKey,
              anthropicKey,
              thesisModel: settings.thesisModel,
              strictness: settings.strictness,
              cardsPerDay: settings.cardsPerDay,
              ...leanWeights,
              excludedSymbols: excluded,
              swipes: catalog.swipes,
            },
            onProgress,
          );
          set({ cards, builtDay: todayKey(), progress: IDLE });
        } catch (e) {
          set({
            progress: {
              phase: 'error',
              done: 0,
              total: 0,
              message: e instanceof Error ? e.message : 'Deck build failed',
            },
          });
        }
      },
    }),
    {
      name: 'stockpile.deck',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ cards: s.cards, builtDay: s.builtDay }) as DeckState,
    },
  ),
);
