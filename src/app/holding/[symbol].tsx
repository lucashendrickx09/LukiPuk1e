import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
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
import { LineChart } from '@/components/charts';
import { ConfidenceMeter, VerdictChip } from '@/components/research';
import { Card, Chip, EmptyState, Logo, PctText, SectionTitle } from '@/components/ui';
import { buildHoldings } from '@/lib/holdings';
import { useMarket } from '@/store/market';
import { usePortfolio } from '@/store/portfolio';
import { useResearch } from '@/store/research';
import { colors, plColor, radius, spacing } from '@/theme';
import { Candle } from '@/types';
import { capTierLabel, fmtCompact, fmtMoney, fmtPct } from '@/utils/format';
import { capTierOf } from '@/utils/format';

const RANGES = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
] as const;

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
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [trade, setTrade] = useState<'buy' | 'sell' | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const holding = useMemo(
    () => buildHoldings({ positions, quotes, profiles }).find((h) => h.symbol === symbol),
    [positions, quotes, profiles, symbol],
  );

  useEffect(() => {
    if (symbol) {
      fetchDailyCandles(symbol).then(setCandles);
      useMarket.getState().refreshQuotes([symbol]);
      useMarket.getState().ensureProfiles([symbol]);
    }
  }, [symbol]);

  const series = useMemo(
    () => (candles ? lastNCandles(candles, range.days).map((c) => c.close) : []),
    [candles, range],
  );

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
      sellShares(holding.symbol, n);
      setTrade(null);
      // Selling everything leaves nothing to show.
      if (n >= holding.shares - 1e-9) router.back();
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

  const r1m = candles ? pctReturn(candles, 21) : null;
  const r3m = candles ? pctReturn(candles, 63) : null;
  const r1y = candles ? pctReturn(candles, 252) : null;

  const stats: [string, string, string?][] = [
    ['Shares', String(holding.shares)],
    ['Avg cost', fmtMoney(holding.avgCost)],
    ['Invested', fmtMoney(holding.cost, 0)],
    ['Market value', fmtMoney(holding.value, 0)],
    ['Today', fmtMoney(holding.dayChange, 2), 'day'],
    ['Total P/L', fmtMoney(holding.pl, 2), 'pl'],
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
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.price}>{fmtMoney(holding.price)}</Text>
            <PctText value={holding.dayChangePct} size={13} />
          </View>
        </View>

        {/* Position value + P/L */}
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.valueLabel}>Your position</Text>
          <Text style={styles.value}>{fmtMoney(holding.value)}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 4 }}>
            <Text style={{ color: plColor(holding.dayChange), fontSize: 14, fontWeight: '600' }}>
              {fmtMoney(holding.dayChange)} today
            </Text>
            <Text style={{ color: plColor(holding.pl), fontSize: 14, fontWeight: '600' }}>
              {fmtMoney(holding.pl)} ({fmtPct(holding.plPct)})
            </Text>
          </View>
          {holding.marketCapM ? (
            <View style={{ marginTop: spacing.md }}>
              <Chip label={capTierLabel(capTierOf(holding.marketCapM))} color={colors.gold} />
            </View>
          ) : null}
        </Card>

        {/* Price history */}
        <Card>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r.label}
                style={[styles.rangeBtn, range.label === r.label && styles.rangeActive]}
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
            height={180}
            labels={
              candles && series.length > 1
                ? { left: lastNCandles(candles, range.days)[0]?.date ?? '', right: 'today' }
                : undefined
            }
          />
          {series.length < 2 ? (
            <Text style={styles.note}>
              Price history isn’t loading here (the free history source is often blocked in the
              browser). It works in the native app build.
            </Text>
          ) : null}
        </Card>

        {/* Buy / Sell */}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.green }]} onPress={() => openTrade('buy')}>
            <Text style={styles.actionTxt}>Buy more</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.red }]} onPress={() => openTrade('sell')}>
            <Text style={styles.actionTxt}>Sell</Text>
          </TouchableOpacity>
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
          <TouchableOpacity style={styles.researchBtn} onPress={() => router.push('/research')}>
            <Text style={styles.researchBtnTxt}>Deep research this position</Text>
          </TouchableOpacity>
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
        <View style={styles.sheetBg}>
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
              <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setTrade(null)}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetBtn, { backgroundColor: trade === 'buy' ? colors.green : colors.red }]}
                onPress={submitTrade}>
                <Text style={{ color: '#08111E', fontWeight: '800' }}>
                  {trade === 'buy' ? 'Add shares' : 'Sell shares'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
