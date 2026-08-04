import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/ui';
import { Holding } from '@/lib/holdings';
import { colors, plColor, radius, spacing } from '@/theme';
import { capTierLabel, capTierOf, fmtCompact, fmtMoney, fmtPct } from '@/utils/format';

// Long-press a market-map tile and this comes up: the two numbers you actually
// want (how much am I up or down, in dollars and in percent) at the top, then
// everything else that's known about the position.

export function HoldingStatsSheet({
  holding,
  weightPct,
  logo,
  sector,
  onClose,
  onOpen,
}: {
  holding: Holding | null;
  weightPct: number;
  logo?: string;
  sector?: string;
  onClose: () => void;
  onOpen: (symbol: string) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!holding) return null;
  const h = holding;

  const rows: [string, string, string?][] = [
    ['Shares', String(h.shares)],
    ['Average cost', fmtMoney(h.avgCost)],
    ['Current price', fmtMoney(h.price)],
    ['Invested', fmtMoney(h.cost, 0)],
    ['Market value', fmtMoney(h.value, 0)],
    ['Today', `${fmtMoney(h.dayChange)} (${fmtPct(h.dayChangePct)})`, 'day'],
    ['Portfolio weight', `${weightPct.toFixed(1)}%`],
    ['Sector', sector ?? h.sector],
    ['Market cap', h.marketCapM ? fmtCompact(h.marketCapM * 1e6) : '–'],
    ['Size', h.marketCapM ? capTierLabel(capTierOf(h.marketCapM)).split(' · ')[0] : '–'],
    ['First bought', h.firstBuyDate],
    ['Lots', `${h.lots.length} purchase${h.lots.length === 1 ? '' : 's'}`],
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Stop taps inside the sheet from dismissing it. */}
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Logo uri={logo} symbol={h.symbol} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.symbol}>{h.symbol}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {h.name}
              </Text>
            </View>
          </View>

          {/* The headline answer: up or down, in both units. */}
          <View style={styles.plBox}>
            <Text style={styles.plLabel}>Total gain / loss</Text>
            <Text style={[styles.plValue, { color: plColor(h.pl) }]}>
              {fmtMoney(h.pl)}
            </Text>
            <Text style={[styles.plPct, { color: plColor(h.pl) }]}>{fmtPct(h.plPct)}</Text>
          </View>

          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ paddingBottom: 4 }}>
            {rows.map(([label, value, kind]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text
                  style={[
                    styles.rowValue,
                    kind === 'day' && { color: plColor(h.dayChange) },
                  ]}>
                  {value}
                </Text>
              </View>
            ))}
          </ScrollView>

          <Pressable
            style={styles.openBtn}
            onPress={() => {
              onClose();
              onOpen(h.symbol);
            }}>
            <Text style={styles.openBtnTxt}>Open {h.symbol} · chart, buy & sell</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  symbol: { color: colors.text, fontSize: 19, fontWeight: '800' },
  name: { color: colors.muted, fontSize: 13, marginTop: 1 },
  plBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  plLabel: { color: colors.muted, fontSize: 12 },
  plValue: {
    fontSize: 30,
    fontWeight: '800',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  plPct: { fontSize: 16, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  openBtn: {
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  openBtnTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
});
