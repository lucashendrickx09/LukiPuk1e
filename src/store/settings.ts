import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_THESIS_MODEL, THESIS_MODELS } from '@/api/anthropic';
import { SortKey } from '@/lib/holdings';

export type StyleLean = 'longterm' | 'balanced' | 'momentum';

interface SettingsState {
  strictness: 1 | 2 | 3;
  cardsPerDay: number;
  styleLean: StyleLean;
  thesisModel: string;
  notifyDeckReady: boolean;
  notifyPortfolio: boolean;
  notifyCatalog: boolean;
  notifyMarket: boolean;
  // Key presence is mirrored here so UI can react; key material lives in
  // SecureStore (see lib/secure.ts), never in this persisted store.
  hasFinnhubKey: boolean;
  hasAnthropicKey: boolean;
  /** Portfolio holdings sort order. */
  sortKey: SortKey;
  set: (partial: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      strictness: 2,
      cardsPerDay: 10,
      styleLean: 'balanced',
      thesisModel: DEFAULT_THESIS_MODEL,
      notifyDeckReady: true,
      notifyPortfolio: true,
      notifyCatalog: true,
      notifyMarket: true,
      hasFinnhubKey: false,
      hasAnthropicKey: false,
      sortKey: 'value',
      set: (partial) => set(partial),
    }),
    {
      name: 'stockpile.settings',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // A model name saved before the list changed would leave the picker with
      // nothing highlighted; snap it back to the default instead.
      migrate: (persisted) => {
        const s = persisted as Partial<SettingsState>;
        if (s && s.thesisModel && !THESIS_MODELS.includes(s.thesisModel)) {
          s.thesisModel = DEFAULT_THESIS_MODEL;
        }
        return s as unknown as SettingsState;
      },
    },
  ),
);
