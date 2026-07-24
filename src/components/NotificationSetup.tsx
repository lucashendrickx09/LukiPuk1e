import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  isStandalone,
  notificationBlocker,
  notificationPermission,
  Perm,
  requestNotificationPermission,
} from '@/lib/deviceNotify';
import { useNotifications } from '@/store/notifications';
import { colors, radius, spacing } from '@/theme';

// Permission flow for phone notifications. The request MUST happen inside this
// tap handler — iOS ignores permission prompts that aren't user-initiated.
export function NotificationSetup({ compact = false }: { compact?: boolean }) {
  const [perm, setPerm] = useState<Perm>(notificationPermission());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocker = notificationBlocker();

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    const result = await requestNotificationPermission();
    setPerm(result);
    if (result === 'granted') {
      // Deliver anything already generated today, then confirm with a test.
      const sent = await useNotifications.getState().deliverPending();
      await useNotifications.getState().sendTest();
      setMsg(
        sent > 0
          ? `Enabled — sent ${sent} alert${sent === 1 ? '' : 's'} from today plus a test.`
          : 'Enabled — check your Notification Center for the test alert.',
      );
    } else if (result === 'denied') {
      setMsg('Permission denied. Turn it on in iOS Settings → Notifications → Stockpile.');
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const ok = await useNotifications.getState().sendTest();
    setMsg(ok ? 'Test sent — check your Notification Center.' : 'Could not send. Check permission.');
    setBusy(false);
  };

  // Not installed to the Home Screen — on iOS that's a hard blocker.
  if (perm === 'unsupported' && !isStandalone()) {
    return (
      <View style={[styles.box, compact && styles.compact]}>
        <Text style={styles.title}>Turn on phone notifications</Text>
        <Text style={styles.body}>
          On iPhone, alerts can only reach your Notification Center once Stockpile is added to your
          Home Screen.{'\n\n'}
          In Safari: tap <Text style={styles.b}>Share</Text> → <Text style={styles.b}>Add to Home
          Screen</Text>, then open Stockpile from the new icon and come back here.
        </Text>
      </View>
    );
  }

  if (perm === 'granted') {
    return (
      <View style={[styles.box, compact && styles.compact]}>
        <View style={styles.row}>
          <Text style={styles.okDot}>●</Text>
          <Text style={styles.okText}>Phone notifications are on</Text>
        </View>
        <Text style={styles.body}>
          Your morning debrief, market recap, daily-feed and catalog alerts will appear in your
          Notification Center.
        </Text>
        <TouchableOpacity style={styles.ghost} onPress={test} disabled={busy}>
          <Text style={styles.ghostText}>Send a test notification</Text>
        </TouchableOpacity>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.box, compact && styles.compact]}>
      <Text style={styles.title}>Turn on phone notifications</Text>
      <Text style={styles.body}>
        {blocker ??
          'Get your morning performance debrief, market recap, daily-feed-ready and catalog alerts delivered to your phone.'}
      </Text>
      {perm !== 'denied' ? (
        <TouchableOpacity style={styles.primary} onPress={enable} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? 'Enabling…' : 'Allow notifications'}</Text>
        </TouchableOpacity>
      ) : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.blue + '55',
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  compact: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  b: { color: colors.text, fontWeight: '700' },
  primary: {
    backgroundColor: colors.blue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  primaryText: { color: '#08111E', fontWeight: '800', fontSize: 14 },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  ghostText: { color: colors.blue, fontWeight: '700', fontSize: 13 },
  okDot: { color: colors.green, fontSize: 12 },
  okText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  msg: { color: colors.blue, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
});
