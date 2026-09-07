import React from 'react';
import {
  ActivityIndicator,
  Image,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, HIT, plColor, radius, spacing, tabular } from '@/theme';
import { dirGlyph, fmtPct } from '@/utils/format';

/**
 * A touch target whose tappable area is larger than it looks.
 *
 * `hitSlop` is the usual way to do this, but react-native-web does not
 * implement it — every hitSlop in this app was a no-op in the PWA, which is
 * where it actually runs. Padding plus an equal negative margin grows the hit
 * area on every platform while leaving surrounding layout exactly where it
 * was.
 */
export function Tappable({
  onPress,
  onLongPress,
  expand = 12,
  style,
  disabled,
  children,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  /** Pixels of invisible target added on every side. */
  expand?: number;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={0.6}
      style={[{ padding: expand, margin: -expand }, style]}>
      {children}
    </TouchableOpacity>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
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

/**
 * A percentage change.
 *
 * `glyph` adds ▲/▼ so the direction survives for a reader who cannot separate
 * red from green — WCAG 1.4.1 asks for a second channel besides colour.
 */
export function PctText({
  value,
  size = 14,
  glyph = true,
}: {
  value: number;
  size?: number;
  glyph?: boolean;
}) {
  const g = glyph ? dirGlyph(value) : '';
  return (
    <Text
      style={{
        color: plColor(value),
        fontSize: size,
        fontWeight: '600',
        ...tabular,
      }}>
      {g ? <Text style={{ fontSize: size * 0.72 }}>{g} </Text> : null}
      {fmtPct(value)}
    </Text>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

/**
 * The one filled/outlined button.
 *
 * There were ten hand-rolled copies of this across the screens, with radii
 * drifting 8–12, vertical padding 8–15 and three different label weights, so
 * two buttons rarely matched on the same screen. Every one is at least the
 * 44pt minimum target.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  busy,
  tone,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  disabled?: boolean;
  busy?: boolean;
  /** Overrides the accent for secondary/ghost variants (e.g. purple). */
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const accent = tone ?? (variant === 'destructive' ? colors.red : colors.blue);
  const filled = variant === 'primary' || variant === 'destructive';
  const height = size === 'sm' ? HIT : 50;
  const off = disabled || busy;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={off}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[
        styles.btn,
        {
          minHeight: height,
          backgroundColor: filled ? accent : variant === 'secondary' ? 'transparent' : 'transparent',
          borderColor: variant === 'secondary' ? accent : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: off ? 0.45 : 1,
        },
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={filled ? '#08111E' : accent} /> : null}
      <Text
        style={[
          styles.btnLabel,
          { color: filled ? '#08111E' : accent, fontSize: size === 'sm' ? 14 : 15 },
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * A row of equal-width options — time ranges, modes, scopes.
 *
 * Apple caps a segmented control at about five segments on a phone, so this
 * stays inline up to five and the caller splits anything longer.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
  accent = colors.blue,
  style,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  accent?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segment, style]}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <TouchableOpacity
            key={String(opt)}
            onPress={() => onChange(opt)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={active ? { selected: true } : {}}
            style={[styles.segmentItem, active && { backgroundColor: accent }]}>
            <Text
              numberOfLines={1}
              style={[styles.segmentTxt, active && { color: '#08111E', fontWeight: '700' }]}>
              {format ? format(opt) : String(opt)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * A short status line under a value: freshness, staleness, or a failure that
 * still has usable cached numbers above it.
 *
 * Replaces printing a raw `fetch` rejection ("Failed to fetch") in red.
 */
export function StatusLine({
  text,
  tone = 'muted',
  onRetry,
  retryLabel = 'Retry',
}: {
  text: string;
  tone?: 'muted' | 'warn';
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.statusTxt, tone === 'warn' && { color: colors.gold }]} numberOfLines={2}>
        {text}
      </Text>
      {onRetry ? (
        <Tappable onPress={onRetry} expand={10}>
          <Text style={styles.statusRetry}>{retryLabel}</Text>
        </Tappable>
      ) : null}
    </View>
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

export function EmptyState({ title, body }: { title: string; body: string }) {  return (
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
    // Soft elevation for an iOS-card feel (maps to box-shadow on web).
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
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
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  btnLabel: { fontWeight: '800' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: HIT - 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  segmentTxt: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 8 },
  statusTxt: { color: colors.muted, fontSize: 12, lineHeight: 17, flex: 1 },
  statusRetry: { color: colors.blue, fontSize: 12, fontWeight: '700' },
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
