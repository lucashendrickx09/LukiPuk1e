/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform } from 'react-native';
import { NotificationDraft } from '@/types';

// OS-level (device) notifications.
//
// iOS rules that shape this file (iOS 16.4+):
//  • window.Notification only exists in an INSTALLED PWA (Add to Home Screen).
//    In a plain Safari tab it is undefined — notifications are impossible there.
//  • Permission must be requested from a real user gesture (a tap handler).
//  • Notifications MUST be shown via ServiceWorkerRegistration.showNotification();
//    `new Notification()` does not work on iOS.
// Android/desktop are more permissive, so the SW path is used everywhere with a
// constructor fallback only where the SW isn't available.

export type Perm = 'granted' | 'denied' | 'default' | 'unsupported';

function getN(): any {
  if (Platform.OS !== 'web') return undefined;
  return (globalThis as any).Notification;
}

/** True when running as an installed/standalone app rather than a browser tab. */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web') return true; // native builds are always "installed"
  const w = globalThis as any;
  if (w.navigator?.standalone === true) return true; // iOS
  try {
    return Boolean(w.matchMedia?.('(display-mode: standalone)')?.matches);
  } catch {
    return false;
  }
}

export function notificationPermission(): Perm {
  const N = getN();
  if (!N) return 'unsupported';
  return N.permission as Perm;
}

/** Must be called from inside a user gesture (tap handler) to work on iOS. */
export async function requestNotificationPermission(): Promise<Perm> {
  const N = getN();
  if (!N) return 'unsupported';
  if (N.permission === 'granted' || N.permission === 'denied') return N.permission as Perm;
  try {
    return (await N.requestPermission()) as Perm;
  } catch {
    return 'denied';
  }
}

/**
 * Why notifications can't be enabled right now, or null if they can.
 * Used to show the user an actionable message instead of silent failure.
 */
export function notificationBlocker(): string | null {
  if (Platform.OS !== 'web') return null;
  const N = getN();
  if (!N) {
    return isStandalone()
      ? 'This browser doesn’t support notifications.'
      : 'On iPhone, notifications only work once the app is added to your Home Screen. Tap Share → Add to Home Screen, then open Stockpile from the icon.';
  }
  if (N.permission === 'denied') {
    return 'Notifications are blocked. Enable them for Stockpile in iOS Settings → Notifications (or your browser’s site settings).';
  }
  return null;
}

function decorate(draft: NotificationDraft): { title: string; body: string } {
  const prefix =
    draft.severity === 'urgent' ? '🔴 URGENT — ' : draft.severity === 'important' ? '⚠️ ' : '';
  return { title: prefix + draft.title, body: draft.body };
}

/** Delivers an OS notification. Resolves true when it was actually shown. */
export async function deviceNotify(draft: NotificationDraft): Promise<boolean> {
  const N = getN();
  if (!N || N.permission !== 'granted') return false;
  const { title, body } = decorate(draft);
  const options: any = {
    body,
    tag: draft.key,
    icon: iconUrl(),
    badge: iconUrl(),
    data: { key: draft.key, type: draft.type },
  };

  const nav = (globalThis as any).navigator;
  // Service worker path — required on iOS, preferred everywhere.
  if (nav?.serviceWorker) {
    try {
      const reg = await nav.serviceWorker.ready;
      await reg.showNotification(title, options);
      return true;
    } catch {
      // fall through to the constructor
    }
  }
  try {
    new N(title, options);
    return true;
  } catch {
    return false;
  }
}

function iconUrl(): string | undefined {
  const base = (globalThis as any).__STOCKPILE_BASE__ ?? '';
  return typeof base === 'string' ? `${base}/app-icon.png` : undefined;
}
