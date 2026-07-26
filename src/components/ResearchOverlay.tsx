import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showDialog } from '@/components/Dialog';
import { useResearch } from '@/store/research';
import { colors, radius, spacing } from '@/theme';

// Deep research takes minutes — each company is a live web-search call, not a
// cached lookup. This covers the whole screen for the duration so the app never
// looks frozen, and it lives at the app root so switching tabs doesn't hide a
// run that's still going.

// Cycled underneath the headline so a long single call still shows movement.
const HINTS = [
  'Opening the latest 10-K and 10-Q on SEC EDGAR…',
  'Pulling revenue, margins and free cash flow…',
  'Reading what management said on the earnings call…',
  'Collecting bank and research-house price targets…',
  'Comparing where the sell side disagrees…',
  'Checking 13F changes by well-known managers…',
  'Looking at Form 4 insider buying and selling…',
  'Searching congressional STOCK Act disclosures…',
  'Weighing the evidence against what you already own…',
];

export function ResearchOverlay() {
  const running = useResearch((s) => s.running);
  const progress = useResearch((s) => s.progress);
  const live = useResearch((s) => s.live);
  const insets = useSafeAreaInsets();

  const [hint, setHint] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!running) return;
    setHint(0);
    setElapsed(0);
    const h = setInterval(() => setHint((i) => (i + 1) % HINTS.length), 4200);
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - (live.startedAt || Date.now())) / 1000)),
      1000,
    );
    return () => {
      clearInterval(h);
      clearInterval(t);
    };
    // live.startedAt identifies the run; re-arm only when a new one begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, live.startedAt]);

  useEffect(() => {
    if (!running) return;
    const spinning = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    const pulsing = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: false }),
      ]),
    );
    spinning.start();
    pulsing.start();
    return () => {
      spinning.stop();
      pulsing.stop();
    };
  }, [running, spin, pulse]);

  if (!running) return null;

  const total = Math.max(1, live.symbols.length);
  const finished = live.done.length + live.failed.length;
  const pct = progress.phase === 'synthesis' ? 100 : Math.round((finished / total) * 100);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  const stop = () =>
    showDialog('Stop the research?', 'Briefs already finished are kept. The rest is discarded.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => useResearch.getState().cancel() },
    ]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={stop}>
      <View style={[styles.fill, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        {/* Orbiting ring around a steady core — deliberately slow, because the
            work underneath is slow and a fast spinner would over-promise. */}
        <View style={styles.ringWrap}>
          <Animated.View
            style={[
              styles.ring,
              {
                transform: [
                  {
                    rotate: spin.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.core,
              { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) },
            ]}
          />
          <Text style={styles.pctTxt}>{pct}%</Text>
        </View>

        <Text style={styles.headline}>
          {progress.phase === 'synthesis'
            ? 'Weighing it all up'
            : live.active.length > 0
              ? `Researching ${live.active.join(', ')}`
              : 'Getting started'}
        </Text>
        <Text style={styles.hint}>
          {progress.phase === 'synthesis'
            ? 'Turning the briefs into sized, funded moves…'
            : HINTS[hint]}
        </Text>

        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.max(3, pct)}%` }]} />
        </View>
        <Text style={styles.meta}>
          {finished} of {live.symbols.length} researched · {mins > 0 ? `${mins}m ` : ''}
          {secs}s elapsed
        </Text>

        {/* Per-company checklist so progress is legible, not just a bar. */}
        <ScrollView style={styles.list} contentContainerStyle={{ paddingVertical: spacing.sm }}>
          {live.symbols.map((sym) => {
            const state = live.done.includes(sym)
              ? 'done'
              : live.failed.includes(sym)
                ? 'failed'
                : live.active.includes(sym)
                  ? 'active'
                  : 'queued';
            return (
              <View key={sym} style={styles.row}>
                <Text style={[styles.mark, MARK_STYLE[state]]}>{MARK[state]}</Text>
                <Text style={[styles.sym, state === 'queued' && { color: colors.faint }]}>{sym}</Text>
                <Text style={styles.rowState}>{LABEL[state]}</Text>
              </View>
            );
          })}
        </ScrollView>

        <Text style={styles.note}>
          Each company is read live from filings, analyst notes, institutional filings and
          congressional disclosures. Leaving this screen is fine — the run keeps going.
        </Text>

        <TouchableOpacity style={styles.stop} onPress={stop}>
          <Text style={styles.stopTxt}>Stop</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const MARK: Record<string, string> = { done: '✓', failed: '✕', active: '◍', queued: '○' };
const LABEL: Record<string, string> = {
  done: 'brief ready',
  failed: 'no sources found',
  active: 'reading…',
  queued: 'queued',
};
const MARK_STYLE: Record<string, { color: string }> = {
  done: { color: colors.green },
  failed: { color: colors.red },
  active: { color: colors.blue },
  queued: { color: colors.faint },
};

const RING = 104;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: colors.surfaceAlt,
    borderTopColor: colors.blue,
    borderRightColor: colors.purple,
  },
  core: {
    position: 'absolute',
    width: RING - 34,
    height: RING - 34,
    borderRadius: (RING - 34) / 2,
    backgroundColor: colors.blue + '1F',
  },
  pctTxt: { color: colors.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },

  headline: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
    minHeight: 38,
  },

  track: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.blue },
  meta: { color: colors.faint, fontSize: 12, marginTop: spacing.sm, fontVariant: ['tabular-nums'] },

  list: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    maxHeight: 260,
    // Size to the rows rather than filling the column — a three-company run
    // shouldn't leave a third of the screen empty.
    flexGrow: 0,
    flexShrink: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  mark: { fontSize: 14, width: 16, textAlign: 'center', fontWeight: '800' },
  sym: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  rowState: { color: colors.faint, fontSize: 11 },

  note: {
    color: colors.faint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  stop: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  stopTxt: { color: colors.red, fontSize: 14, fontWeight: '700' },
});
