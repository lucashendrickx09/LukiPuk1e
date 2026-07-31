import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { treemap } from '@/lib/treemap';
import { colors, radius } from '@/theme';

// Market-map view of the portfolio: each tile's AREA is what the position is
// worth, its COLOUR is today's move. One glance answers both "where is my
// money" and "how is it doing" — which the two allocation donuts can't.

export interface HeatmapCell {
  symbol: string;
  name: string;
  /** Position value — drives tile area. */
  value: number;
  /** Today's move — drives tile colour. */
  changePct: number;
  logo?: string;
}

/** Colour saturates at ±3%, so an ordinary day still reads as shades. */
const SATURATE_AT = 3;
const NEUTRAL: [number, number, number] = [26, 34, 46]; // colors.surfaceAlt
const UP: [number, number, number] = [24, 128, 61];
const DOWN: [number, number, number] = [158, 42, 48];

export function heatColor(pct: number): string {
  if (!isFinite(pct)) return `rgb(${NEUTRAL.join(',')})`;
  const t = Math.min(1, Math.abs(pct) / SATURATE_AT);
  const target = pct >= 0 ? UP : DOWN;
  // Never fully neutral: even a flat day should read as slightly up or down.
  const mix = 0.22 + 0.78 * t;
  const rgb = NEUTRAL.map((c, i) => Math.round(c + (target[i] - c) * mix));
  return `rgb(${rgb.join(',')})`;
}

const GAP = 3;

export function Heatmap({
  cells,
  width,
  height,
  onPress,
}: {
  cells: HeatmapCell[];
  width: number;
  height: number;
  onPress?: (symbol: string) => void;
}) {
  const rects = useMemo(
    () => treemap(cells.map((c) => ({ item: c, value: c.value })), width, height),
    [cells, width, height],
  );

  return (
    <View style={{ width, height }}>
      {rects.map(({ item, x, y, w, h }) => {
        const iw = Math.max(0, w - GAP);
        const ih = Math.max(0, h - GAP);
        // Progressive disclosure by tile size — a sliver gets a ticker only.
        const big = iw >= 118 && ih >= 92;
        const mid = iw >= 74 && ih >= 54;
        const tiny = iw < 44 || ih < 32;
        const showLogo = !!item.logo && iw >= 70 && ih >= 62;
        const logoSize = big ? 30 : 22;
        const up = item.changePct >= 0;

        return (
          <TouchableOpacity
            key={item.symbol}
            // react-native-web emits this as data-heat, which the layout test
            // measures against. Inert on native.
            {...({ dataSet: { heat: item.symbol } } as unknown as Record<string, unknown>)}
            activeOpacity={0.75}
            disabled={!onPress}
            onPress={() => onPress?.(item.symbol)}
            style={[
              styles.tile,
              {
                left: x,
                top: y,
                width: iw,
                height: ih,
                backgroundColor: heatColor(item.changePct),
                padding: tiny ? 4 : 8,
              },
            ]}>
            {/* Text clusters at the top-left; the logo sits out of its way in
                the bottom-right, the way a market map reads. */}
            <Text
              numberOfLines={1}
              style={[styles.symbol, { fontSize: big ? 17 : mid ? 14 : tiny ? 10 : 12 }]}>
              {item.symbol}
            </Text>
            {big ? (
              <Text numberOfLines={1} style={styles.name}>
                {item.name}
              </Text>
            ) : null}
            {!tiny ? (
              <Text
                numberOfLines={1}
                style={[styles.pct, { fontSize: big ? 15 : mid ? 13 : 11 }]}>
                {up ? '+' : ''}
                {item.changePct.toFixed(2)}%
              </Text>
            ) : null}

            {showLogo ? (
              <Image
                source={{ uri: item.logo }}
                style={[styles.logo, { width: logoSize, height: logoSize }]}
              />
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  symbol: { color: '#FFFFFF', fontWeight: '800' },
  name: { color: '#FFFFFFAA', fontSize: 11, marginTop: 1 },
  pct: {
    color: '#FFFFFFE6',
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  logo: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 10, borderRadius: 2 },
  legendText: { color: colors.faint, fontSize: 11 },
});

/** Red → green scale strip, so the colours are self-explanatory. */
export function HeatmapLegend() {
  const steps = [-3, -1.5, -0.4, 0.4, 1.5, 3];
  return (
    <View style={[styles.legendRow, { marginTop: 10 }]}>
      <Text style={styles.legendText}>−3%</Text>
      {steps.map((s) => (
        <View key={s} style={[styles.legendSwatch, { backgroundColor: heatColor(s) }]} />
      ))}
      <Text style={styles.legendText}>+3%</Text>
      <Text style={[styles.legendText, { flex: 1, textAlign: 'right' }]}>
        size = position value
      </Text>
    </View>
  );
}
