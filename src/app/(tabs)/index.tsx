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
import {
  Donut,
  DonutLegend,
  HBar,
  InteractiveChart,
  RangePills,
  Sparkline,
} from '@/components/charts';
import { Heatmap, HeatmapLegend } from '@/components/Heatmap';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Logo,
  PctText,
  SectionTitle,
  StatusLine,
  Tappable,
} from '@/components/ui';
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
import { colors, plColor, spacing, tabular } from '@/theme';
import { Candle, Position } from '@/types';
import { fmtClock, fmtMoney, fmtMoneySigned, fmtPct } from '@/utils/format';

const POLL_MS = 3 * 60 * 1000;

const RANGES = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 } as const;
type RangeKey = keyof typeof RANGES;
const RANGE_LABEL: Record<RangeKey, string> = {
  '1M': 'past month',
  '3M': 'past 3 months',
  '6M': 'past 6 months',
  '1Y': 'past year',
};

/**
 * Keep the largest slices and roll the rest into "Other".
 *
 * Slicing to the top 8 and dropping the remainder made the legend divide by a
 * partial total, so eight holdings out of twelve summed to 100%.
 */
function capSlices(slices: { label: string; value: number }[], max = 8) {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, x) => s + x.value, 0);
  return rest > 0 ? [...head, { label: `Other (${sorted.length - max + 1})`, value: rest }] : head;
}

/** Turn a raw fetch rejection into something a person can act on. */
function friendlyError(raw: string): string {
  if (/failed to fetch|network|load failed/i.test(raw)) {
    return 'Could not reach the price service. Showing the last prices saved on this device.';
  }
  if (/rate|429|limit/i.test(raw)) {
    return 'The free data tier is rate-limiting requests. Prices will catch up shortly.';
  }
  if (/401|403|key/i.test(raw)) return 'The market-data key was rejected. Check it in Settings.';
  return 'Prices did not refresh. Showing the last ones saved on this device.';
}

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
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);

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
      const missing = symbols.filter((s) => !candles[s]);
      if (missing.length === 0) return;
      setLoadingCandles(true);
      for (const symbol of missing) {
        const c = await fetchDailyCandles(symbol);
        if (c && !cancelled) setCandles((prev) => ({ ...prev, [symbol]: c }));
      }
      if (!cancelled) setLoadingCandles(false);
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
  const range = useSettings((s) => s.homeRange);
  const homeMetric = useSettings((s) => s.homeMetric);
  const setSettings = useSettings((s) => s.set);

  // One row per symbol (lots aggregated), then ordered by the chosen sort.
  const holdings = useMemo(
    () => buildHoldings({ positions, quotes, profiles }),
    [positions, quotes, profiles],
  );
  const sortedHoldings = useMemo(() => sortHoldings(holdings, sortKey), [holdings, sortKey]);

  const heatCells = useMemo(() => {
    const total = holdings.reduce((s, h) => s + h.value, 0);
    return holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      value: h.value,
      weightPct: total > 0 ? (h.value / total) * 100 : 0,
      sector: profiles[h.symbol]?.sector ?? h.sector,
      changePct: h.dayChangePct,
      dayChange: h.dayChange,
      plPct: h.plPct,
      pl: h.pl,
      logo: profiles[h.symbol]?.logo,
    }));
  }, [holdings, profiles]);
  // Taller with more holdings so the smallest tiles stay legible, up to a cap.
  const heatHeight = Math.min(340, Math.max(190, 130 + heatCells.length * 22));

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
    return capSlices(
      [...bySector.entries()].map(([label, value]) => ({ label, value })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, quotes, profiles]);

  const weightSlices = useMemo(
    () => capSlices(holdings.map((h) => ({ label: h.symbol, value: h.value }))),
    [holdings],
  );

  // Portfolio value over the chosen range from daily closes. Positions only
  // contribute on dates after their buy date, so buys show up as steps.
  const { values: valueSeries, dates: valueDates } = useMemo(() => {
    const withData = positions.filter((p) => candles[p.symbol]?.length);
    if (withData.length === 0) return { values: [] as number[], dates: [] as string[] };
    const axis = candles[withData[0].symbol].slice(-RANGES[range]).map((c) => c.date);
    const closeMaps = new Map(
      withData.map((p) => [p.id, new Map(candles[p.symbol].map((c) => [c.date, c.close]))]),
    );
    const values = axis.map((date) => {
      let v = 0;
      for (const p of withData) {
        if (date < p.buyDate) continue;
        const close = closeMaps.get(p.id)?.get(date);
        if (close) v += p.shares * close;
      }
      return v;
    });
    return { values, dates: axis };
  }, [positions, candles, range]);

  // What the hero shows: live totals, or the point under the finger.
  const scrubbed = scrub !== null && valueSeries[scrub] !== undefined ? valueSeries[scrub] : null;
  const rangeBase = valueSeries[0] ?? 0;
  const heroValue = scrubbed ?? totalValue;
  const heroChange = scrubbed !== null ? scrubbed - rangeBase : dayChange;
  const heroChangePct =
    scrubbed !== null
      ? rangeBase > 0
        ? ((scrubbed - rangeBase) / rangeBase) * 100
        : 0
      : totalValue - dayChange > 0
        ? (dayChange / (totalValue - dayChange)) * 100
        : 0;
  const heroPeriod = scrubbed !== null ? RANGE_LABEL[range] : 'today';

  const lastUpdated = useMemo(
    () => Math.max(0, ...symbols.map((s) => quotes[s]?.updatedAt ?? 0)),
    [symbols, quotes],
  );

  const plMaxAbs = Math.max(1, ...holdings.map((h) => Math.abs(h.plPct)));

  if (positions.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          title="No positions yet"
          body="Track what you own: import a portfolio from a spreadsheet, add positions manually, or load the sample to explore."
        />
        <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
          <Button label="Import portfolio" onPress={() => router.push('/import-portfolio')} />
          <Button
            label="Add a position manually"
            variant="secondary"
            onPress={() => router.push('/add-position')}
          />
          <Button label="Load sample portfolio" variant="ghost" onPress={loadSample} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
      {/* The hero answers the three questions a returning user has, in the
          order they ask them: how much, how did it move, what shape. Hold the
          chart to read any day — the big numbers swap rather than a tooltip
          appearing under your finger. */}
      <Card>
        <Text style={styles.totalLabel}>
          {scrubbed !== null ? valueDates[scrub as number] : 'Total value'}
          {hasKey || scrubbed !== null ? '' : ' · demo prices'}
        </Text>
        <Text style={styles.totalValue}>{fmtMoney(heroValue)}</Text>
        <Text style={{ color: plColor(heroChange), fontSize: 15, fontWeight: '700', marginTop: 4 }}>
          {fmtMoneySigned(heroChange)} ({fmtPct(heroChangePct)}) {heroPeriod}
        </Text>
        {scrubbed === null ? (
          <Text style={styles.allTime}>
            {fmtMoneySigned(totalPl)} ({fmtPct(totalPlPct)}) all time
          </Text>
        ) : null}

        {/* When there is no history, say so in one line instead of holding
            230px of empty chart open above the holdings. */}
        {valueSeries.length > 1 || loadingCandles ? (
          <>
            <View style={{ marginTop: spacing.md }}>
              <InteractiveChart
                values={valueSeries}
                dates={valueDates}
                width={width - spacing.lg * 4}
                height={170}
                loading={loadingCandles && valueSeries.length === 0}
                onScrub={setScrub}
              />
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <RangePills
                ranges={['1M', '3M', '6M', '1Y'] as const}
                value={range}
                onChange={(r) => {
                  setScrub(null);
                  setSettings({ homeRange: r });
                }}
              />
            </View>
          </>
        ) : (
          <Text style={styles.noHistory}>
            No value history yet — the free price-history source is often blocked in the browser.
          </Text>
        )}

        {lastError ? (
          <StatusLine
            text={friendlyError(lastError)}
            tone="warn"
            onRetry={() => useMarket.getState().refreshQuotes(symbols, true)}
          />
        ) : lastUpdated > 0 ? (
          <StatusLine text={`Updated ${fmtClock(lastUpdated)}`} />
        ) : null}
      </Card>

      {/* Holdings come straight after the money. They used to sit a screen and
          a half down, behind the map, analytics, research and suggestions. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Holdings</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Tappable onPress={() => router.push('/import-portfolio')}>
            <Text style={{ color: colors.blue, fontWeight: '700' }}>Import</Text>
          </Tappable>
          <Tappable onPress={() => router.push('/add-position')}>
            <Text style={{ color: colors.blue, fontWeight: '700' }}>+ Add</Text>
          </Tappable>
        </View>
      </View>

      {/* Sort, plus the switch that says what the right-hand number means.
          It used to be an unlabelled percentage that was total P/L, directly
          under a market map colouring the same names by today's move. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, marginHorizontal: -spacing.lg }}
          contentContainerStyle={{
            gap: spacing.sm,
            paddingBottom: spacing.sm,
            paddingHorizontal: spacing.lg,
          }}>
          {SORT_OPTIONS.map((opt) => {
            const active = opt.key === sortKey;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setSettings({ sortKey: opt.key })}
                accessibilityRole="button"
                accessibilityState={active ? { selected: true } : {}}
                style={[styles.sortChip, active && styles.sortChipActive]}>
                <Text style={[styles.sortChipTxt, active && styles.sortChipTxtActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <TouchableOpacity
        onPress={() => setSettings({ homeMetric: homeMetric === 'today' ? 'total' : 'today' })}
        activeOpacity={0.7}
        accessibilityRole="button"
        style={styles.metricRow}>
        <Text style={styles.metricLabel}>
          Rows show {homeMetric === 'today' ? 'today’s move' : 'total gain / loss'}
        </Text>
        <Text style={styles.metricSwap}>
          Show {homeMetric === 'today' ? 'total' : 'today'} ⇄
        </Text>
      </TouchableOpacity>

      {sortedHoldings.map((h) => {
        const spark = (candles[h.symbol] ?? []).slice(-30).map((c) => c.close);
        const metricPct = homeMetric === 'today' ? h.dayChangePct : h.plPct;
        const metricAbs = homeMetric === 'today' ? h.dayChange : h.pl;
        return (
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
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>
                    {h.symbol}
                  </Text>
                  {/* Shares and price only. The sector used to be here too
                      and was always cut to one letter by the sparkline and
                      the value column; it lives on the detail page. */}
                  <Text style={{ color: colors.faint, fontSize: 12 }} numberOfLines={1}>
                    {h.shares} × {fmtMoney(h.price)}
                  </Text>
                </View>
                {/* Only reserve the 72px when there is a line to draw — an
                    empty placeholder was squeezing the sector to one letter. */}
                {spark.length > 1 ? <Sparkline values={spark} /> : null}
                <View style={{ alignItems: 'flex-end', minWidth: 84 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', ...tabular }}>
                    {fmtMoney(h.value, 0)}
                  </Text>
                  <PctText value={metricPct} size={12} />
                  <Text style={{ color: plColor(metricAbs), fontSize: 11, ...tabular }}>
                    {fmtMoneySigned(metricAbs, 0)}
                  </Text>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}

      {/* Market map: area = what the position is worth, colour = today's move.
          Thumbnail — the full-height version with sector grouping, a Total P/L
          lens and per-tile detail lives on /market-map. */}
      <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/market-map')}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.analyticsTitle}>Today&apos;s market map</Text>
              <Text style={styles.analyticsSub}>Size is what it is worth · tap to expand</Text>
            </View>
            <Text style={styles.analyticsArrow}>→</Text>
          </View>
          <View style={{ marginTop: spacing.md }} pointerEvents="none">
            <Heatmap cells={heatCells} width={width - spacing.lg * 4} height={heatHeight} />
          </View>
          <HeatmapLegend />
        </Card>
      </TouchableOpacity>

      {recs.length > 0 ? (
        <>
          <SectionTitle>Suggestions</SectionTitle>
          {recs.map((r) => (
            <TouchableOpacity
              key={r.id}
              activeOpacity={0.7}
              disabled={r.symbols.length === 0}
              onPress={() => r.symbols[0] && router.push(`/company/${r.symbols[0]}`)}>
              <Card
                style={{
                  marginBottom: spacing.sm,
                  borderLeftWidth: 3,
                  borderLeftColor: sevColor(r.severity),
                  opacity: r.symbols.length === 0 ? 0.6 : 1,
                }}>
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

      <TouchableOpacity onPress={() => router.push('/analytics')} activeOpacity={0.7}>
        <Card style={styles.analyticsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.analyticsTitle}>Portfolio analytics</Text>
            <Text style={styles.analyticsSub}>
              Risk, drawdown and diversification, measured against the S&amp;P 500
            </Text>
          </View>
          <Text style={styles.analyticsArrow}>→</Text>
        </Card>
      </TouchableOpacity>

      {/* Deep research: the sourced, evidence-backed layer over the quick
          suggestions above. */}
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

      {/* One bar per company, matching the list above — it used to iterate raw
          lots, so a symbol bought twice appeared twice. */}
      <SectionTitle>Profit & loss</SectionTitle>
      <Card>
        {sortedHoldings.map((h) => (
          <HBar
            key={h.symbol}
            label={h.symbol}
            value={h.plPct}
            maxAbs={plMaxAbs}
            suffix={fmtPct(h.plPct)}
          />
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  totalLabel: { color: colors.muted, fontSize: 13, ...tabular },
  totalValue: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 2, ...tabular },
  allTime: { color: colors.muted, fontSize: 13, marginTop: 2, ...tabular },
  cardTitle: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm },
  tapHint: { color: colors.blue, fontSize: 12, fontWeight: '600' },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: spacing.xs,
  },
  metricLabel: { color: colors.muted, fontSize: 12 },
  noHistory: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  metricSwap: { color: colors.blue, fontSize: 12, fontWeight: '700' },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 11,
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
