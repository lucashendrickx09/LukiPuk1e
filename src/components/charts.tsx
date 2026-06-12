import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
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
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
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
