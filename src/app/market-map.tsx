import { router, Stack } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  cellPct,
  HeatMode,
  Heatmap,
  HeatmapCell,
  HeatmapLegend,
  SectorHeatmap,
} from '@/components/Heatmap';
import { EmptyState } from '@/components/ui';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';
import { buildHoldings } from '@/lib/holdings';
import { useMarket } from '@/store/market';
import { usePortfolio } from '@/store/portfolio';
import { colors, plColor, radius, spacing } from '@/theme';
import { fmtMoney, fmtPct } from '@/utils/format';

// The zoomed market map. The card on the Portfolio tab is the thumbnail; this
// is the whole thing — full height, sector grouping, and enough room per tile
// for the dollar move and the position's weight.

export default function MarketMapScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const positions = usePortfolio((s) => s.positions);
  const quotes = useMarket((s) => s.quotes);
  const profiles = useMarket((s) => s.profiles);

  const [mode, setMode] = useState<HeatMode>('today');
  const [grouped, setGrouped] = useState(false);

  const holdings = useMemo(
    () => buildHoldings({ positions, quotes, profiles }),
    [positions, quotes, profiles],
  );
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);

  useFocusEffect(
    useCallback(() => {
      if (symbols.length > 0) {
        useMarket.getState().refreshQuotes(symbols);
        useMarket.getState().ensureProfiles(symbols);
      }
    }, [symbols]),
  );

  const total = holdings.reduce((s, h) => s + h.value, 0);
  const cells: HeatmapCell[] = useMemo(
    () =>
      holdings.map((h) => ({
        symbol: h.symbol,
        name: h.name,
        value: h.value,
        weightPct: total > 0 ? (h.value / total) * 100 : 0,
        sector:
          profiles[h.symbol]?.sector ??
          UNIVERSE_BY_SYMBOL.get(h.symbol)?.fallbackSector ??
          h.sector ??
          'Other',
        changePct: h.dayChangePct,
        dayChange: h.dayChange,
        plPct: h.plPct,
        pl: h.pl,
        logo: profiles[h.symbol]?.logo,
      })),
    [holdings, profiles, total],
  );

  const dayChange = holdings.reduce((s, h) => s + h.dayChange, 0);
  const totalPl = holdings.reduce((s, h) => s + h.pl, 0);
  const headline = mode === 'today' ? dayChange : totalPl;
  const headlinePct =
    mode === 'today'
      ? total - dayChange !== 0
        ? (dayChange / (total - dayChange)) * 100
        : 0
      : total - totalPl !== 0
        ? (totalPl / (total - totalPl)) * 100
        : 0;

  // Best and worst movers under whichever lens is selected.
  const ranked = useMemo(
    () => [...cells].sort((a, b) => cellPct(b, mode) - cellPct(a, mode)),
    [cells, mode],
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  if (cells.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: 'Market map' }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            title="Nothing to map yet"
            body="The market map sizes each tile by what the position is worth. Add some holdings and it fills in."
          />
        </View>
      </>
    );
  }

  const mapW = width - spacing.lg * 2;
  // Everything above the map: summary strip, two toggles, legend, footnote.
  const chrome = 240 + insets.bottom;
  const mapH = Math.max(280, height - chrome);

  const open = (symbol: string) => router.push(`/holding/${symbol}`);

  return (
    <>
      <Stack.Screen options={{ title: 'Market map' }} />
      <View style={[styles.page, { paddingBottom: insets.bottom + spacing.md }]}>
        {/* Summary for the selected lens */}
        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>
              {mode === 'today' ? 'Today' : 'All time'}
            </Text>
            <Text style={[styles.summaryValue, { color: plColor(headline) }]}>
              {fmtMoney(headline)} ({fmtPct(headlinePct)})
            </Text>
          </View>
          {/* Best/worst is a ranking, but the arrow must follow the sign — on a
              day when everything is up, the laggard is not a loser. */}
          <View style={{ alignItems: 'flex-end' }}>
            {[best, worst].map((c, i) => {
              const pct = cellPct(c, mode);
              return (
                <Text key={i} style={styles.movers} numberOfLines={1}>
                  <Text style={{ color: plColor(pct) }}>
                    {pct >= 0 ? '▲' : '▼'} {c.symbol}
                  </Text>{' '}
                  {fmtPct(pct)}
                </Text>
              );
            })}
          </View>
        </View>

        {/* Colour lens */}
        <View style={styles.segment}>
          {(
            [
              ['today', "Today's move"],
              ['total', 'Total P/L'],
            ] as [HeatMode, string][]
          ).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.segmentBtn, mode === key && styles.segmentActive]}
              onPress={() => setMode(key)}>
              <Text style={[styles.segmentTxt, mode === key && styles.segmentTxtActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Layout */}
        <View style={styles.segment}>
          {[
            [false, 'All holdings'],
            [true, 'By sector'],
          ].map(([key, label]) => (
            <TouchableOpacity
              key={String(key)}
              style={[styles.segmentBtn, grouped === key && styles.segmentActive]}
              onPress={() => setGrouped(key as boolean)}>
              <Text style={[styles.segmentTxt, grouped === key && styles.segmentTxtActive]}>
                {label as string}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {grouped ? (
          <SectorHeatmap cells={cells} width={mapW} height={mapH} mode={mode} onPress={open} />
        ) : (
          <Heatmap cells={cells} width={mapW} height={mapH} mode={mode} onPress={open} />
        )}

        <HeatmapLegend mode={mode} />
        <Text style={styles.footnote}>Tap a tile to open the position.</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  summaryLabel: { color: colors.muted, fontSize: 12 },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  movers: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
    marginBottom: spacing.sm,
  },
  segmentBtn: { flex: 1, paddingVertical: 7, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.blue },
  segmentTxt: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  segmentTxtActive: { color: '#08111E', fontWeight: '800' },
  footnote: { color: colors.faint, fontSize: 11, textAlign: 'center', marginTop: spacing.sm },
});
