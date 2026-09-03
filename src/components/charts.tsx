import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';
import { chartPalette, colors } from '@/theme';

// Hand-rolled SVG charts — no chart library, so they work identically on
// iOS, Android, and the web preview.

export function Sparkline({
  values,
  width = 72,
  height = 28,
  color,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke = color ?? (values[values.length - 1] >= values[0] ? colors.green : colors.red);
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.6} />
    </Svg>
  );
}

export function LineChart({
  values,
  labels,
  width,
  height = 160,
}: {
  values: number[];
  labels?: { left: string; right: string };
  width: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.faint, fontSize: 12 }}>No history available</Text>
      </View>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? colors.green : colors.red;
  const px = (i: number) => (i / (values.length - 1)) * (width - 8) + 4;
  const py = (v: number) => height - 18 - ((v - min) / range) * (height - 30);
  let d = `M ${px(0)} ${py(values[0])}`;
  values.forEach((v, i) => {
    if (i > 0) d += ` L ${px(i)} ${py(v)}`;
  });
  const area = `${d} L ${px(values.length - 1)} ${height - 16} L ${px(0)} ${height - 16} Z`;
  return (
    <View style={{ width }}>
      <Svg width={width} height={height - 14}>
        <Path d={area} fill={stroke + '22'} />
        <Path d={d} fill="none" stroke={stroke} strokeWidth={2} />
        <Circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r={3} fill={stroke} />
      </Svg>
      {labels ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.faint, fontSize: 11 }}>{labels.left}</Text>
          <Text style={{ color: colors.faint, fontSize: 11 }}>{labels.right}</Text>
        </View>
      ) : null}
    </View>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
}

export function Donut({ slices, size = 132 }: { slices: DonutSlice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  const paths = slices.map((slice, i) => {
    const frac = slice.value / total;
    const sweep = frac * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
    // Ring segment: outer arc then inner arc back.
    const d = `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`;
    return <Path key={slice.label + i} d={d} fill={chartPalette[i % chartPalette.length]} />;
  });
  return <Svg width={size} height={size}>{paths}</Svg>;
}

export function DonutLegend({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <View style={{ flex: 1, gap: 6 }}>
      {slices.map((s, i) => (
        <View key={s.label + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: chartPalette[i % chartPalette.length],
            }}
          />
          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>
            {s.label}
          </Text>
          <Text
            style={{
              color: colors.text,
              fontSize: 12,
              fontWeight: '600',
              fontVariant: ['tabular-nums'],
            }}>
            {((s.value / total) * 100).toFixed(0)}%
          </Text>
        </View>
      ))}
    </View>
  );
}

export function HBar({
  label,
  value,
  maxAbs,
  suffix,
}: {
  label: string;
  value: number;
  maxAbs: number;
  suffix: string;
}) {
  const frac = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const color = value >= 0 ? colors.green : colors.red;
  return (
    <View style={{ marginVertical: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {suffix}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            width: `${Math.max(2, frac * 100)}%`,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

// ---- Extended analytics visuals ----------------------------------------

/** Vertical bars around a zero baseline — monthly/period returns. */
export function BarChart({
  data,
  width,
  height = 130,
}: {
  data: { label: string; value: number }[];
  width: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 0.0001);
  const labelH = 16;
  const plotH = height - labelH;
  const zeroY = plotH / 2;
  const slot = width / data.length;
  const barW = Math.max(3, Math.min(26, slot * 0.6));
  return (
    <View style={{ width }}>
      <Svg width={width} height={plotH}>
        <Polyline
          points={`0,${zeroY} ${width},${zeroY}`}
          stroke={colors.border}
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / maxAbs) * (zeroY - 6);
          const x = i * slot + (slot - barW) / 2;
          const y = d.value >= 0 ? zeroY - h : zeroY;
          return (
            <Rect
              key={d.label + i}
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, h)}
              rx={2}
              fill={d.value >= 0 ? colors.green : colors.red}
            />
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', width }}>
        {data.map((d, i) => (
          <Text
            key={d.label + i}
            numberOfLines={1}
            style={{
              width: slot,
              textAlign: 'center',
              color: colors.faint,
              fontSize: 9,
              fontVariant: ['tabular-nums'],
            }}>
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Underwater (drawdown) chart — always <= 0, filled red. */
export function DrawdownChart({
  values,
  width,
  height = 110,
}: {
  values: number[]; // percent, <= 0
  width: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values, -0.0001);
  const px = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const py = (v: number) => 4 + (v / min) * (height - 12);
  let d = `M ${px(0)} ${py(values[0])}`;
  values.forEach((v, i) => {
    if (i > 0) d += ` L ${px(i)} ${py(v)}`;
  });
  const area = `${d} L ${px(values.length - 1)} ${py(0)} L ${px(0)} ${py(0)} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={colors.red + '33'} />
      <Path d={d} fill="none" stroke={colors.red} strokeWidth={1.6} />
    </Svg>
  );
}

/** Correlation matrix as a colour-coded grid. */
export function CorrelationHeatmap({
  symbols,
  valueFor,
  width,
}: {
  symbols: string[];
  valueFor: (a: string, b: string) => number | null;
  width: number;
}) {
  if (symbols.length < 2) return null;
  const labelW = 44;
  const n = symbols.length;
  const cell = Math.max(20, Math.floor((width - labelW) / n));
  const gridW = labelW + cell * n;
  const colorFor = (v: number) => {
    // green (diversified) -> gold -> red (moves together)
    if (v >= 0.8) return colors.red;
    if (v >= 0.6) return colors.gold;
    if (v >= 0.3) return colors.blue;
    return colors.green;
  };
  return (
    <View style={{ width: gridW }}>
      {/* column headers */}
      <View style={{ flexDirection: 'row', marginLeft: labelW }}>
        {symbols.map((s) => (
          <Text
            key={'h' + s}
            numberOfLines={1}
            style={{ width: cell, textAlign: 'center', color: colors.faint, fontSize: 9 }}>
            {s.slice(0, 4)}
          </Text>
        ))}
      </View>
      {symbols.map((rowSym) => (
        <View key={rowSym} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            numberOfLines={1}
            style={{ width: labelW, color: colors.muted, fontSize: 10, fontWeight: '600' }}>
            {rowSym.slice(0, 5)}
          </Text>
          <Svg width={cell * n} height={cell}>
            {symbols.map((colSym, j) => {
              const v = rowSym === colSym ? 1 : valueFor(rowSym, colSym);
              return (
                <Rect
                  key={colSym}
                  x={j * cell + 1}
                  y={1}
                  width={cell - 2}
                  height={cell - 2}
                  rx={3}
                  fill={v === null ? colors.surfaceAlt : colorFor(v) + (rowSym === colSym ? '55' : 'CC')}
                />
              );
            })}
          </Svg>
        </View>
      ))}
    </View>
  );
}

/** Semicircular gauge for a bounded metric (Sharpe, Beta, R²...). */
export function Gauge({
  value,
  min,
  max,
  label,
  display,
  color,
  size = 128,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  display: string;
  color: string;
  size?: number;
}) {
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const a0 = Math.PI; // left
  const a1 = Math.PI + frac * Math.PI; // sweep clockwise across the top
  const pt = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const track = `M ${pt(Math.PI)} A ${r} ${r} 0 0 1 ${pt(2 * Math.PI)}`;
  const fill = `M ${pt(a0)} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${pt(a1)}`;
  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <Svg width={size} height={size / 2 + 6}>
        <Path d={track} fill="none" stroke={colors.surfaceAlt} strokeWidth={8} strokeLinecap="round" />
        <Path d={fill} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
      </Svg>
      <Text
        style={{ color, fontSize: 20, fontWeight: '800', marginTop: -6, fontVariant: ['tabular-nums'] }}>
        {display}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

/** Two-sided comparison bars, e.g. portfolio vs benchmark. */
export function CompareBars({
  rows,
  width,
}: {
  rows: { label: string; a: number; b: number; format: (n: number) => string }[];
  width: number;
}) {
  return (
    <View style={{ width }}>
      {rows.map((r) => {
        const maxAbs = Math.max(Math.abs(r.a), Math.abs(r.b), 0.0001);
        const bar = (v: number, color: string) => (
          <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, flex: 1 }}>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                width: `${Math.max(2, (Math.abs(v) / maxAbs) * 100)}%`,
                backgroundColor: color,
              }}
            />
          </View>
        );
        return (
          <View key={r.label} style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 5 }}>
              {r.label}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {bar(r.a, r.a >= 0 ? colors.blue : colors.red)}
              <Text
                style={{
                  color: colors.blue,
                  fontSize: 11,
                  width: 62,
                  textAlign: 'right',
                  fontVariant: ['tabular-nums'],
                }}>
                {r.format(r.a)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {bar(r.b, colors.faint)}
              <Text
                style={{
                  color: colors.faint,
                  fontSize: 11,
                  width: 62,
                  textAlign: 'right',
                  fontVariant: ['tabular-nums'],
                }}>
                {r.format(r.b)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
