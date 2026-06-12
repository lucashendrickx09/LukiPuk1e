import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, plColor, radius, spacing } from '@/theme';
import { fmtPct } from '@/utils/format';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Chip({ label, color = colors.blue }: { label: string; color?: string }) {
  return (
    <View style={[styles.chip, { borderColor: color + '55', backgroundColor: color + '1A' }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export function PctText({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <Text style={{ color: plColor(value), fontSize: size, fontVariant: ['tabular-nums'], fontWeight: '600' }}>
      {fmtPct(value)}
    </Text>
  );
}

export function Logo({ uri, symbol, size = 44 }: { uri?: string; symbol: string; size?: number }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: '#FFFFFF' }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        backgroundColor: colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
      }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: size * 0.4 }}>
        {symbol.slice(0, 2)}
      </Text>
    </View>
  );
}

export function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ marginVertical: 3 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{value}</Text>
      </View>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${value}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function ProgressBar({ done, total, message }: { done: number; total: number; message: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <View style={{ width: '100%', paddingHorizontal: spacing.xl }}>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${pct}%`, backgroundColor: colors.blue }]} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
        {message} {total > 0 ? `(${done}/${total})` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  scoreTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  scoreFill: { height: 6, borderRadius: 3 },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
