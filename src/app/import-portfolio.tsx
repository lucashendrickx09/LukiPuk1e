import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Card } from '@/components/ui';
import {
  fetchHoldingsFromUrl,
  holdingsToPositions,
  parseHoldings,
} from '@/lib/importHoldings';
import { usePortfolio } from '@/store/portfolio';
import { colors, radius, spacing } from '@/theme';
import { fmtMoney } from '@/utils/format';

export default function ImportPortfolioScreen() {
  const importPositions = usePortfolio((s) => s.importPositions);
  const existing = usePortfolio((s) => s.positions.length);
  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const preview = useMemo(
    () => (paste.trim() ? holdingsToPositions(parseHoldings(paste)) : []),
    [paste],
  );

  const doImport = (positions: ReturnType<typeof holdingsToPositions>) => {
    if (positions.length === 0) {
      setMsg({ ok: false, text: 'No holdings found — paste rows that start with a ticker symbol.' });
      return;
    }
    importPositions(positions, replace);
    router.back();
  };

  const fromSheet = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const holdings = await fetchHoldingsFromUrl(url.trim());
      const positions = holdingsToPositions(holdings);
      if (positions.length === 0) throw new Error('No holdings with shares were found.');
      importPositions(positions, replace);
      router.back();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>
        Paste a table of holdings (from a spreadsheet or broker export), or import a published Google
        Sheet. Recognised columns: <Text style={styles.mono}>ticker</Text>,{' '}
        <Text style={styles.mono}>shares</Text>, <Text style={styles.mono}>cost</Text> (total paid) —
        plus optional <Text style={styles.mono}>name</Text>. Extra columns are ignored.
      </Text>

      {existing > 0 ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>On import</Text>
          <View style={styles.segment}>
            {(
              [
                ['Replace', true],
                ['Add to existing', false],
              ] as const
            ).map(([label, val]) => (
              <TouchableOpacity
                key={label}
                style={[styles.segItem, replace === val && styles.segActive]}
                onPress={() => setReplace(val)}>
                <Text style={[styles.segTxt, replace === val && styles.segTxtActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <TextInput
        style={styles.textarea}
        value={paste}
        onChangeText={setPaste}
        placeholder={'AAPL  10  1965\nMSFT  4   1872\nNVDA  12  1814'}
        placeholderTextColor={colors.faint}
        multiline
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {preview.length > 0 ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.previewTitle}>Preview · {preview.length} holdings</Text>
          <View style={styles.thead}>
            <Text style={[styles.th, { flex: 1 }]}>Ticker</Text>
            <Text style={[styles.th, styles.numCol]}>Shares</Text>
            <Text style={[styles.th, styles.numCol]}>$/share</Text>
          </View>
          {preview.slice(0, 30).map((p, i) => (
            <View key={p.symbol + i} style={styles.trow}>
              <Text style={[styles.td, { flex: 1, fontWeight: '700' }]}>{p.symbol}</Text>
              <Text style={[styles.td, styles.numCol]}>{p.shares}</Text>
              <Text style={[styles.td, styles.numCol]}>
                {p.buyPrice > 0 ? fmtMoney(p.buyPrice) : '—'}
              </Text>
            </View>
          ))}
          {preview.length > 30 ? (
            <Text style={styles.more}>+{preview.length - 30} more</Text>
          ) : null}
        </Card>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryBtn, preview.length === 0 && styles.btnDisabled]}
        disabled={preview.length === 0 || busy}
        onPress={() => doImport(preview)}>
        <Text style={styles.primaryBtnTxt}>
          {preview.length > 0 ? `Import ${preview.length} holdings` : 'Import holdings'}
        </Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerTxt}>or from a Google Sheet</Text>
        <View style={styles.line} />
      </View>

      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="Published Google Sheet URL"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.hint}>
        In Sheets: File ▸ Share ▸ Publish to web ▸ CSV, then paste the link here.
      </Text>
      <TouchableOpacity
        style={[styles.ghostBtn, (!url.trim() || busy) && styles.btnDisabled]}
        disabled={!url.trim() || busy}
        onPress={fromSheet}>
        {busy ? (
          <ActivityIndicator color={colors.blue} />
        ) : (
          <Text style={styles.ghostBtnTxt}>Import from Sheet</Text>
        )}
      </TouchableOpacity>

      {msg ? (
        <Text style={[styles.msg, { color: msg.ok ? colors.green : colors.red }]}>{msg.text}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  mono: { color: colors.text, fontWeight: '700' },
  toggleRow: { marginBottom: spacing.md },
  toggleLabel: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segActive: { backgroundColor: colors.blue },
  segTxt: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  segTxtActive: { color: '#08111E' },
  textarea: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: 12,
    fontSize: 14,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  previewTitle: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm, fontWeight: '600' },
  thead: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 6 },
  th: { color: colors.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  trow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border + '55' },
  td: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  numCol: { width: 80, textAlign: 'right' },
  more: { color: colors.faint, fontSize: 12, marginTop: 8 },
  primaryBtn: {
    backgroundColor: colors.blue,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryBtnTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.4 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xl },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerTxt: { color: colors.faint, fontSize: 12 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: 6 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  ghostBtnTxt: { color: colors.blue, fontWeight: '700', fontSize: 14 },
  msg: { fontSize: 13, marginTop: spacing.md, textAlign: 'center' },
});
