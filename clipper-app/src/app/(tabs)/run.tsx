import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, PipelineStep, StatusResponse } from '@/lib/api';
import { Button, Card, Empty } from '@/components/ui';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

const STEPS: { step: PipelineStep; label: string }[] = [
  { step: 'ingest', label: '⬇ Ingest' },
  { step: 'transcribe', label: '🗣 Transcribe' },
  { step: 'analyze', label: '🧠 Analyze' },
  { step: 'render', label: '✂ Render' },
  { step: 'publish', label: '📤 Publish' },
];

function Count({ n, label }: { n: number | undefined; label: string }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countN}>{n ?? 0}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

export default function RunScreen() {
  const serverUrl = useConnection((s) => s.serverUrl);
  const hydrated = useConnection((s) => s.hydrated);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!serverUrl) return;
    try {
      setStatus(await api.status());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [serverUrl]);

  // Poll while this tab is focused.
  useFocusEffect(
    useCallback(() => {
      refresh();
      timer.current = setInterval(refresh, 2500);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }, [refresh]),
  );

  const start = async (step: PipelineStep) => {
    try {
      const res = await api.runStep(step);
      if (!res.started) Alert.alert('Busy', res.reason ?? 'a step is already running');
      refresh();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : String(e));
    }
  };

  if (hydrated && !serverUrl) {
    return <Empty text={'Not connected.\nGo to the Server tab and enter your computer’s address.'} />;
  }

  const job = status?.job;
  const clips = status?.counts.clips ?? {};
  const videos = status?.counts.videos ?? {};
  const busy = !!job?.running;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <Card
        style={{
          borderColor: busy ? colors.accent : job?.last && !job.last.ok ? colors.red : colors.border,
        }}>
        {busy ? (
          <Text style={{ color: colors.accentAlt, fontWeight: '600' }}>⏳ running {job?.running}…</Text>
        ) : job?.last ? (
          <Text style={{ color: job.last.ok ? colors.green : colors.red }}>
            {job.last.ok ? '✅' : '‼️'} {job.last.step} — {job.last.result}
          </Text>
        ) : (
          <Text style={{ color: colors.muted }}>{error ?? 'idle'}</Text>
        )}
      </Card>

      <Button title="▶ Run all" onPress={() => start('run')} disabled={busy} style={{ marginBottom: spacing.md }} />
      <View style={styles.grid}>
        {STEPS.map(({ step, label }) => (
          <Button
            key={step}
            title={label}
            kind="secondary"
            disabled={busy}
            onPress={() => start(step)}
            style={styles.gridButton}
          />
        ))}
      </View>

      <Text style={styles.h3}>Ledger</Text>
      <View style={styles.counts}>
        <Count n={videos.transcribed} label="transcribed" />
        <Count n={clips.candidate} label="candidates" />
        <Count n={clips.ready} label="ready" />
        <Count n={clips.approved} label="approved" />
        <Count n={clips.posted} label="posted" />
        <Count n={clips.rejected} label="rejected" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridButton: { flexBasis: '48%', flexGrow: 1 },
  h3: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  count: {
    flexBasis: '31%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  countN: { color: colors.text, fontSize: 20, fontWeight: '700' },
  countLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
