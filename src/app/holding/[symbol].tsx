import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { fetchDailyCandles, lastNCandles, pctReturn } from '@/api/stooq';
import { showDialog } from '@/components/Dialog';
import { InteractiveChart, RangePills } from '@/components/charts';
import { ConfidenceMeter, VerdictChip } from '@/components/research';
import { Button, Card, Chip, EmptyState, Logo, PctText, SectionTitle } from '@/components/ui';
import { buildHoldings } from '@/lib/holdings';
import { useMarket } from '@/store/market';
import { usePortfolio } from '@/store/portfolio';
import { useResearch } from '@/store/research';
import { colors, plColor, radius, spacing, tabular } from '@/theme';
import { Candle } from '@/types';
import { capTierLabel, fmtCompact, fmtMoney, fmtMoneySigned, fmtPct } from '@/utils/format';
import { capTierOf } from '@/utils/format';

const RANGE_DAYS = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 } as const;
type RangeKey = keyof typeof RANGE_DAYS;
const RANGE_KEYS = ['1M', '3M', '6M', '1Y'] as const;
const RANGE_WORD: Record<RangeKey, string> = {
  '1M': 'past month',
  '3M': 'past 3 months',
  '6M': 'past 6 months',
  '1Y': 'past year',
};

export default function HoldingDetailScreen() {
  const { width } = useWindowDimensions();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const positions = usePortfolio((s) => s.positions);
  const quotes = useMarket((s) => s.quotes);
  const profiles = useMarket((s) => s.profiles);
  const buyShares = usePortfolio((s) => s.buyShares);
  const sellShares = usePortfolio((s) => s.sellShares);
  const removeSymbol = usePortfolio((s) => s.removeSymbol);
  const report = useResearch((s) => (symbol ? s.reports[symbol] : undefined));

  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loadingCandles, setLoadingCandles] = useState(true);
  const [range, setRange] = useState<RangeKey>('3M');
  const [scrub, setScrub] = useState<number | null>(null);
  const [trade, setTrade] = useState<'buy' | 'sell' | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const holding = useMemo(
    () => buildHoldings({ positions, quotes, profiles }).find((h) => h.symbol === symbol),
    [positions, quotes, profiles, symbol],
  );

  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setLoadingCandles(true);
    fetchDailyCandles(symbol).then((c) => {
      if (!live) return;
      setCandles(c);
      setLoadingCandles(false);
    });
    useMarket.getState().refreshQuotes([symbol]);
    useMarket.getState().ensureProfiles([symbol]);
    return () => {
      live = false;
    };
  }, [symbol]);

  const windowed = useMemo(
    () => (candles ? lastNCandles(candles, RANGE_DAYS[range]) : []),
    [candles, range],
  );
  const series = useMemo(() => windowed.map((c) => c.close), [windowed]);
  const seriesDates = useMemo(() => windowed.map((c) => c.date), [windowed]);

  if (!holding) {
    return (
      <>
        <Stack.Screen options={{ title: symbol ?? 'Holding' }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState title="Not in your portfolio" body="This position may have been sold or removed." />
        </View>
      </>
    );
  }

  const openTrade = (mode: 'buy' | 'sell') => {
    setTrade(mode);
    setQty('');
    setPrice(mode === 'buy' ? holding.price.toFixed(2) : '');
    setErr(null);
  };

  const submitTrade = () => {
    const n = parseFloat(qty);
    if (!isFinite(n) || n <= 0) return setErr('Enter a share count greater than zero.');
    if (trade === 'sell') {
      if (n > holding.shares + 1e-9) return setErr(`You only hold ${holding.shares} shares.`);
      const all = n >= holding.shares - 1e-9;
      const proceeds = n * holding.price;
      // Selling rewrites or deletes lots oldest-first and cannot be undone,
      // so it gets the same confirmation that removing the holding does.
      showDialog(
        all ? `Sell all ${holding.symbol}?` : `Sell ${n} ${holding.symbol}?`,
        all
          ? `This closes the position: ${holding.shares} shares at about ${fmtMoney(holding.price)}, roughly ${fmtMoney(proceeds)}. The holding and its purchase history leave your portfolio.`
          : `This sells ${n} of your ${holding.shares} shares at about ${fmtMoney(holding.price)}, roughly ${fmtMoney(proceeds)}. The oldest lots are sold first and cannot be restored.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: all ? 'Sell all' : 'Sell',
            style: 'destructive',
            onPress: () => {
              sellShares(holding.symbol, n);
              setTrade(null);
              if (all) router.back();
            },
          },
        ],
      );
      return;
    }
    const p = parseFloat(price);
    if (!isFinite(p) || p <= 0) return setErr('Enter the price you paid per share.');
    buyShares({ symbol: holding.symbol, name: holding.name, shares: n, price: p });
    setTrade(null);
  };

  const confirmRemove = () =>
    showDialog(
      `Remove ${holding.symbol}`,
      'This deletes the holding and its history from your portfolio. It does not record a sale.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeSymbol(holding.symbol);
            router.back();
          },
        },
      ],
    );

  // While scrubbing the header shows that day's close and its move from the
  // start of the visible range; otherwise the live price and today's move.
  const scrubPrice = scrub !== null && series[scrub] !== undefined ? series[scrub] : null;
  const headerPct =
    scrubPrice !== null && series[0]
      ? ((scrubPrice - series[0]) / series[0]) * 100
      : holding.dayChangePct;

  const r1m = candles ? pctReturn(candles, 21) : null;
  const r3m = candles ? pctReturn(candles, 63) : null;
  const r1y = candles ? pctReturn(candles, 252) : null;

  const stats: [string, string, string?][] = [
    ['Shares', String(holding.shares)],
    ['Avg cost', fmtMoney(holding.avgCost)],
    ['Invested', fmtMoney(holding.cost, 0)],
    ['Market value', fmtMoney(holding.value, 0)],
    ['Today', fmtMoneySigned(holding.dayChange, 2), 'day'],
    ['Total P/L', fmtMoneySigned(holding.pl, 2), 'pl'],
    ['1M', r1m !== null ? fmtPct(r1m) : '–'],
    ['3M', r3m !== null ? fmtPct(r3m) : '–'],
    ['1Y', r1y !== null ? fmtPct(r1y) : '–'],
    ['Market cap', holding.marketCapM ? fmtCompact(holding.marketCapM * 1e6) : '–'],
  ];

  return (
    <>
      <Stack.Screen options={{ title: holding.symbol }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 56 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Logo uri={profiles[holding.symbol]?.logo} symbol={holding.symbol} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{holding.name}</Text>
            <Text style={styles.sub}>
              {holding.symbol} · {holding.sector}
            </Text>
          </View>
        </View>

        {/* Price, then the chart that reads it. Holding the chart swaps these
            two lines rather than putting a tooltip under your finger. */}
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.valueLabel}>
            {scrubPrice !== null ? seriesDates[scrub as number] : 'Price'}
          </Text>
          <Text style={styles.value}>{fmtMoney(scrubPrice ?? holding.price)}</Text>
          <Text style={{ color: plColor(headerPct), fontSize: 15, fontWeight: '700', marginTop: 2 }}>
            {fmtPct(headerPct)} {scrubPrice !== null ? RANGE_WORD[range] : 'today'}
          </Text>

          {series.length > 1 || loadingCandles ? (
            <>
              <View style={{ marginTop: spacing.md }}>
                <InteractiveChart
                  values={series}
                  dates={seriesDates}
                  width={width - spacing.lg * 4}
                  height={190}
                  loading={loadingCandles}
                  onScrub={setScrub}
                />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <RangePills
                  ranges={RANGE_KEYS}
                  value={range}
                  onChange={(r) => {
                    setScrub(null);
                    setRange(r);
                  }}
                />
              </View>
            </>
          ) : (
            <Text style={styles.note}>
              No price history for {holding.symbol} yet. It is published each weekday evening — a
              ticker added since the last run appears after the next one.
            </Text>
          )}
        </Card>

        {/* Your position — the numbers that are only true for you. */}
        <Card>
          <Text style={styles.valueLabel}>Your position</Text>
          <Text style={styles.value}>{fmtMoney(holding.value)}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 4 }}>
            <Text style={{ color: plColor(holding.dayChange), fontSize: 14, fontWeight: '600', ...tabular }}>
              {fmtMoneySigned(holding.dayChange)} today
            </Text>
            <Text style={{ color: plColor(holding.pl), fontSize: 14, fontWeight: '600', ...tabular }}>
              {fmtMoneySigned(holding.pl)} ({fmtPct(holding.plPct)})
            </Text>
          </View>
          {holding.marketCapM ? (
            <View style={{ marginTop: spacing.md }}>
              <Chip label={capTierLabel(capTierOf(holding.marketCapM))} color={colors.gold} />
            </View>
          ) : null}
        </Card>

        {/* Buy / Sell */}
        <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm }}>
          <Button
            label="Buy more"
            tone={colors.green}
            onPress={() => openTrade('buy')}
            style={{ flex: 1 }}
          />
          <Button
            label="Sell"
            variant="secondary"
            tone={colors.red}
            onPress={() => openTrade('sell')}
            style={{ flex: 1 }}
          />
        </View>

        {/* Deep research verdict, when this position has been researched. */}
        {report ? (
          <TouchableOpacity onPress={() => router.push(`/research/${holding.symbol}`)}>
            <Card style={{ marginTop: spacing.md, borderColor: colors.purple + '55' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <VerdictChip verdict={report.verdict} size={13} />
                <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
                  Does it still earn its place? · {report.generatedAt.slice(0, 10)}
                </Text>
                <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '700' }}>Read ›</Text>
              </View>
              <ConfidenceMeter value={report.confidence} compact />
            </Card>
          </TouchableOpacity>
        ) : (
          <Button
            label="Deep research this position"
            variant="secondary"
            tone={colors.purple}
            onPress={() => router.push('/research')}
            style={{ marginTop: spacing.md }}
          />
        )}

        <SectionTitle>Stats</SectionTitle>
        <Card>
          <View style={styles.grid}>
            {stats.map(([label, val, kind]) => (
              <View key={label} style={styles.cell}>
                <Text style={styles.cellLabel}>{label}</Text>
                <Text
                  style={[
                    styles.cellValue,
                    kind === 'pl' && { color: plColor(holding.pl) },
                    kind === 'day' && { color: plColor(holding.dayChange) },
                  ]}>
                  {val}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        <SectionTitle>Purchase history</SectionTitle>
        <Card>
          {holding.lots.map((lot) => {
            const lotPl = ((holding.price - lot.buyPrice) / lot.buyPrice) * 100;
            return (
              <View key={lot.id} style={styles.lotRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lotMain}>
                    {lot.shares} @ {fmtMoney(lot.buyPrice)}
                  </Text>
                  <Text style={styles.lotSub}>{lot.buyDate}</Text>
                </View>
                <PctText value={lotPl} size={13} />
              </View>
            );
          })}
        </Card>

        <TouchableOpacity onPress={confirmRemove} style={styles.remove}>
          <Text style={styles.removeTxt}>Remove {holding.symbol} from portfolio</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Trade sheet */}
      <Modal visible={trade !== null} transparent animationType="slide" onRequestClose={() => setTrade(null)}>
        {/* Without this the sheet sits exactly where the keyboard appears, so
            the amount field, the error line and both buttons are covered. */}
        <KeyboardAvoidingView
          style={styles.sheetBg}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              {trade === 'buy' ? `Buy more ${holding.symbol}` : `Sell ${holding.symbol}`}
            </Text>
            <Text style={styles.sheetSub}>
              {trade === 'buy'
                ? `Adds to your position. Current price ${fmtMoney(holding.price)}.`
                : `You hold ${holding.shares} shares at an average cost of ${fmtMoney(holding.avgCost)}.`}
            </Text>

            <Text style={styles.fieldLabel}>Shares</Text>
            <TextInput
              style={styles.input}
              value={qty}
              onChangeText={setQty}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
              autoFocus
            />
            {trade === 'buy' ? (
              <>
                <Text style={styles.fieldLabel}>Price paid per share</Text>
                <TextInput
                  style={styles.input}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.faint}
                />
              </>
            ) : (
              <TouchableOpacity onPress={() => setQty(String(holding.shares))}>
                <Text style={styles.sellAll}>Sell all {holding.shares} shares</Text>
              </TouchableOpacity>
            )}
            {err ? <Text style={styles.err}>{err}</Text> : null}

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
              <Button
                label="Cancel"
                variant="ghost"
                tone={colors.muted}
                onPress={() => setTrade(null)}
                style={{ flex: 1 }}
              />
              <Button
                label={trade === 'buy' ? 'Add shares' : 'Sell shares'}
                tone={trade === 'buy' ? colors.green : colors.red}
                onPress={submitTrade}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 19, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  price: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  valueLabel: { color: colors.muted, fontSize: 13 },
  value: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },
  rangeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  rangeActive: { backgroundColor: colors.blue },
  note: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  action: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm },
  actionTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
  researchBtn: {
    borderWidth: 1,
    borderColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  researchBtnTxt: { color: colors.purple, fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingVertical: 8 },
  cellLabel: { color: colors.faint, fontSize: 11 },
  cellValue: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lotMain: { color: colors.text, fontSize: 14, fontWeight: '600' },
  lotSub: { color: colors.faint, fontSize: 12, marginTop: 2 },
  remove: { alignItems: 'center', paddingVertical: spacing.lg },
  removeTxt: { color: colors.red, fontSize: 14, fontWeight: '600' },
  sheetBg: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    paddingBottom: spacing.xl * 2,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.lg },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sheetSub: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  fieldLabel: { color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  sellAll: { color: colors.blue, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  err: { color: colors.red, fontSize: 13, marginTop: spacing.md },
  sheetBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
});
