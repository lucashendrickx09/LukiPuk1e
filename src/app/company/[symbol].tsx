import { Stack, useLocalSearchParams } from 'expo-router';
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
import { LineChart } from '@/components/charts';
import { Card, Chip, EmptyState, Logo, PctText, ScoreBar, SectionTitle } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { useDeck } from '@/store/deck';
import { useMarket } from '@/store/market';
import { colors, spacing } from '@/theme';
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
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);

  const card = catalogEntry?.card ?? deckCard;

  useEffect(() => {
    if (symbol) fetchDailyCandles(symbol).then(setCandles);
  }, [symbol]);

  const series = useMemo(
    () => (candles ? lastNCandles(candles, range.days).map((c) => c.close) : []),
    [candles, range],
  );

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
            <Text style={styles.price}>{fmtMoney(price)}</Text>
            <PctText value={changePct} />
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

        <Card style={{ marginTop: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r.label}
                style={[styles.rangeBtn, range.label === r.label && styles.rangeBtnActive]}
                onPress={() => setRange(r)}>
                <Text
                  style={{
                    color: range.label === r.label ? '#08111E' : colors.muted,
                    fontSize: 12,
                    fontWeight: '700',
                  }}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <LineChart
            values={series}
            width={width - spacing.lg * 4}
            height={170}
            labels={
              candles && series.length > 1
                ? {
                    left: lastNCandles(candles, range.days)[0]?.date ?? '',
                    right: 'today',
                  }
                : undefined
            }
          />
        </Card>

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
          <Text style={styles.body}>{card.thesis.blurb}</Text>
        </Card>

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
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  rangeBtnActive: { backgroundColor: colors.blue },
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
