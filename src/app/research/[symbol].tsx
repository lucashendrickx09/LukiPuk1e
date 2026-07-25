import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BulletList,
  Collapsible,
  ConfidenceMeter,
  EvidencePillar,
  Paragraphs,
  SourceList,
  VerdictChip,
} from '@/components/research';
import { Card, EmptyState, Logo, SectionTitle } from '@/components/ui';
import { confidenceLabel, PILLAR_LABELS } from '@/engine/deepResearch';
import { useMarket } from '@/store/market';
import { useResearch } from '@/store/research';
import { colors, radius, spacing } from '@/theme';

export default function ResearchReportScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const report = useResearch((s) => (symbol ? s.reports[symbol] : undefined));
  const logo = useMarket((s) => (symbol ? s.profiles[symbol]?.logo : undefined));

  if (!report) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          title={symbol ?? 'Unknown'}
          body="No deep-research brief for this company yet. Run research from the Research tab and it will appear here."
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: report.symbol }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 64 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Logo uri={logo} symbol={report.symbol} size={50} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{report.name}</Text>
            <Text style={styles.sub}>
              {report.symbol}
              {report.owned ? ' · you own this' : ' · shortlisted'}
            </Text>
          </View>
          <VerdictChip verdict={report.verdict} size={13} />
        </View>

        {/* ---- The call ---- */}
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.verdictLine}>
            {confidenceLabel(report.confidence)}
            {report.targetWeightPct
              ? ` · suggested weight ${report.targetWeightPct.toFixed(0)}% of the portfolio`
              : ''}
          </Text>
          <ConfidenceMeter value={report.confidence} />
          <View style={{ marginTop: spacing.md }}>
            <Paragraphs text={report.reasoning} />
          </View>
        </Card>

        {/* ---- Who they are (the elongated description) ---- */}
        <SectionTitle>Who they are</SectionTitle>
        <Card>
          <Paragraphs text={report.profileLong} />
          {report.businessModel ? (
            <>
              <Text style={styles.subhead}>How the money is made</Text>
              <Paragraphs text={report.businessModel} />
            </>
          ) : null}
          {report.moat ? (
            <>
              <Text style={styles.subhead}>What protects them</Text>
              <Paragraphs text={report.moat} />
            </>
          ) : null}
        </Card>

        <SectionTitle>Their role from here</SectionTitle>
        <Card>
          <Paragraphs text={report.futureRole} />
          {report.relevanceDrivers.length > 0 ? (
            <>
              <Text style={styles.subhead}>What keeps them relevant</Text>
              <BulletList items={report.relevanceDrivers} color={colors.green} glyph="▲" />
            </>
          ) : null}
          {report.relevanceRisks.length > 0 ? (
            <>
              <Text style={styles.subhead}>What could make them irrelevant</Text>
              <BulletList items={report.relevanceRisks} color={colors.red} glyph="▼" />
            </>
          ) : null}
        </Card>

        {/* ---- Evidence ---- */}
        <SectionTitle>The evidence</SectionTitle>
        <Card>
          <EvidencePillar
            title={PILLAR_LABELS.financials.title}
            caveat={PILLAR_LABELS.financials.caveat}
            block={report.financials}
            sources={report.sources}
          />
          <EvidencePillar
            title={PILLAR_LABELS.wallStreet.title}
            caveat={PILLAR_LABELS.wallStreet.caveat}
            block={report.wallStreet}
            sources={report.sources}
          />
          <EvidencePillar
            title={PILLAR_LABELS.institutions.title}
            caveat={PILLAR_LABELS.institutions.caveat}
            block={report.institutions}
            sources={report.sources}
          />
          <EvidencePillar
            title={PILLAR_LABELS.politicians.title}
            caveat={PILLAR_LABELS.politicians.caveat}
            block={report.politicians}
            sources={report.sources}
          />
        </Card>

        {/* ---- The numbers ---- */}
        {report.keyData.length > 0 ? (
          <>
            <SectionTitle>The data behind it</SectionTitle>
            <Card>
              {report.keyData.map((d, i) => (
                <View key={i} style={styles.dataRow}>
                  <Text style={styles.dataLabel}>{d.label}</Text>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={styles.dataValue}>{d.value}</Text>
                    {d.note ? <Text style={styles.dataNote}>{d.note}</Text> : null}
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {/* ---- Kept deliberately separate from the evidence ---- */}
        {report.speculation ? (
          <>
            <SectionTitle>Speculation</SectionTitle>
            <Card style={{ borderColor: colors.gold + '55' }}>
              <Text style={styles.specLabel}>
                Not from any document — this is judgement about what happens next.
              </Text>
              <Paragraphs text={report.speculation} />
            </Card>
          </>
        ) : null}

        {report.disconfirming.length > 0 ? (
          <>
            <SectionTitle>What would prove this wrong</SectionTitle>
            <Card>
              <BulletList items={report.disconfirming} color={colors.gold} glyph="◆" />
            </Card>
          </>
        ) : null}

        <SectionTitle>Sources</SectionTitle>
        <Card>
          <SourceList sources={report.sources} />
        </Card>

        <Collapsible title="Limits of this brief">
          <Text style={styles.limits}>
            Written by {report.model} from live web sources on {report.generatedAt.slice(0, 10)}.
            Congressional trades come from public STOCK Act filings, lagged by up to 45 days and
            reported as dollar ranges rather than exact amounts — weak, delayed, public signal, not
            inside information. 13F institutional holdings are quarter-end snapshots filed up to 45
            days later. Sell-side ratings are opinions, and the firms publishing them often have
            business relationships with the companies they cover. Anything the search could not
            reach shows up as a low evidence score rather than a guess. Educational research for
            your own decisions — not financial advice.
          </Text>
        </Collapsible>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => router.push(`/company/${report.symbol}`)}>
          <Text style={styles.linkBtnTxt}>Open {report.symbol} price & stats</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 19, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  verdictLine: { color: colors.text, fontSize: 14, fontWeight: '700' },
  subhead: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dataLabel: { color: colors.muted, fontSize: 13, flex: 1 },
  dataValue: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  dataNote: { color: colors.faint, fontSize: 11, marginTop: 2, textAlign: 'right' },
  specLabel: { color: colors.gold, fontSize: 11, fontWeight: '700', marginBottom: spacing.sm },
  limits: { color: colors.faint, fontSize: 11, lineHeight: 17 },
  linkBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  linkBtnTxt: { color: colors.blue, fontSize: 14, fontWeight: '700' },
});
