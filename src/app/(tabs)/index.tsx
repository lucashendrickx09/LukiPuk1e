import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { fetchDailyCandles } from '@/api/stooq';
import { showDialog } from '@/components/Dialog';
import { Donut, DonutLegend, HBar, LineChart, Sparkline } from '@/components/charts';
import { Card, Chip, EmptyState, Logo, PctText, SectionTitle } from '@/components/ui';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';
import { buildRecommendations, recKindLabel, Recommendation } from '@/engine/recommend';
import { buildHoldings, SORT_OPTIONS, sortHoldings } from '@/lib/holdings';
import { useAnalytics } from '@/store/analytics';
import { useCatalog } from '@/store/catalog';
import { useMarket } from '@/store/market';
import { useNotifications } from '@/store/notifications';
import { usePortfolio } from '@/store/portfolio';
import { useResearch } from '@/store/research';
import { useSettings } from '@/store/settings';
import { colors, plColor, spacing } from '@/theme';
import { Candle, Position } from '@/types';
import { fmtMoney, fmtPct } from '@/utils/format';

const POLL_MS = 3 * 60 * 1000;

const sevColor = (s: Recommendation['severity']) =>
  s === 'high' ? colors.red : s === 'medium' ? colors.gold : colors.blue;

export default function PortfolioScreen() {
  const { width } = useWindowDimensions();
  const positions = usePortfolio((s) => s.positions);
  const removeSymbol = usePortfolio((s) => s.removeSymbol);
  const loadSample = usePortfolio((s) => s.loadSamplePortfolio);
  const quotes = useMarket((s) => s.quotes);
  const profiles = useMarket((s) => s.profiles);
  const lastError = useMarket((s) => s.lastError);
  const latestRun = useResearch((s) => s.runs[0]);
  const hasKey = useSettings((s) => s.hasFinnhubKey);
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});

  const symbols = useMemo(() => [...new Set(positions.map((p) => p.symbol))], [positions]);

  // Live-ish prices: refresh on focus, then every few minutes while focused.
  useFocusEffect(
    useCallback(() => {
      if (symbols.length === 0) return;
      const { refreshQuotes, ensureProfiles } = useMarket.getState();
      refreshQuotes(symbols);
      ensureProfiles(symbols);
      const id = setInterval(() => refreshQuotes(symbols), POLL_MS);
      return () => clearInterval(id);
    }, [symbols]),
  );

  // On focus: generate today's notifications and pre-warm analytics in the
  // background so the Analytics screen opens instantly (both are staleness-throttled).
  useFocusEffect(
    useCallback(() => {
      useNotifications.getState().scan().then(() => {
        // Push anything generated today that the OS hasn't shown yet (e.g. the
        // user granted permission after the alerts were created).
        useNotifications.getState().deliverPending();
      });
      useAnalytics.getState().compute();
    }, []),
  );

  // Daily history for sparklines + the portfolio value line (cached per day).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const symbol of symbols) {
        if (candles[symbol]) continue;
        const c = await fetchDailyCandles(symbol);
        if (c && !cancelled) setCandles((prev) => ({ ...prev, [symbol]: c }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  const priceOf = (p: Position) => quotes[p.symbol]?.price ?? p.buyPrice;
  const totalValue = positions.reduce((s, p) => s + p.shares * priceOf(p), 0);
  const totalCost = positions.reduce((s, p) => s + p.shares * p.buyPrice, 0);
  const totalPl = totalValue - totalCost;
  const totalPlPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;
  const dayChange = positions.reduce((s, p) => s + p.shares * (quotes[p.symbol]?.change ?? 0), 0);

  const sectorOf = (symbol: string) =>
    profiles[symbol]?.sector ?? UNIVERSE_BY_SYMBOL.get(symbol)?.fallbackSector ?? 'Other';

  const sortKey = useSettings((s) => s.sortKey);
  const setSettings = useSettings((s) => s.set);

  // One row per symbol (lots aggregated), then ordered by the chosen sort.
  const holdings = useMemo(
    () => buildHoldings({ positions, quotes, profiles }),
    [positions, quotes, profiles],
  );
  const sortedHoldings = useMemo(() => sortHoldings(holdings, sortKey), [holdings, sortKey]);

  const catalogEntries = useCatalog((s) => s.entries);
  const recs = useMemo(
    () => buildRecommendations({ positions, priceOf, sectorOf, catalog: catalogEntries }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, quotes, profiles, catalogEntries],
  );

  const sectorSlices = useMemo(() => {
    const bySector = new Map<string, number>();
    for (const p of positions) {
      const sector = sectorOf(p.symbol);
      bySector.set(sector, (bySector.get(sector) ?? 0) + p.shares * priceOf(p));
    }
    return [...bySector.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, quotes, profiles]);

  const weightSlices = useMemo(
    () =>
      positions
        .map((p) => ({ label: p.symbol, value: p.shares * priceOf(p) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, quotes],
  );

  // Portfolio value over the last ~3 months from daily closes. Positions only
  // contribute on dates after their buy date, so buys show up as steps.
  const valueSeries = useMemo(() => {
    const withData = positions.filter((p) => candles[p.symbol]?.length);
    if (withData.length === 0) return [];
    const axis = candles[withData[0].symbol].slice(-63).map((c) => c.date);
    const closeMaps = new Map(
      withData.map((p) => [p.id, new Map(candles[p.symbol].map((c) => [c.date, c.close]))]),
    );
    return axis.map((date) => {
      let v = 0;
      for (const p of withData) {
        if (date < p.buyDate) continue;
        const close = closeMaps.get(p.id)?.get(date);
        if (close) v += p.shares * close;
      }
      return v;
    });
  }, [positions, candles]);

  const plMaxAbs = Math.max(
    1,
    ...positions.map((p) => Math.abs(((priceOf(p) - p.buyPrice) / p.buyPrice) * 100)),
  );

  if (positions.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          title="No positions yet"
          body="Track what you own: import a portfolio from a spreadsheet, add positions manually, or load the sample to explore."
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/import-portfolio')}>
          <Text style={styles.primaryBtnTxt}>Import portfolio</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/add-position')}>
          <Text style={styles.secondaryBtnTxt}>Add a position manually</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={loadSample}>
          <Text style={styles.secondaryBtnTxt}>Load sample portfolio</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
      <Card>
        <Text style={styles.totalLabel}>Total value {hasKey ? '' : '· demo prices'}</Text>
        <Text style={styles.totalValue}>{fmtMoney(totalValue)}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 6 }}>
          <Text style={{ color: plColor(dayChange), fontSize: 14, fontWeight: '600' }}>
            {fmtMoney(dayChange)} today
          </Text>
          <Text style={{ color: plColor(totalPl), fontSize: 14, fontWeight: '600' }}>
            {fmtMoney(totalPl)} ({fmtPct(totalPlPct)}) all time
          </Text>
        </View>
        {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
      </Card>

      <TouchableOpacity onPress={() => router.push('/analytics')} activeOpacity={0.7}>
        <Card style={styles.analyticsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.analyticsTitle}>Portfolio analytics</Text>
            <Text style={styles.analyticsSub}>
              Sharpe, Sortino, Beta, Alpha, drawdown, diversification & more
            </Text>
          </View>
          <Text style={styles.analyticsArrow}>→</Text>
        </Card>
      </TouchableOpacity>

      {/* Deep research: the sourced, evidence-backed layer over the quick
          suggestions below. Surfaced here because it acts on this screen. */}
      <TouchableOpacity onPress={() => router.push('/research')} activeOpacity={0.8}>
        <Card style={{ borderColor: colors.purple + '55' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.analyticsTitle}>Deep research</Text>
              <Text style={styles.researchSub}>
                {latestRun
                  ? latestRun.actions.length > 0
                    ? latestRun.actions[0].headline
                    : 'Researched — nothing worth changing right now.'
                  : 'Read filings, bank research, institutional positioning and congressional trades for every company you own or watch.'}
              </Text>
            </View>
            <Text style={styles.analyticsArrow}>→</Text>
          </View>
          {latestRun && latestRun.actions.length > 1 ? (
            <Text style={styles.recNote}>
              +{latestRun.actions.length - 1} more suggested move
              {latestRun.actions.length === 2 ? '' : 's'}
            </Text>
          ) : null}
        </Card>
      </TouchableOpacity>

      {recs.length > 0 ? (
        <>
          <SectionTitle>Suggestions</SectionTitle>
          {recs.map((r) => (
            <TouchableOpacity
              key={r.id}
              disabled={r.symbols.length === 0}
              onPress={() => r.symbols[0] && router.push(`/company/${r.symbols[0]}`)}>
              <Card style={{ marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: sevColor(r.severity) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Chip label={recKindLabel(r.kind)} color={sevColor(r.severity)} />
                  <Text style={styles.recTitle}>{r.title}</Text>
                </View>
                <Text style={styles.recDetail}>{r.detail}</Text>
              </Card>
            </TouchableOpacity>
          ))}
          <Text style={styles.recNote}>
            Educational suggestions from your holdings + catalog — not financial advice.
          </Text>
        </>
      ) : null}

      {valueSeries.length > 1 ? (
        <TouchableOpacity onPress={() => router.push('/analytics')} activeOpacity={0.8}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardTitle}>Value · last 3 months</Text>
              <Text style={styles.tapHint}>Analytics →</Text>
            </View>
            <LineChart values={valueSeries} width={width - spacing.lg * 4} height={150} />
          </Card>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Holdings</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <TouchableOpacity onPress={() => router.push('/import-portfolio')}>
            <Text style={{ color: colors.blue, fontWeight: '700' }}>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/add-position')}>
            <Text style={{ color: colors.blue, fontWeight: '700' }}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sort by */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        {SORT_OPTIONS.map((opt) => {
          const active = opt.key === sortKey;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setSettings({ sortKey: opt.key })}
              style={[styles.sortChip, active && styles.sortChipActive]}>
              <Text style={[styles.sortChipTxt, active && styles.sortChipTxtActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {sortedHoldings.map((h) => (
        <TouchableOpacity
          key={h.symbol}
          activeOpacity={0.7}
          onPress={() => router.push(`/holding/${h.symbol}`)}
          onLongPress={() =>
            showDialog(h.symbol, `Remove ${h.symbol} from your portfolio?`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => removeSymbol(h.symbol),
              },
            ])
          }>
          <Card style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Logo uri={profiles[h.symbol]?.logo} symbol={h.symbol} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>
                  {h.symbol}
                </Text>
                <Text style={{ color: colors.faint, fontSize: 12 }} numberOfLines={1}>
                  {h.shares} × {fmtMoney(h.price)} · {h.sector}
                </Text>
              </View>
              <Sparkline values={(candles[h.symbol] ?? []).slice(-30).map((c) => c.close)} />
              <View style={{ alignItems: 'flex-end', minWidth: 76 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {fmtMoney(h.value, 0)}
                </Text>
                <PctText value={h.plPct} size={12} />
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      <SectionTitle>Allocation by industry</SectionTitle>
      <TouchableOpacity onPress={() => router.push('/analytics')} activeOpacity={0.8}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <Donut slices={sectorSlices} />
            <DonutLegend slices={sectorSlices} />
          </View>
        </Card>
      </TouchableOpacity>

      <SectionTitle>Allocation by holding</SectionTitle>
      <TouchableOpacity onPress={() => router.push('/analytics')} activeOpacity={0.8}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <Donut slices={weightSlices} />
            <DonutLegend slices={weightSlices} />
          </View>
        </Card>
      </TouchableOpacity>

      <SectionTitle>Profit & loss</SectionTitle>
      <Card>
        {positions.map((p) => {
          const pl = ((priceOf(p) - p.buyPrice) / p.buyPrice) * 100;
          return (
            <HBar key={p.id} label={p.symbol} value={pl} maxAbs={plMaxAbs} suffix={fmtPct(pl)} />
          );
        })}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  totalLabel: { color: colors.muted, fontSize: 13 },
  totalValue: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  cardTitle: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm },
  tapHint: { color: colors.blue, fontSize: 12, fontWeight: '600' },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  sortChipTxt: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  sortChipTxtActive: { color: '#08111E' },
  analyticsRow: { flexDirection: 'row', alignItems: 'center' },
  analyticsTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  researchSub: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  analyticsSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  analyticsArrow: { color: colors.blue, fontSize: 20, fontWeight: '700', marginLeft: spacing.md },
  recTitle: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  recDetail: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  recNote: { color: colors.faint, fontSize: 11, marginBottom: spacing.md },
  error: { color: colors.red, fontSize: 12, marginTop: 8 },
  primaryBtn: {
    backgroundColor: colors.blue,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  primaryBtnTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
  secondaryBtn: { padding: 14, alignItems: 'center', marginTop: spacing.sm },
  secondaryBtnTxt: { color: colors.blue, fontWeight: '600', fontSize: 14 },
});
