import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing } from '@/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}) {
  const toneColor =
    tone === 'good' ? colors.green : tone === 'bad' ? colors.red : tone === 'warn' ? colors.amber : colors.muted;
  return (
    <View style={styles.badge}>
      <Text style={[styles.badgeText, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    kind === 'primary' ? colors.accent : kind === 'danger' ? colors.red : kind === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = kind === 'ghost' ? colors.muted : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Row of mutually-exclusive options (used for source type / permission). */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => onChange(opt)}
          style={[styles.segment, value === opt && styles.segmentActive]}>
          <Text style={[styles.segmentText, value === opt && { color: colors.text }]}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={{ color: colors.muted, textAlign: 'center', lineHeight: 22 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  badge: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
  button: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700', fontSize: 15 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  empty: { padding: spacing.xl, alignItems: 'center' },
});
