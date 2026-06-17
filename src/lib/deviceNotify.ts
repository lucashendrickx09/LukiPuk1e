import { Platform } from 'react-native';
import { NotificationDraft } from '@/types';

// OS-level (device) notifications. On web this uses the browser Notification
// API — which fires while the app is open or installed-and-running. On native
// it's currently a no-op; when the app ships as a native build, this is where
// expo-notifications (scheduled local notifications) plugs in.

type Perm = 'granted' | 'denied' | 'default' | 'unsupported';

/* eslint-disable @typescript-eslint/no-explicit-any */
function getN(): any {
  if (Platform.OS !== 'web') return undefined;
  return (globalThis as any).Notification;
}

export function notificationPermission(): Perm {
  const N = getN();
  if (!N) return 'unsupported';
  return N.permission;
}

export async function requestNotificationPermission(): Promise<Perm> {
  const N = getN();
  if (!N) return 'unsupported';
  if (N.permission === 'granted' || N.permission === 'denied') return N.permission;
  try {
    return await N.requestPermission();
  } catch {
    return 'denied';
  }
}

export function deviceNotify(draft: NotificationDraft): void {
  const N = getN();
  if (!N || N.permission !== 'granted') return;
  const prefix =
    draft.severity === 'urgent' ? '🔴 URGENT — ' : draft.severity === 'important' ? '⚠️ ' : '';
  try {
    // tag dedupes repeat OS notifications for the same logical event.
    new N(prefix + draft.title, { body: draft.body, tag: draft.key });
  } catch {
    // ignore delivery failures
  }
}
