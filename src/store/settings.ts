import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_THESIS_MODEL } from '@/api/anthropic';

export type StyleLean = 'longterm' | 'balanced' | 'momentum';

interface SettingsState {
  strictness: 1 | 2 | 3;
  cardsPerDay: number;
  styleLean: StyleLean;
  thesisModel: string;
  notifyDeckReady: boolean;
  notifyPortfolio: boolean;
  notifyCatalog: boolean;
  // Key presence is mirrored here so UI can react; key material lives in
  // SecureStore (see lib/secure.ts), never in this persisted store.
  hasFinnhubKey: boolean;
  hasAnthropicKey: boolean;
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
      hasFinnhubKey: false,
      hasAnthropicKey: false,
      set: (partial) => set(partial),
    }),
    { name: 'stockpile.settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
