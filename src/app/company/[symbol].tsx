import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { fetchDailyCandles, lastNCandles } from '@/api/stooq';
import { InteractiveChart, RangePills } from '@/components/charts';
import { BulletList, ConfidenceMeter, Paragraphs, VerdictChip } from '@/components/research';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Logo,
  PctText,
  ScoreBar,
  SectionTitle,
} from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { useDeck } from '@/store/deck';
import { useMarket } from '@/store/market';
import { useResearch } from '@/store/research';
import { colors, radius, spacing } from '@/theme';
import { Candle } from '@/types';
import { capTierLabel, fmtCompact, fmtMoney, fmtPct } from '@/utils/format';

const RANGES = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '1Y', days: 252 },
] as const;

export default function CompanyDetailScreen() {
  const { width } = useWindowDimensions();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const catalogEntry = useCatalog((s) => s.entries.find((e) => e.card.symbol === symbol));
  const deckCard = useDeck((s) => s.cards.find((c) => c.symbol === symbol));
  const quote = useMarket((s) => (symbol ? s.quotes[symbol] : undefined));
  const report = useResearch((s) => (symbol ? s.reports[symbol] : undefined));
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loadingCandles, setLoadingCandles] = useState(true);
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [scrub, setScrub] = useState<number | null>(null);

  const card = catalogEntry?.card ?? deckCard;

  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setLoadingCandles(true);
    fetchDailyCandles(symbol).then((c) => {
      if (!live) return;
      setCandles(c);
      setLoadingCandles(false);
    });
    return () => {
      live = false;
    };
  }, [symbol]);

  const windowed = useMemo(
    () => (candles ? lastNCandles(candles, range.days) : []),
    [candles, range],
  );
  const series = useMemo(() => windowed.map((c) => c.close), [windowed]);
  const seriesDates = useMemo(() => windowed.map((c) => c.date), [windowed]);

  // A company you own but never swiped has no deck card — the research brief is
  // then the only analysis there is, and it's plenty.
  if (!card && report) {
    return (
      <>
        <Stack.Screen options={{ title: report.name }} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 64 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Logo uri={useMarket.getState().profiles[report.symbol]?.logo} symbol={report.symbol} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{report.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{report.symbol}</Text>
            </View>
            {quote ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.price}>{fmtMoney(quote.price)}</Text>
                <PctText value={quote.changePct} />
              </View>
            ) : null}
          </View>

          <Card style={{ marginTop: spacing.lg, borderColor: colors.purple + '55' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <VerdictChip verdict={report.verdict} size={13} />
              <Text style={styles.researchStamp}>
                Deep research · {report.generatedAt.slice(0, 10)}
              </Text>
            </View>
            <ConfidenceMeter value={report.confidence} compact />
          </Card>

          <SectionTitle>What they do</SectionTitle>
          <Card>
            <Paragraphs text={report.profileLong} />
          </Card>

          <SectionTitle>Their role from here</SectionTitle>
          <Card>
            <Paragraphs text={report.futureRole} />
          </Card>

          <TouchableOpacity
            style={styles.researchBtn}
            onPress={() => router.push(`/research/${report.symbol}`)}>
            <Text style={styles.researchBtnTxt}>Full research brief · evidence & sources</Text>
          </TouchableOpacity>
        </ScrollView>
      </>
    );
  }

  if (!card) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          title={symbol ?? 'Unknown'}
          body="No analysis stored for this company. It appears here after it shows up in a deck or your catalog."
        />
      </View>
    );
  }

  const price = quote?.price ?? card.price;
  const changePct = quote?.changePct ?? card.changePct;
  const scrubPrice = scrub !== null && series[scrub] !== undefined ? series[scrub] : null;
  const m = card.metrics;
  const analyst = card.signals.analyst;

  const stats: [string, string][] = [
    ['Market cap', card.profile.marketCapM ? fmtCompact(card.profile.marketCapM * 1e6) : '–'],
    ['P/E (TTM)', m.peTTM !== undefined ? m.peTTM.toFixed(1) : '–'],
    ['52w high', m.week52High !== undefined ? fmtMoney(m.week52High) : '–'],
    ['52w low', m.week52Low !== undefined ? fmtMoney(m.week52Low) : '–'],
    ['Gross margin', m.grossMarginTTM !== undefined ? m.grossMarginTTM.toFixed(0) + '%' : '–'],
    ['Revenue growth', m.revenueGrowthTTMYoy !== undefined ? fmtPct(m.revenueGrowthTTMYoy) : '–'],
    ['Dividend yield', m.dividendYield !== undefined ? m.dividendYield.toFixed(2) + '%' : '–'],
    ['Beta', m.beta !== undefined ? m.beta.toFixed(2) : '–'],
  ];

  return (
    <>
      <Stack.Screen options={{ title: card.profile.name }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 64 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Logo uri={card.profile.logo} symbol={card.symbol} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{card.profile.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {card.symbol} · {card.profile.sector}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.price}>{fmtMoney(scrubPrice ?? price)}</Text>
            {scrubPrice !== null ? (
              <Text style={{ color: colors.faint, fontSize: 12 }}>
                {seriesDates[scrub as number]}
              </Text>
            ) : (
              <PctText value={changePct} />
            )}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
          <Chip label={capTierLabel(card.capTier)} color={colors.gold} />
          {card.demo ? <Chip label="Demo data" color={colors.red} /> : null}
          <Chip
            label={card.thesis.generatedBy === 'llm' ? 'Claude analysis' : 'Template analysis'}
            color={card.thesis.generatedBy === 'llm' ? colors.purple : colors.faint}
          />
        </View>

        {report ? (
          <TouchableOpacity onPress={() => router.push(`/research/${card.symbol}`)}>
            <Card style={{ marginTop: spacing.lg, borderColor: colors.purple + '55' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <VerdictChip verdict={report.verdict} size={13} />
                <Text style={styles.researchStamp}>
                  Deep research · {report.generatedAt.slice(0, 10)}
                </Text>
                <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '700' }}>Read ›</Text>
              </View>
              <ConfidenceMeter value={report.confidence} compact />
            </Card>
          </TouchableOpacity>
        ) : null}

        {series.length > 1 || loadingCandles ? (
          <Card style={{ marginTop: spacing.lg }}>
            <InteractiveChart
              values={series}
              dates={seriesDates}
              width={width - spacing.lg * 4}
              height={170}
              loading={loadingCandles}
              onScrub={setScrub}
            />
            <View style={{ marginTop: spacing.sm }}>
              <RangePills
                ranges={RANGES.map((r) => r.label)}
                value={range.label}
                onChange={(label) => {
                  setScrub(null);
                  setRange(RANGES.find((r) => r.label === label) ?? RANGES[1]);
                }}
              />
            </View>
          </Card>
        ) : null}

        <SectionTitle>Why it was recommended</SectionTitle>
        <Card>
          <Text style={styles.whyTag}>{card.whyTag}</Text>
          <ScoreBar label="Long-term score" value={card.longTermScore} color={colors.blue} />
          <ScoreBar label="Momentum score" value={card.momentumScore} color={colors.purple} />
          {analyst ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Analyst consensus — {Math.round(analyst.buyRatio * 100)}% of {analyst.total} ratings
                are buy{analyst.delta > 0 ? ', trending up' : ''}
              </Text>
              <View style={styles.consensusTrack}>
                <View style={[styles.consensusFill, { width: `${analyst.buyRatio * 100}%` }]} />
              </View>
            </View>
          ) : null}
        </Card>

        <SectionTitle>What they do</SectionTitle>
        <Card>
          {/* The short blurb is the fallback; once a deep-research brief exists
              this becomes the full picture of the company. */}
          {report?.profileLong ? (
            <>
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
            </>
          ) : (
            <Text style={styles.body}>{card.thesis.blurb}</Text>
          )}
        </Card>

        {report ? (
          <>
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
          </>
        ) : null}

        <SectionTitle>Why you might buy</SectionTitle>
        <Card>
          {card.thesis.bullCase.map((line, i) => (
            <Text key={i} style={[styles.body, { marginBottom: 6 }]}>
              <Text style={{ color: colors.green }}>▲ </Text>
              {line}
            </Text>
          ))}
        </Card>

        <SectionTitle>Why you might not</SectionTitle>
        <Card>
          {card.thesis.bearCase.map((line, i) => (
            <Text key={i} style={[styles.body, { marginBottom: 6 }]}>
              <Text style={{ color: colors.red }}>▼ </Text>
              {line}
            </Text>
          ))}
        </Card>

        <SectionTitle>Key stats</SectionTitle>
        <Card>
          <View style={styles.statsGrid}>
            {stats.map(([label, value]) => (
              <View key={label} style={styles.statCell}>
                <Text style={{ color: colors.faint, fontSize: 11 }}>{label}</Text>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 2 }}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {card.signals.news?.topHeadlines.length ? (
          <>
            <SectionTitle>Source headlines</SectionTitle>
            <Card>
              {card.signals.news.topHeadlines.map((h, i) => (
                <TouchableOpacity
                  key={i}
                  style={{ paddingVertical: 8 }}
                  onPress={() => h.url && Linking.openURL(h.url)}>
                  <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>
                    {h.headline}
                  </Text>
                  <Text style={{ color: colors.blue, fontSize: 11, marginTop: 2 }}>
                    {h.source} ↗
                  </Text>
                </TouchableOpacity>
              ))}
            </Card>
          </>
        ) : null}

        {/* The Research tab runs a whole scope, not one company, so the old
            label promised something it could not deliver. */}
        <Button
          label={report ? 'Full research brief · evidence & sources' : 'Open deep research'}
          variant="secondary"
          tone={colors.purple}
          onPress={() => router.push(report ? `/research/${card.symbol}` : '/research')}
        />

        <Text style={styles.footer}>
          Analyzed {card.builtAt.slice(0, 10)} · educational analysis, not financial advice.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 19, fontWeight: '800' },
  price: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  whyTag: { color: colors.gold, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  rangeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  rangeBtnActive: { backgroundColor: colors.blue },
  researchStamp: { color: colors.muted, fontSize: 12, flex: 1 },
  subhead: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  researchBtn: {
    borderWidth: 1,
    borderColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  researchBtnTxt: { color: colors.purple, fontSize: 14, fontWeight: '700' },
  consensusTrack: { height: 8, borderRadius: 4, backgroundColor: colors.red + '55', overflow: 'hidden' },
  consensusFill: { height: 8, backgroundColor: colors.green },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statCell: { width: '50%', paddingVertical: 8 },
  footer: {
    color: colors.faint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
