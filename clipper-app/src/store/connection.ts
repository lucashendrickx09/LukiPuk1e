import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const URL_KEY = 'clipper.serverUrl';
const TOKEN_KEY = 'clipper.token';

export type ConnectionState = {
  /** e.g. "http://Lucass-MacBook-Air.local:8765" — no trailing slash. */
  serverUrl: string;
  /** Optional shared secret; only needed if the server sets webui.token. */
  token: string;
  /** True once AsyncStorage has been read on app start. */
  hydrated: boolean;
  setServer: (url: string, token: string) => Promise<void>;
  hydrate: () => Promise<void>;
};

export function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

export const useConnection = create<ConnectionState>((set) => ({
  serverUrl: '',
  token: '',
  hydrated: false,
  setServer: async (url, token) => {
    const clean = normalizeUrl(url);
    await AsyncStorage.multiSet([
      [URL_KEY, clean],
      [TOKEN_KEY, token],
    ]);
    set({ serverUrl: clean, token });
  },
  hydrate: async () => {
    const pairs = await AsyncStorage.multiGet([URL_KEY, TOKEN_KEY]);
    set({
      serverUrl: pairs[0][1] ?? '',
      token: pairs[1][1] ?? '',
      hydrated: true,
    });
  },
}));
