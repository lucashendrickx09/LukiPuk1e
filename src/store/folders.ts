import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// User-defined folders for organizing catalogued stocks. A symbol can live in
// any number of folders; folders reference catalog entries by symbol.

export interface Folder {
  id: string;
  name: string;
  symbols: string[];
  createdAt: string;
}

interface FoldersState {
  folders: Folder[];
  createFolder: (name: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  addSymbol: (id: string, symbol: string) => void;
  removeSymbol: (id: string, symbol: string) => void;
  toggleSymbol: (id: string, symbol: string) => void;
  pruneSymbol: (symbol: string) => void; // drop from every folder (on catalog removal)
  foldersForSymbol: (symbol: string) => Folder[];
}

export const useFolders = create<FoldersState>()(
  persist(
    (set, get) => ({
      folders: [],

      createFolder: (name) => {
        const id = 'f-' + Date.now();
        const folder: Folder = {
          id,
          name: name.trim() || 'Untitled',
          symbols: [],
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ folders: [folder, ...s.folders] }));
        return id;
      },

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)),
        })),

      deleteFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),

      addSymbol: (id, symbol) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id && !f.symbols.includes(symbol)
              ? { ...f, symbols: [...f.symbols, symbol] }
              : f,
          ),
        })),

      removeSymbol: (id, symbol) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, symbols: f.symbols.filter((x) => x !== symbol) } : f,
          ),
        })),

      toggleSymbol: (id, symbol) => {
        const f = get().folders.find((x) => x.id === id);
        if (!f) return;
        if (f.symbols.includes(symbol)) get().removeSymbol(id, symbol);
        else get().addSymbol(id, symbol);
      },

      pruneSymbol: (symbol) =>
        set((s) => ({
          folders: s.folders.map((f) => ({
            ...f,
            symbols: f.symbols.filter((x) => x !== symbol),
          })),
        })),

      foldersForSymbol: (symbol) => get().folders.filter((f) => f.symbols.includes(symbol)),
    }),
    { name: 'stockpile.folders', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
