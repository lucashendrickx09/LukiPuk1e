import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  PanResponder,
  Platform,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { chartPalette, colors, plColor, radius, spacing, tabular } from '@/theme';

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

/**
 * A chart you can press and hold to read.
 *
 * The scrubbed value does NOT get a tooltip: `onScrub` reports the index and
 * the caller swaps its own big header number. A tooltip would sit under the
 * finger; the header is large, fixed, and never covered.
 *
 * Gesture rules, which matter because this lives inside a page that scrolls:
 * a horizontal drag scrubs, a vertical drag scrolls the page, and holding
 * still for a moment also starts a scrub. While scrubbing on the web the
 * page scroll is suppressed with a non-passive touchmove listener, the only
 * thing that stops an in-flight browser scroll.
 */
export function InteractiveChart({
  values,
  dates,
  width,
  height = 180,
  loading,
  emptyText = 'No history available',
  onScrub,
  color,
  baseline,
}: {
  values: number[];
  /** Same length as values; used only by the caller for its own label. */
  dates?: string[];
  width: number;
  height?: number;
  loading?: boolean;
  emptyText?: string;
  onScrub?: (index: number | null) => void;
  color?: string;
  /** Value the line is coloured against. Defaults to the first point. */
  baseline?: number;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const originX = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);
  const blocker = useRef<((e: Event) => void) | null>(null);
  const releaseGuard = useRef<(() => void) | null>(null);
  const scrubRef = useRef<number | null>(null);
  const boxRef = useRef<View>(null);

  const n = values.length;
  const plotH = height - 16;
  const px = useCallback((i: number) => (n < 2 ? 0 : (i / (n - 1)) * (width - 8) + 4), [n, width]);

  const { min, max } = useMemo(() => {
    if (!n) return { min: 0, max: 1 };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [values, n]);
  const range = max - min || 1;
  const py = useCallback(
    (v: number) => plotH - 6 - ((v - min) / range) * (plotH - 16),
    [plotH, min, range],
  );

  const indexFor = useCallback(
    (pageX: number) => {
      if (n < 2) return 0;
      const local = pageX - originX.current;
      const frac = (local - 4) / Math.max(1, width - 8);
      return Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    },
    [n, width],
  );

  // Stop the browser from scrolling the page under a scrub. touch-action is
  // evaluated when the gesture starts, so it cannot help once a scroll is
  // already in flight — only a non-passive preventDefault can.
  const lockPage = useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || blocker.current) return;
    const block = (e: Event) => e.preventDefault();
    blocker.current = block;
    document.addEventListener('touchmove', block, { passive: false });
  }, []);
  const unlockPage = useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !blocker.current) return;
    document.removeEventListener('touchmove', blocker.current);
    blocker.current = null;
  }, []);

  /**
   * End a scrub. Safe to call twice.
   *
   * This must not depend on the PanResponder having been granted: a press and
   * hold that never moves arms the scrub from the hold timer alone, and if
   * the finger then lifts, no responder callback fires. Without an
   * independent end the chart stayed scrubbed and the page stayed
   * scroll-locked for good.
   */
  const endScrub = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (releaseGuard.current) {
      releaseGuard.current();
      releaseGuard.current = null;
    }
    if (!armed.current && scrubRef.current === null) {
      unlockPage();
      return;
    }
    armed.current = false;
    unlockPage();
    setScrub(null);
    onScrub?.(null);
  }, [onScrub, unlockPage]);

  // The finger can leave the element (or the window) before it lifts, so the
  // end of the gesture is also watched globally while a scrub is live.
  const watchRelease = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || releaseGuard.current) return;
    const end = () => endScrub();
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    window.addEventListener('mouseup', end);
    releaseGuard.current = () => {
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      window.removeEventListener('mouseup', end);
    };
  }, [endScrub]);

  const moveScrub = useCallback(
    (pageX: number) => {
      const i = indexFor(pageX);
      scrubRef.current = i;
      setScrub(i);
      onScrub?.(i);
    },
    [indexFor, onScrub],
  );

  // Release the page lock and the global listeners if the chart unmounts
  // mid-scrub — otherwise the whole page stays unscrollable.
  useEffect(
    () => () => {
      unlockPage();
      releaseGuard.current?.();
      releaseGuard.current = null;
    },
    [unlockPage],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Never claim the touch outright — a plain tap and a vertical scroll
        // must both still reach the page.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: (e: GestureResponderEvent) => {
          const { pageX } = e.nativeEvent;
          if (holdTimer.current) clearTimeout(holdTimer.current);
          watchRelease();
          holdTimer.current = setTimeout(() => {
            armed.current = true;
            lockPage();
            moveScrub(pageX);
          }, 180);
          return false;
        },
        onMoveShouldSetPanResponder: (_e, g) => {
          if (armed.current) return true;
          const horizontal = Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy);
          if (!horizontal && holdTimer.current) {
            // Moved vertically first — this is a page scroll, not a read.
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
          }
          return horizontal;
        },
        onPanResponderGrant: (e: GestureResponderEvent) => {
          armed.current = true;
          lockPage();
          watchRelease();
          moveScrub(e.nativeEvent.pageX);
        },
        onPanResponderMove: (e: GestureResponderEvent) => moveScrub(e.nativeEvent.pageX),
        onPanResponderRelease: endScrub,
        onPanResponderTerminate: endScrub,
        onPanResponderTerminationRequest: () => !armed.current,
      }),
    [endScrub, lockPage, moveScrub, watchRelease],
  );

  if (loading) {
    return (
      <View style={{ width, height, justifyContent: 'flex-end' }}>
        <View
          style={{
            height: 2,
            backgroundColor: colors.surfaceAlt,
            marginBottom: plotH / 2,
            borderRadius: 1,
          }}
        />
        <Text style={{ color: colors.faint, fontSize: 12, textAlign: 'center' }}>
          Loading price history…
        </Text>
      </View>
    );
  }

  if (n < 2) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.faint, fontSize: 12 }}>{emptyText}</Text>
      </View>
    );
  }

  const base = baseline ?? values[0];
  const up = values[n - 1] >= base;
  const stroke = color ?? (up ? colors.green : colors.red);

  let d = `M ${px(0)} ${py(values[0])}`;
  for (let i = 1; i < n; i++) d += ` L ${px(i)} ${py(values[i])}`;
  const area = `${d} L ${px(n - 1)} ${plotH} L ${px(0)} ${plotH} Z`;
  // A range change can leave the last scrub index past the end of the new
  // series; treat that as no scrub rather than reading undefined.
  const live = scrub !== null && values[scrub] !== undefined ? scrub : null;
  const sx = live === null ? null : px(live);
  const sy = live === null ? null : py(values[live]);

  return (
    <View
      ref={boxRef}
      collapsable={false}
      onLayout={() => {
        boxRef.current?.measureInWindow?.((x) => {
          originX.current = x;
        });
      }}
      {...responder.panHandlers}
      // Tell the browser we may handle horizontal movement ourselves while
      // still allowing a vertical flick to scroll the page.
      {...(Platform.OS === 'web' ? { dataSet: { chart: 'scrub' } } : null)}
      style={{ width, height, ...(Platform.OS === 'web' ? { touchAction: 'pan-y' } : null) }}>
      <Svg width={width} height={plotH}>
        <Path d={area} fill={stroke + '22'} />
        <Path d={d} fill="none" stroke={stroke} strokeWidth={2} />
        {sx !== null && sy !== null ? (
          <>
            {/* Behind the line, muted — a reading aid, not a second series. */}
            <Line x1={sx} y1={0} x2={sx} y2={plotH} stroke={colors.faint} strokeWidth={1} opacity={0.55} />
            <Circle cx={sx} cy={sy} r={4.5} fill={stroke} stroke={colors.bg} strokeWidth={2} />
          </>
        ) : (
          <Circle cx={px(n - 1)} cy={py(values[n - 1])} r={3} fill={stroke} />
        )}
      </Svg>
      {/* The range start, only when idle. While scrubbing the caller's header
          already carries the date, and printing it twice is noise. */}
      {dates && dates.length === n && live === null ? (
        <Text
          style={{
            color: colors.faint,
            fontSize: 11,
            textAlign: 'center',
            marginTop: 2,
            ...tabular,
          }}>
          {dates[0]} → today
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Time-range picker. Fixed set, equal widths, full 44pt targets — Apple caps
 * a segmented control at about five segments on a phone and these are five.
 */
export function RangePills<T extends string>({
  ranges,
  value,
  onChange,
  accent = colors.blue,
}: {
  ranges: readonly T[];
  value: T;
  onChange: (r: T) => void;
  accent?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {ranges.map((r) => {
        const active = r === value;
        return (
          <View key={r} style={{ flex: 1 }}>
            <Text
              accessibilityRole="button"
              accessibilityState={active ? { selected: true } : {}}
              onPress={() => onChange(r)}
              style={{
                textAlign: 'center',
                paddingVertical: 13,
                borderRadius: radius.sm,
                overflow: 'hidden',
                backgroundColor: active ? accent : colors.surfaceAlt,
                color: active ? '#08111E' : colors.muted,
                fontSize: 13,
                fontWeight: '700',
              }}>
              {r}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The scrubbed value plus its change from the range baseline. */
export function scrubReadout(
  values: number[],
  index: number | null,
): { value: number; changePct: number } | null {
  if (index === null || index < 0 || index >= values.length) return null;
  const base = values[0];
  const v = values[index];
  return { value: v, changePct: base ? ((v - base) / base) * 100 : 0 };
}

export function LineChart({
  values,
  labels,
  width,
  height = 160,
  loading,
}: {
  values: number[];
  labels?: { left: string; right: string };
  width: number;
  height?: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.faint, fontSize: 12 }}>Loading price history…</Text>
      </View>
    );
  }
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
