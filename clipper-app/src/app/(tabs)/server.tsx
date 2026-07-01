import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { testConnection } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { normalizeUrl, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

export default function ServerScreen() {
  const conn = useConnection();
  const [url, setUrl] = useState(conn.serverUrl);
  const [token, setToken] = useState(conn.token);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Reflect hydrated values once they load.
  useEffect(() => {
    if (conn.hydrated) {
      setUrl((u) => u || conn.serverUrl);
      setToken((t) => t || conn.token);
    }
  }, [conn.hydrated, conn.serverUrl, conn.token]);

  const saveAndTest = async () => {
    setBusy(true);
    setResult(null);
    const clean = normalizeUrl(url);
    const probe = await testConnection(clean, token.trim());
    if (probe.ok) {
      await conn.setServer(clean, token.trim());
      setUrl(clean);
      setResult({ ok: true, text: `Connected — ${probe.clipsReady} clip(s) waiting for review.` });
    } else {
      setResult({ ok: false, text: probe.error });
    }
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <Card>
        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="http://Your-Mac.local:8765"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.label}>Token (optional)</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="only if the server sets webui.token"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Button title="Save & test" onPress={saveAndTest} busy={busy} style={{ marginTop: spacing.md }} />
        {result && (
          <Text style={[styles.result, { color: result.ok ? colors.green : colors.red }]}>
            {result.ok ? '✅ ' : '‼️ '}
            {result.text}
          </Text>
        )}
      </Card>

      <Card>
        <Text style={styles.helpTitle}>Finding your computer’s address</Text>
        <Text style={styles.help}>
          On the Mac running the clipper, start the server with{' '}
          <Text style={styles.code}>python run.py webui</Text>, then get the address with{' '}
          <Text style={styles.code}>scutil --get LocalHostName</Text> — your address is that name
          + <Text style={styles.code}>.local:8765</Text> (e.g.{' '}
          <Text style={styles.code}>http://Lucass-MacBook-Air.local:8765</Text>).
          {'\n\n'}Your phone must be on the same Wi-Fi. Later, with Tailscale, use the{' '}
          <Text style={styles.code}>100.x.y.z</Text> address instead and it works from anywhere.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
  },
  result: { marginTop: spacing.md, fontWeight: '600' },
  helpTitle: { color: colors.text, fontWeight: '700', marginBottom: spacing.sm },
  help: { color: colors.muted, lineHeight: 21 },
  code: { color: colors.accentAlt, fontFamily: 'Courier' },
});
