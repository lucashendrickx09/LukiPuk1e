import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { treemap } from '@/lib/treemap';
import { colors, radius } from '@/theme';
import { fmtMoney } from '@/utils/format';

// Market-map view of the portfolio: each tile's AREA is what the position is
// worth, its COLOUR is performance. One glance answers both "where is my
// money" and "how is it doing" — which the allocation donuts can't.

export interface HeatmapCell {
  symbol: string;
  name: string;
  /** Position value — drives tile area. */
  value: number;
  /** Share of the whole portfolio, 0-100. */
  weightPct: number;
  sector: string;
  /** Today. */
  changePct: number;
  dayChange: number;
  /** Since purchase. */
  plPct: number;
  pl: number;
  logo?: string;
}

/** Which performance number drives the colour. */
export type HeatMode = 'today' | 'total';

/** Today's moves are small, lifetime P/L is not — each needs its own scale. */
export const SATURATE: Record<HeatMode, number> = { today: 3, total: 30 };

const NEUTRAL: [number, number, number] = [26, 34, 46]; // colors.surfaceAlt
const UP: [number, number, number] = [24, 128, 61];
const DOWN: [number, number, number] = [158, 42, 48];

export function heatColor(pct: number, saturateAt = SATURATE.today): string {
  if (!isFinite(pct)) return `rgb(${NEUTRAL.join(',')})`;
  const t = Math.min(1, Math.abs(pct) / saturateAt);
  const target = pct >= 0 ? UP : DOWN;
  // Never fully neutral: even a flat day should read as slightly up or down.
  const mix = 0.22 + 0.78 * t;
  const rgb = NEUTRAL.map((c, i) => Math.round(c + (target[i] - c) * mix));
  return `rgb(${rgb.join(',')})`;
}

export function cellPct(cell: HeatmapCell, mode: HeatMode): number {
  return mode === 'today' ? cell.changePct : cell.plPct;
}
function cellAmount(cell: HeatmapCell, mode: HeatMode): number {
  return mode === 'today' ? cell.dayChange : cell.pl;
}

const GAP = 3;

/**
 * One tile. Content is progressively disclosed by size — a large tile earns
 * the company name, the dollar move and its portfolio weight; a sliver gets
 * the ticker alone.
 */
export function HeatTile({
  cell,
  x,
  y,
  w,
  h,
  mode,
  onPress,
}: {
  cell: HeatmapCell;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: HeatMode;
  onPress?: (symbol: string) => void;
}) {
  const iw = Math.max(0, w - GAP);
  const ih = Math.max(0, h - GAP);
  const huge = iw >= 150 && ih >= 140;
  const big = iw >= 118 && ih >= 92;
  const mid = iw >= 74 && ih >= 54;
  const tiny = iw < 44 || ih < 32;
  const showLogo = !!cell.logo && iw >= 70 && ih >= 62;
  const logoSize = big ? 30 : 22;
  const pct = cellPct(cell, mode);
  const amount = cellAmount(cell, mode);

  return (
    <TouchableOpacity
      // react-native-web emits this as data-heat, which the layout test
      // measures against. Inert on native.
      {...({ dataSet: { heat: cell.symbol } } as unknown as Record<string, unknown>)}
      activeOpacity={0.75}
      disabled={!onPress}
      onPress={() => onPress?.(cell.symbol)}
      style={[
        styles.tile,
        {
          left: x,
          top: y,
          width: iw,
          height: ih,
          backgroundColor: heatColor(pct, SATURATE[mode]),
          padding: tiny ? 4 : 8,
        },
      ]}>
      <Text
        numberOfLines={1}
        style={[styles.symbol, { fontSize: huge ? 19 : big ? 17 : mid ? 14 : tiny ? 10 : 12 }]}>
        {cell.symbol}
      </Text>
      {big ? (
        <Text numberOfLines={1} style={styles.name}>
          {cell.name}
        </Text>
      ) : null}
      {!tiny ? (
        <Text numberOfLines={1} style={[styles.pct, { fontSize: big ? 15 : mid ? 13 : 11 }]}>
          {pct >= 0 ? '+' : ''}
          {pct.toFixed(2)}%
        </Text>
      ) : null}
      {huge ? (
        <>
          <Text numberOfLines={1} style={styles.amount}>
            {amount >= 0 ? '+' : '−'}
            {fmtMoney(Math.abs(amount), 0)} {mode === 'today' ? 'today' : 'all time'}
          </Text>
          <Text numberOfLines={1} style={styles.weight}>
            {fmtMoney(cell.value, 0)} · {cell.weightPct.toFixed(1)}% of portfolio
          </Text>
        </>
      ) : null}

      {showLogo ? (
        <Image source={{ uri: cell.logo }} style={[styles.logo, { width: logoSize, height: logoSize }]} />
      ) : null}
    </TouchableOpacity>
  );
}

/** Flat market map — every holding laid out in one rectangle. */
export function Heatmap({
  cells,
  width,
  height,
  mode = 'today',
  onPress,
}: {
  cells: HeatmapCell[];
  width: number;
  height: number;
  mode?: HeatMode;
  onPress?: (symbol: string) => void;
}) {
  const rects = useMemo(
    () => treemap(cells.map((c) => ({ item: c, value: c.value })), width, height),
    [cells, width, height],
  );

  return (
    <View style={{ width, height }}>
      {rects.map(({ item, x, y, w, h }) => (
        <HeatTile key={item.symbol} cell={item} x={x} y={y} w={w} h={h} mode={mode} onPress={onPress} />
      ))}
    </View>
  );
}

/** Market map with holdings nested inside their sector. */
export function SectorHeatmap({
  cells,
  width,
  height,
  mode = 'today',
  onPress,
}: {
  cells: HeatmapCell[];
  width: number;
  height: number;
  mode?: HeatMode;
  onPress?: (symbol: string) => void;
}) {
  const groups = useMemo(() => {
    const by = new Map<string, HeatmapCell[]>();
    for (const c of cells) {
      const list = by.get(c.sector);
      if (list) list.push(c);
      else by.set(c.sector, [c]);
    }
    return [...by.entries()]
      .map(([sector, list]) => ({
        sector,
        list,
        total: list.reduce((s, c) => s + c.value, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [cells]);

  const outer = useMemo(
    () => treemap(groups.map((g) => ({ item: g, value: g.total })), width, height),
    [groups, width, height],
  );
  const portfolio = groups.reduce((s, g) => s + g.total, 0) || 1;
  const HEADER = 19;

  return (
    <View style={{ width, height }}>
      {outer.map(({ item: group, x, y, w, h }) => {
        const bodyH = Math.max(0, h - GAP - HEADER);
        const bodyW = Math.max(0, w - GAP);
        const inner = treemap(
          group.list.map((c) => ({ item: c, value: c.value })),
          bodyW,
          bodyH,
        );
        return (
          <View key={group.sector} style={[styles.group, { left: x, top: y, width: bodyW, height: h - GAP }]}>
            <Text numberOfLines={1} style={styles.groupLabel}>
              {group.sector} · {((group.total / portfolio) * 100).toFixed(0)}%
            </Text>
            <View style={{ width: bodyW, height: bodyH }}>
              {inner.map((r) => (
                <HeatTile
                  key={r.item.symbol}
                  cell={r.item}
                  x={r.x}
                  y={r.y}
                  w={r.w}
                  h={r.h}
                  mode={mode}
                  onPress={onPress}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Colour scale strip, so the two encodings explain themselves. */
export function HeatmapLegend({ mode = 'today' }: { mode?: HeatMode }) {
  const max = SATURATE[mode];
  const steps = [-1, -0.5, -0.13, 0.13, 0.5, 1].map((f) => f * max);
  return (
    <View style={styles.legendRow}>
      <Text style={styles.legendText}>−{max}%</Text>
      {steps.map((s) => (
        <View key={s} style={[styles.legendSwatch, { backgroundColor: heatColor(s, max) }]} />
      ))}
      <Text style={styles.legendText}>+{max}%</Text>
      <Text style={[styles.legendText, { flex: 1, textAlign: 'right' }]}>size = position value</Text>
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
  amount: {
    color: '#FFFFFFCC',
    fontSize: 12,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  weight: { color: '#FFFFFF99', fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  logo: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  group: { position: 'absolute' },
  groupLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    height: 19 - 4,
    letterSpacing: 0.3,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  legendSwatch: { width: 14, height: 10, borderRadius: 2 },
  legendText: { color: colors.faint, fontSize: 11 },
});
