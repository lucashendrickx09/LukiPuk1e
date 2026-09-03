import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { THESIS_MODELS } from '@/api/anthropic';
import { showDialog } from '@/components/Dialog';
import { Card, SectionTitle, Tappable } from '@/components/ui';
import { KEYS, setSecret } from '@/lib/secure';
import { NotificationSetup } from '@/components/NotificationSetup';
import { useCatalog } from '@/store/catalog';
import { useDeck } from '@/store/deck';
import { usePortfolio } from '@/store/portfolio';
import { StyleLean, useSettings } from '@/store/settings';
import { colors, radius, spacing } from '@/theme';

function Segment<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <View style={styles.segment}>
      {options.map((opt) => (
        <TouchableOpacity
          key={String(opt)}
          style={[styles.segmentItem, value === opt && styles.segmentActive]}
          onPress={() => onChange(opt)}>
          <Text style={[styles.segmentTxt, value === opt && styles.segmentTxtActive]}>
            {format ? format(opt) : String(opt)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function KeyField({
  label,
  hint,
  saved,
  onSave,
}: {
  label: string;
  hint: string;
  saved: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {saved && !editing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Text style={{ color: colors.green, fontSize: 13 }}>•••••••• saved</Text>
          <Tappable onPress={() => setEditing(true)}>
            <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '600' }}>Replace</Text>
          </Tappable>
          <Tappable
            onPress={() => {
              onSave('');
              setEditing(false);
            }}>
            <Text style={{ color: colors.red, fontSize: 13 }}>Remove</Text>
          </Tappable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={hint}
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => {
              if (value.trim()) {
                onSave(value.trim());
                setValue('');
                setEditing(false);
              }
            }}>
            <Text style={{ color: '#08111E', fontWeight: '800' }}>Save</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const settings = useSettings();
  const clearDeck = useDeck((s) => s.clearDeck);
  const resetPersonalization = useCatalog((s) => s.resetPersonalization);
  const clearCatalog = useCatalog((s) => s.clearAll);
  const loadSample = usePortfolio((s) => s.loadSamplePortfolio);
  const clearPortfolio = usePortfolio((s) => s.clearAll);

  const confirm = (title: string, body: string, action: () => void) =>
    showDialog(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: action },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 64 }}>
      <SectionTitle>API keys</SectionTitle>
      <Card>
        <KeyField
          label="Finnhub key (free at finnhub.io) — market data, news, analyst trends"
          hint="paste key"
          saved={settings.hasFinnhubKey}
          onSave={async (v) => {
            await setSecret(KEYS.finnhub, v);
            settings.set({ hasFinnhubKey: !!v });
            clearDeck();
          }}
        />
        <KeyField
          label="Anthropic key (console.anthropic.com) — Claude-written theses, ~$1–5/month"
          hint="sk-ant-…"
          saved={settings.hasAnthropicKey}
          onSave={async (v) => {
            await setSecret(KEYS.anthropic, v);
            settings.set({ hasAnthropicKey: !!v });
          }}
        />
        <Text style={styles.note}>
          Keys are stored in your device keychain and only ever sent to Finnhub / Anthropic
          directly. Without an Anthropic key the app falls back to template theses.
        </Text>
      </Card>

      <SectionTitle>Deck</SectionTitle>
      <Card>
        <Text style={styles.fieldLabel}>Consensus gate — source types that must agree</Text>
        <Segment
          options={[1, 2, 3] as const}
          value={settings.strictness}
          onChange={(v) => settings.set({ strictness: v })}
          format={(v) => (v === 1 ? '1 · loose' : v === 2 ? '2 · default' : '3 · strict')}
        />
        <Text style={styles.fieldLabel}>Cards per day</Text>
        <Segment
          options={[5, 10, 15, 20] as const}
          value={settings.cardsPerDay}
          onChange={(v) => settings.set({ cardsPerDay: v })}
        />
        <Text style={styles.fieldLabel}>Style lean</Text>
        <Segment
          options={['longterm', 'balanced', 'momentum'] as const satisfies readonly StyleLean[]}
          value={settings.styleLean}
          onChange={(v) => settings.set({ styleLean: v })}
          format={(v) =>
            v === 'longterm' ? 'Long-term' : v === 'balanced' ? 'Balanced' : 'Momentum'
          }
        />
        <Text style={styles.fieldLabel}>Thesis model</Text>
        <Segment
          options={THESIS_MODELS}
          value={settings.thesisModel}
          onChange={(v) => settings.set({ thesisModel: v })}
          format={(v) => v.replace('claude-', '').replace(/-/g, ' ')}
        />
        <Text style={styles.note}>
          Setting changes apply on the next deck build — use Rebuild on the Discover tab.
        </Text>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <NotificationSetup />
      <Card>
        {(
          [
            ['Daily feed ready', 'notifyDeckReady'],
            ['Morning performance debrief', 'notifyPortfolio'],
            ['Market recap', 'notifyMarket'],
            ['Catalog stock alerts', 'notifyCatalog'],
          ] as const
        ).map(([label, key]) => (
          <View key={key} style={styles.switchRow}>
            <Text style={{ color: colors.text, fontSize: 14 }}>{label}</Text>
            <Switch
              value={settings[key]}
              onValueChange={(v) => settings.set({ [key]: v })}
              trackColor={{ true: colors.blue, false: colors.surfaceAlt }}
              thumbColor={colors.text}
            />
          </View>
        ))}
        <Text style={styles.note}>
          These build your in-app Alerts (the bell, top-right) and pop up as device notifications
          while the app is open. Alerts that fire while the app is fully closed, plus home-screen
          widgets, require the native app build.
        </Text>
      </Card>

      <SectionTitle>Data</SectionTitle>
      <Card>
        <TouchableOpacity style={styles.row} onPress={loadSample}>
          <Text style={styles.rowTxt}>Load sample portfolio</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.row}
          onPress={() => confirm('Clear portfolio', 'Remove all tracked positions?', clearPortfolio)}>
          <Text style={[styles.rowTxt, { color: colors.red }]}>Clear portfolio</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.row}
          onPress={() =>
            confirm(
              'Reset personalization',
              'Forget your swipe history? The deck will stop adapting to your taste until you swipe again.',
              resetPersonalization,
            )
          }>
          <Text style={[styles.rowTxt, { color: colors.red }]}>Reset personalization</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.row}
          onPress={() =>
            confirm('Clear catalog', 'Remove all catalogued companies and swipe history?', () => {
              clearCatalog();
            })
          }>
          <Text style={[styles.rowTxt, { color: colors.red }]}>Clear catalog & swipes</Text>
        </TouchableOpacity>
      </Card>

      <Text style={styles.disclaimer}>
        Stockpile v0.1 — educational analysis for personal use. Nothing in this app is financial
        advice; always verify against the linked primary sources before investing.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: colors.muted, fontSize: 13, marginBottom: 6, marginTop: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.blue,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  note: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: spacing.xs,
  },
  segmentItem: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: colors.blue },
  segmentTxt: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  segmentTxtActive: { color: '#08111E' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  enableBtn: {
    backgroundColor: colors.blue,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTxt: { color: colors.text, fontSize: 14, fontWeight: '600' },
  disclaimer: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});
