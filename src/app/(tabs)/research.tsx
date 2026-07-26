import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RESEARCH_MODELS } from '@/api/anthropic';
import { showDialog } from '@/components/Dialog';
import { Collapsible, ConfidenceMeter, Paragraphs, VerdictChip } from '@/components/research';
import { Card, EmptyState, Logo, SectionTitle } from '@/components/ui';
import { ResearchDepth, searchesPerCompany } from '@/engine/deepResearch';
import { useCatalog } from '@/store/catalog';
import { useMarket } from '@/store/market';
import { usePortfolio } from '@/store/portfolio';
import { ResearchScope, SCOPE_OPTIONS, useResearch } from '@/store/research';
import { useSettings } from '@/store/settings';
import { colors, radius, spacing } from '@/theme';
import { RebalanceAction } from '@/types';
import { fmtMoney } from '@/utils/format';

export default function ResearchScreen() {
  const running = useResearch((s) => s.running);
  const error = useResearch((s) => s.error);
  const runs = useResearch((s) => s.runs);
  const reports = useResearch((s) => s.reports);
  const depth = useResearch((s) => s.depth);
  const model = useResearch((s) => s.model);
  const cashUsd = useResearch((s) => s.cashUsd);
  const hasKey = useSettings((s) => s.hasAnthropicKey);

  const [scope, setScope] = useState<ResearchScope>('all');
  const [cashDraft, setCashDraft] = useState(String(cashUsd || ''));

  // Recomputed whenever the book or the shortlist changes, so the cost line and
  // the run button always reflect what's actually there.
  const positions = usePortfolio((s) => s.positions);
  const entries = useCatalog((s) => s.entries);
  const planned = useMemo(
    () => useResearch.getState().plan(scope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, positions, entries],
  );
  const latest = runs[0];

  const reportList = useMemo(
    () =>
      Object.values(reports).sort(
        (a, b) =>
          Number(b.owned) - Number(a.owned) ||
          b.confidence - a.confidence ||
          a.symbol.localeCompare(b.symbol),
      ),
    [reports],
  );

  const start = () => {
    const searches = planned.length * searchesPerCompany(depth);
    showDialog(
      `Research ${planned.length} companies?`,
      `This makes ${planned.length + 1} Claude calls and up to ${searches} live web searches — the most expensive thing the app does, billed to your own API key. It usually takes a few minutes.\n\n${planned.join(', ')}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run research', onPress: () => useResearch.getState().run(scope) },
      ],
    );
  };

  if (!hasKey) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Deep research needs your Claude key"
          body="This page reads company filings, bank research, institutional 13F filings and congressional trading disclosures for each company, then sizes the moves. Add an Anthropic API key in Settings to switch it on."
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/settings')}>
          <Text style={styles.primaryBtnTxt}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 56 }}>
      {/* ---- Run controls ---- */}
      <Card>
        <Text style={styles.h1}>What should change?</Text>
        <Text style={styles.sub}>
          Every company is read across four evidence pillars — its own filings and statements, Wall
          Street and bank research, institutional and insider positioning, and congressional trading
          disclosures — then judged against what you already own.
        </Text>

        <View style={styles.segment}>
          {SCOPE_OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={[styles.segmentBtn, scope === o.key && styles.segmentBtnActive]}
              onPress={() => setScope(o.key)}>
              <Text
                style={[styles.segmentTxt, scope === o.key && { color: '#08111E', fontWeight: '800' }]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.scopeHelp}>
          {SCOPE_OPTIONS.find((o) => o.key === scope)?.help}
        </Text>

        {/* While a run is in flight the full-screen loading view (mounted at
            the app root) is what you actually see; this is just the resting
            state underneath it. */}
        <TouchableOpacity
          style={[styles.primaryBtn, (planned.length === 0 || running) && { opacity: 0.4 }]}
          disabled={planned.length === 0 || running}
          onPress={start}>
          <Text style={styles.primaryBtnTxt}>
            {running ? 'Research running…' : latest ? 'Run research again' : 'Run deep research'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.costLine}>
          {planned.length} compan{planned.length === 1 ? 'y' : 'ies'} · up to{' '}
          {planned.length * searchesPerCompany(depth)} web searches · {model}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Collapsible title="Options" subtitle="Cash to deploy, depth, model">
          <Text style={styles.fieldLabel}>Cash available to deploy</Text>
          <TextInput
            style={styles.input}
            value={cashDraft}
            onChangeText={setCashDraft}
            onBlur={() => useResearch.getState().setCash(Number(cashDraft) || 0)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.faint}
          />
          <Text style={styles.fieldHelp}>
            Buys are funded from a specific sale unless there is cash here.
          </Text>

          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Depth</Text>
          <View style={styles.segment}>
            {(['standard', 'deep'] as ResearchDepth[]).map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.segmentBtn, depth === d && styles.segmentBtnActive]}
                onPress={() => useResearch.getState().setDepth(d)}>
                <Text
                  style={[styles.segmentTxt, depth === d && { color: '#08111E', fontWeight: '800' }]}>
                  {d === 'standard' ? 'Standard' : 'Deep'} · {searchesPerCompany(d)} searches
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Model</Text>
          <View style={styles.segment}>
            {RESEARCH_MODELS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.segmentBtn, model === m && styles.segmentBtnActive]}
                onPress={() => useResearch.getState().setModel(m)}>
                <Text
                  style={[styles.segmentTxt, model === m && { color: '#08111E', fontWeight: '800' }]}
                  numberOfLines={1}>
                  {m.replace('claude-', '')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldHelp}>
            Opus reasons hardest over conflicting evidence; Haiku is the cheapest per run.
          </Text>
        </Collapsible>
      </Card>

      {/* ---- Latest run ---- */}
      {latest ? (
        <>
          <SectionTitle>The portfolio, in one view</SectionTitle>
          <Card>
            <Paragraphs text={latest.portfolioView} />
            <Text style={styles.stamp}>
              {latest.symbols.length} companies · {latest.model} ·{' '}
              {latest.finishedAt?.slice(0, 10) ?? latest.startedAt.slice(0, 10)}
            </Text>
          </Card>

          <SectionTitle>Suggested moves</SectionTitle>
          {latest.actions.length === 0 ? (
            <Card>
              <Text style={styles.body}>
                Nothing worth doing right now — the research did not find a change that clears the
                bar. Leaving a portfolio alone is a decision too.
              </Text>
            </Card>
          ) : (
            latest.actions.map((a) => <ActionCard key={a.id} action={a} />)
          )}

          <Collapsible
            title="How this was researched"
            subtitle="Sources consulted, and the blind spots">
            <Paragraphs text={latest.method} muted />
            {latest.failures.length > 0 ? (
              <Text style={styles.failures}>
                Could not research: {latest.failures.map((f) => f.symbol).join(', ')} —{' '}
                {latest.failures[0].reason}
              </Text>
            ) : null}
            <Text style={styles.disclaimer}>
              Congressional trade data comes from public STOCK Act filings, which lag the actual
              trade by up to 45 days and report dollar ranges rather than exact amounts. 13F holdings
              are quarter-end snapshots filed up to 45 days later. None of this is inside
              information, and none of it is financial advice.
            </Text>
          </Collapsible>
        </>
      ) : null}

      {/* ---- Company briefs ---- */}
      {reportList.length > 0 ? (
        <>
          <SectionTitle>Company briefs</SectionTitle>
          {reportList.map((r) => (
            <TouchableOpacity key={r.symbol} onPress={() => router.push(`/research/${r.symbol}`)}>
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Logo uri={useMarket.getState().profiles[r.symbol]?.logo} symbol={r.symbol} size={38} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.briefSym}>
                      {r.symbol}
                      {r.owned ? <Text style={styles.ownedTag}>  ·  owned</Text> : null}
                    </Text>
                    <Text style={styles.briefName} numberOfLines={1}>
                      {r.name}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <VerdictChip verdict={r.verdict} />
                    <Text style={styles.briefConf}>{r.confidence}/100</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          ))}
        </>
      ) : !latest ? (
        <EmptyState
          title="No research yet"
          body="Run it once and every company you own or have catalogued gets a sourced brief — what they actually do, who is buying or selling them, and whether they earn their place."
        />
      ) : null}
    </ScrollView>
  );
}

/** One suggested move, with the option to actually execute it. */
function ActionCard({ action }: { action: RebalanceAction }) {
  const [applied, setApplied] = useState(false);
  const quotes = useMarket((s) => s.quotes);
  const entries = useCatalog((s) => s.entries);

  const priceOf = (symbol: string): number | undefined =>
    quotes[symbol]?.price ?? entries.find((e) => e.card.symbol === symbol)?.card.price;
  const nameOf = (symbol: string): string =>
    useMarket.getState().profiles[symbol]?.name ??
    entries.find((e) => e.card.symbol === symbol)?.card.profile.name ??
    symbol;

  const canSell = !!action.sellSymbol && !!action.sellShares;
  const buyPrice = action.buySymbol ? priceOf(action.buySymbol) : undefined;
  const buyShares =
    action.buyShares ??
    (action.buyValueUsd && buyPrice ? Math.round((action.buyValueUsd / buyPrice) * 100) / 100 : 0);
  const canBuy = !!action.buySymbol && !!buyPrice && buyShares > 0;
  const executable = canSell || canBuy;

  const apply = () => {
    const steps: string[] = [];
    if (canSell) steps.push(`Sell ${action.sellShares} ${action.sellSymbol}`);
    if (canBuy) steps.push(`Buy ${buyShares} ${action.buySymbol} at ${fmtMoney(buyPrice as number)}`);
    showDialog(
      'Record this in your portfolio?',
      `${steps.join('\n')}\n\nThis only updates Stockpile's records — it does not place a real trade with your broker.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record it',
          onPress: () => {
            if (canSell) {
              usePortfolio.getState().sellShares(action.sellSymbol as string, action.sellShares as number);
            }
            if (canBuy) {
              usePortfolio.getState().buyShares({
                symbol: action.buySymbol as string,
                name: nameOf(action.buySymbol as string),
                shares: buyShares,
                price: buyPrice as number,
              });
            }
            setApplied(true);
          },
        },
      ],
    );
  };

  const c = action.confidence >= 70 ? colors.green : action.confidence >= 45 ? colors.gold : colors.red;

  return (
    <Card style={{ marginBottom: spacing.sm, borderColor: c + '44' }}>
      <Text style={styles.actionHeadline}>{action.headline}</Text>
      <ConfidenceMeter value={action.confidence} />

      <Text style={[styles.body, { marginTop: spacing.md }]}>{action.reasoning}</Text>

      {action.risks ? (
        <View style={styles.riskBox}>
          <Text style={styles.riskLabel}>What would make this wrong</Text>
          <Text style={styles.riskTxt}>{action.risks}</Text>
        </View>
      ) : null}

      {action.sourceUrls.length > 0 ? (
        <View style={{ marginTop: spacing.md, gap: 4 }}>
          {action.sourceUrls.slice(0, 4).map((u) => (
            <TouchableOpacity key={u} onPress={() => Linking.openURL(u)}>
              <Text style={styles.sourceLink} numberOfLines={1}>
                {u.replace(/^https?:\/\/(www\.)?/, '')} ↗
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {executable ? (
        applied ? (
          <View style={[styles.secondaryBtn, { marginTop: spacing.md, borderColor: colors.green }]}>
            <Text style={[styles.secondaryBtnTxt, { color: colors.green }]}>Recorded ✓</Text>
          </View>
        ) : (
          <TouchableOpacity style={[styles.secondaryBtn, { marginTop: spacing.md }]} onPress={apply}>
            <Text style={styles.secondaryBtnTxt}>Record in my portfolio</Text>
          </TouchableOpacity>
        )
      ) : action.buySymbol && !buyPrice ? (
        <Text style={styles.noPrice}>
          No live price for {action.buySymbol} yet — open it once so Stockpile can quote it, then
          record the buy from its page.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  h1: { color: colors.text, fontSize: 19, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    marginTop: spacing.md,
    gap: 3,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.blue },
  segmentTxt: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  scopeHelp: { color: colors.faint, fontSize: 12, marginTop: spacing.sm },

  primaryBtn: {
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryBtnTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnTxt: { color: colors.blue, fontWeight: '700', fontSize: 14 },
  costLine: { color: colors.faint, fontSize: 11, textAlign: 'center', marginTop: spacing.sm },
  error: { color: colors.red, fontSize: 13, lineHeight: 19, marginTop: spacing.md },

  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  fieldHelp: { color: colors.faint, fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 15,
  },

  stamp: { color: colors.faint, fontSize: 11, marginTop: spacing.md },
  actionHeadline: { color: colors.text, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  riskBox: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  riskLabel: { color: colors.gold, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  riskTxt: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  sourceLink: { color: colors.blue, fontSize: 11 },
  noPrice: { color: colors.faint, fontSize: 11, lineHeight: 16, marginTop: spacing.md },

  briefSym: { color: colors.text, fontSize: 15, fontWeight: '800' },
  ownedTag: { color: colors.faint, fontSize: 11, fontWeight: '600' },
  briefName: { color: colors.faint, fontSize: 12, marginTop: 1 },
  briefConf: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },

  failures: { color: colors.gold, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  disclaimer: { color: colors.faint, fontSize: 11, lineHeight: 16, marginTop: spacing.md },
});
