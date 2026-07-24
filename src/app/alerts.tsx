import { router, Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card, Chip, EmptyState } from '@/components/ui';
import { NotificationSetup } from '@/components/NotificationSetup';
import { notificationPermission } from '@/lib/deviceNotify';
import { useNotifications } from '@/store/notifications';
import { colors, spacing } from '@/theme';
import { NotificationItem } from '@/types';

function sevStyle(s: NotificationItem['severity']) {
  if (s === 'urgent') return { color: colors.red, label: 'Urgent' };
  if (s === 'important') return { color: colors.gold, label: 'Important' };
  return { color: colors.blue, label: '' };
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AlertsScreen() {
  const items = useNotifications((s) => s.items);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const clearAll = useNotifications((s) => s.clearAll);

  const onTap = (n: NotificationItem) => {
    markRead(n.id);
    if (n.type === 'deck') router.push('/discover');
    else if (n.type === 'catalog' && n.symbols?.[0]) router.push(`/company/${n.symbols[0]}`);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Alerts',
          headerRight: () =>
            items.length > 0 ? (
              <TouchableOpacity onPress={markAllRead} hitSlop={8} style={{ paddingHorizontal: 12 }}>
                <Text style={{ color: colors.blue, fontWeight: '600' }}>Read all</Text>
              </TouchableOpacity>
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48, flexGrow: 1 }}>
        {notificationPermission() !== 'granted' ? <NotificationSetup compact /> : null}
        {items.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              title="No alerts yet"
              body="Your morning debrief, market recap, daily-feed and catalog alerts show up here. Open the Portfolio tab to generate today's."
            />
          </View>
        ) : (
          <>
            {items.map((n) => {
              const s = sevStyle(n.severity);
              return (
                <TouchableOpacity key={n.id} onPress={() => onTap(n)} activeOpacity={0.7}>
                  <Card style={[styles.card, !n.read ? { borderColor: s.color + '88' } : null]}>
                    <View style={styles.row}>
                      <View style={styles.titleWrap}>
                        {!n.read ? <View style={[styles.dot, { backgroundColor: s.color }]} /> : null}
                        <Text style={styles.title}>{n.title}</Text>
                      </View>
                      <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
                    </View>
                    {s.label ? (
                      <View style={{ marginTop: 6 }}>
                        <Chip label={s.label} color={s.color} />
                      </View>
                    ) : null}
                    <Text style={styles.body}>{n.body}</Text>
                  </Card>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={clearAll} style={styles.clear}>
              <Text style={{ color: colors.red, fontWeight: '600' }}>Clear all</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  time: { color: colors.faint, fontSize: 11, marginLeft: 8 },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  clear: { alignItems: 'center', padding: spacing.md, marginTop: spacing.sm },
});
