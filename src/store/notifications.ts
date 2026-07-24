import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { fetchMarketNews } from '@/api/finnhub';
import { buildCatalogAlerts, buildMarketRecap, buildMorningDebrief } from '@/engine/notifications';
import { deviceNotify } from '@/lib/deviceNotify';
import { getSecret, KEYS } from '@/lib/secure';
import { NotificationDraft, NotificationItem } from '@/types';
import { todayKey } from '@/utils/format';
import { useCatalog } from './catalog';
import { useMarket } from './market';
import { usePortfolio } from './portfolio';
import { useSettings } from './settings';

// In-app Alerts center + OS delivery. `scan()` regenerates the day's
// notifications (debrief, catalog moves, market recap) from current state;
// the deck store calls push() directly for the "daily feed ready" alert.
// push() dedupes by key, so scanning repeatedly in a day is safe.

interface NotificationsState {
  items: NotificationItem[];
  scanning: boolean;
  push: (draft: NotificationDraft) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  unread: () => number;
  scan: () => Promise<void>;
  /**
   * Send OS notifications for today's alerts that were created before
   * permission was granted. Without this, alerts generated earlier are deduped
   * on their key and would never reach the phone.
   */
  deliverPending: () => Promise<number>;
  /** Fire a one-off notification so the user can verify delivery works. */
  sendTest: () => Promise<boolean>;
}

function typeAllowed(type: NotificationItem['type']): boolean {
  const st = useSettings.getState();
  return {
    debrief: st.notifyPortfolio,
    market: st.notifyMarket,
    deck: st.notifyDeckReady,
    catalog: st.notifyCatalog,
  }[type];
}

export const useNotifications = create<NotificationsState>()(
  persist(
    (set, get) => ({
      items: [],
      scanning: false,

      push: (draft) => {
        if (get().items.some((i) => i.key === draft.key)) return false;
        const item: NotificationItem = {
          ...draft,
          id: `${draft.key}-${Date.now()}`,
          createdAt: new Date().toISOString(),
          read: false,
          delivered: false,
        };
        set((s) => ({ items: [item, ...s.items].slice(0, 100) }));
        // OS delivery is gated by the per-type toggle in Settings. Mark the
        // item delivered only if the OS actually showed it, so deliverPending()
        // can retry later (e.g. once the user grants permission).
        if (typeAllowed(draft.type)) {
          deviceNotify(draft).then((ok) => {
            if (ok) {
              set((s) => ({
                items: s.items.map((i) => (i.id === item.id ? { ...i, delivered: true } : i)),
              }));
            }
          });
        }
        return true;
      },

      deliverPending: async () => {
        const today = todayKey();
        const pending = get().items.filter(
          (i) => !i.delivered && i.createdAt.slice(0, 10) === today && typeAllowed(i.type),
        );
        let sent = 0;
        // Oldest first so the newest alert ends up on top of the stack.
        for (const item of [...pending].reverse()) {
          const ok = await deviceNotify(item);
          if (!ok) break; // permission gone / unsupported — stop trying
          sent++;
          set((s) => ({
            items: s.items.map((i) => (i.id === item.id ? { ...i, delivered: true } : i)),
          }));
        }
        return sent;
      },

      sendTest: () =>
        deviceNotify({
          key: `test-${Date.now()}`,
          type: 'deck',
          severity: 'normal',
          title: 'Stockpile notifications are on',
          body: 'This is a test alert. Your morning debrief and market updates will arrive like this.',
        }),

      markRead: (id) =>
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)) })),
      markAllRead: () => set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) })),
      clearAll: () => set({ items: [] }),
      unread: () => get().items.filter((i) => !i.read).length,

      scan: async () => {
        if (get().scanning) return;
        set({ scanning: true });
        try {
          const day = todayKey();
          const positions = usePortfolio.getState().positions;
          const catalogEntries = useCatalog.getState().entries;
          const syms = [...new Set([...positions.map((p) => p.symbol), ...catalogEntries.map((e) => e.card.symbol)])];
          if (syms.length) await useMarket.getState().refreshQuotes(syms);
          const quotes = useMarket.getState().quotes;

          const debrief = buildMorningDebrief(positions, quotes, day);
          if (debrief) get().push(debrief);

          for (const a of buildCatalogAlerts(catalogEntries, quotes, day)) get().push(a);

          // Market recap — fetch at most once per day.
          if (!get().items.some((i) => i.key === `market-${day}`)) {
            let headlines: { headline: string }[] = [];
            const key = await getSecret(KEYS.finnhub);
            if (key) {
              try {
                headlines = (await fetchMarketNews(key)).slice(0, 3).map((h) => ({ headline: h.headline }));
              } catch {
                // fall back to the no-data recap
              }
            }
            get().push(buildMarketRecap(headlines, day));
          }
        } finally {
          set({ scanning: false });
        }
      },
    }),
    {
      name: 'stockpile.notifications',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items }) as NotificationsState,
    },
  ),
);
