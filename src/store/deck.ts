import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { buildDeck, buildDeckWithClaude } from '@/engine/pipeline';
import { getSecret, KEYS } from '@/lib/secure';
import { BuildProgress, DeckCard } from '@/types';
import { todayKey } from '@/utils/format';
import { DEMO_DECK } from '@/data/demo';
import { useSettings } from './settings';
import { usePortfolio } from './portfolio';
import { useCatalog } from './catalog';
import { useNotifications } from './notifications';

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

function notifyDeckReady(count: number) {
  if (count <= 0) return;
  useNotifications.getState().push({
    key: `deck-${todayKey()}`,
    type: 'deck',
    severity: 'normal',
    title: 'Your daily feed is ready',
    body: `${count} analysed ${count === 1 ? 'company is' : 'companies are'} waiting in Discover.`,
  });
}

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
        notifyDeckReady(cards.length);
      },

      clearDeck: () => set({ cards: [], builtDay: null, progress: IDLE }),

      build: async (force = false) => {
        // The persisted deck is read asynchronously, and on the web this store
        // is only created when the Discover route loads — so the tab's focus
        // effect can run while builtDay is still null and kick off a rebuild
        // of a deck we already have. Wait for the stored state first.
        await whenHydrated();
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

        const cfg = {
          finnhubKey,
          anthropicKey,
          thesisModel: settings.thesisModel,
          strictness: settings.strictness,
          cardsPerDay: settings.cardsPerDay,
          ...leanWeights,
          styleLean: settings.styleLean,
          excludedSymbols: excluded,
          swipes: catalog.swipes,
        };
        const onProgress = (p: BuildProgress) => set({ progress: p });
        try {
          let cards: DeckCard[];
          if (anthropicKey) {
            // Claude web-search engine; fall back to the Finnhub signal engine
            // if it fails (no web-search access, parse error) or returns nothing.
            try {
              cards = await buildDeckWithClaude(cfg, onProgress);
              if (cards.length === 0) cards = await buildDeck(cfg, onProgress);
            } catch {
              cards = await buildDeck(cfg, onProgress);
            }
          } else {
            cards = await buildDeck(cfg, onProgress);
          }
          set({ cards, builtDay: todayKey(), progress: IDLE });
          notifyDeckReady(cards.length);
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
      // Bump to discard any deck cached by an older build (e.g. the empty decks
      // produced by the old strict consensus gate) so a fresh one is built.
      version: 2,
      migrate: () => ({ cards: [], builtDay: null }) as unknown as DeckState,
    },
  ),
);

/** Resolves once the persisted deck has been read into the store. */
function whenHydrated(): Promise<void> {
  if (useDeck.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useDeck.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
