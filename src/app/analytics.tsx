import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useWindowDimensions } from 'react-native';
import {
  BarChart,
  CompareBars,
  CorrelationHeatmap,
  Donut,
  DonutLegend,
  DrawdownChart,
  HBar,
  LineChart,
} from '@/components/charts';
import { Button, Card, EmptyState, SectionTitle } from '@/components/ui';
import { useAnalytics } from '@/store/analytics';
import { usePortfolio } from '@/store/portfolio';
import { colors, spacing } from '@/theme';
import { fmtMoney, fmtPct } from '@/utils/format';

// Plain-English explanation for each metric (shown in the tap-through sheet).
const EXPL: Record<string, string> = {
  Sharpe:
    'Excess return per unit of total risk (volatility), versus a risk-free rate. It tells you whether your returns came from smart strategy or reckless risk-taking. Above 1.0 is good; above 2.0 is excellent.',
  Sortino:
    'Like Sharpe, but it only penalises downside volatility (losses), ignoring big upside swings. If you don’t mind wild moves to the upside, this is the fairer measure of your downside protection.',
  Volatility:
    'Annualised standard deviation of your daily returns — how much your portfolio bounces around. Higher means a wilder ride.',
  'Max drawdown':
    'The largest peak-to-trough drop over the period — the worst-case historical pain. It stress-tests how far your portfolio fell from a high before recovering.',
  Beta:
    'Your systematic market risk. 1.0 moves in sync with the market; 1.3 swings ~30% more than the market; 0.7 cushions you in a crash but lags in a rally. Below 1.0 is more defensive.',
  Alpha:
    'The value your specific choices added beyond what Beta predicted. If the market rose 10%, Beta predicted 10%, but you made 12%, your Alpha is +2%. Zero or negative Alpha means a cheap index fund would have served you better.',
  'R²':
    'How much of your portfolio’s movement is explained by the benchmark (0–100%). 95% means you’ve essentially built an index fund; 50% means your portfolio marches to its own beat.',
  'Information ratio':
    'How consistently you beat the benchmark per unit of tracking error. A high IR is evidence of real, repeatable skill rather than one lucky month.',
  'Effective holdings':
    'Your true diversification (1 / Herfindahl index). Ten equal positions = 10; if one position dominates, this drops well below your headline count.',
  'Top position':
    'The share of your portfolio in your single largest holding. Heavy concentration means one stock drives your outcome.',
  'Sector concentration':
    'The share of your portfolio in your largest sector. High concentration means a sector shock hits you hard.',
  Correlation:
    'How holdings move together, from -1 (opposite) to +1 (identical). If everything is +0.8 or higher, you’re not diversified — you own different versions of the same risk.',
  'Weighted P/E':
    'Your portfolio’s value-weighted price-to-earnings ratio — a rough gauge of how expensively your holdings are priced.',
  'Dividend yield':
    'The value-weighted annual dividend income your holdings pay, as a percent of value.',
};

function ratio(n: number): string {
  return isFinite(n) ? n.toFixed(2) : '–';
}

export default function AnalyticsScreen() {
  const { width } = useWindowDimensions();
  const chartW = width - spacing.lg * 4;
  const positions = usePortfolio((s) => s.positions);
  const result = useAnalytics((s) => s.result);
  const computing = useAnalytics((s) => s.computing);
  const status = useAnalytics((s) => s.status);
  const error = useAnalytics((s) => s.error);
  const [sheet, setSheet] = useState<{ title: string; value: string; body: string } | null>(null);

  // Shows the cached result instantly; refreshes in the background if stale.
  useEffect(() => {
    useAnalytics.getState().compute();
  }, []);

  const Row = ({
    label,
    value,
    good,
    explKey,
  }: {
    label: string;
    value: string;
    good?: boolean | null;
    explKey?: string;
  }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() =>
        setSheet({ title: label, value, body: EXPL[explKey ?? label] ?? '' })
      }>
      <Text style={styles.rowLabel}>
        {label} <Text style={styles.info}>{'ⓘ'}</Text>
      </Text>
      <Text
        style={[
          styles.rowValue,
          good === true && { color: colors.green },
          good === false && { color: colors.red },
        ]}>
        {value}
      </Text>
    </TouchableOpacity>
  );

  if (positions.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: 'Analytics' }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState title="Nothing to analyse yet" body="Add or import holdings, then come back for the full risk and diversification breakdown." />
        </View>
      </>
    );
  }

  // A failed run used to leave this screen spinning forever with nothing to
  // retry, because the catch cleared `computing` but never set `result`.
  if (!result && error && !computing) {
    return (
      <>
        <Stack.Screen options={{ title: 'Analytics' }} />
        <View style={styles.center}>
          <EmptyState
            title="Could not compute analytics"
            body={`${error}\n\nThis needs price history for each holding, which the free source often blocks in the browser.`}
          />
          <Button label="Try again" onPress={() => useAnalytics.getState().compute(true)} />
        </View>
      </>
    );
  }

  if (!result) {
    return (
      <>
        <Stack.Screen options={{ title: 'Analytics' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.status}>{status || 'Crunching the numbers…'}</Text>
          <Text style={styles.statusSub}>
            Pulling fundamentals and price history for each holding (free-tier rate limits make this
            take a moment).
          </Text>
        </View>
      </>
    );
  }

  const r = result;

  return (
    <>
      <Stack.Screen options={{ title: 'Analytics' }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 56 }}>
        <Text style={styles.intro}>Tap any metric for what it means and how to read your number.</Text>
        {computing ? <Text style={styles.updating}>Updating with the latest data…</Text> : null}

        {/* Growth of your money vs the market */}
        {r.equityCurve.length > 2 ? (
          <>
            <SectionTitle>Growth</SectionTitle>
            <Card>
              <Text style={styles.chartCaption}>
                Your portfolio, indexed to 1.00 over the last {r.windowDays} trading days
              </Text>
              <LineChart values={r.equityCurve} width={chartW} height={160} />
              {r.benchEquityCurve.length > 2 ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.chartCaption}>S&P 500 (SPY), same window</Text>
                  <LineChart values={r.benchEquityCurve} width={chartW} height={110} />
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        {/* Monthly returns */}
        {r.monthlyReturns.length > 1 ? (
          <>
            <SectionTitle>Monthly returns</SectionTitle>
            <Card>
              <BarChart data={r.monthlyReturns} width={chartW} height={140} />
              <Text style={styles.note}>
                Green months gained, red months lost. Best {fmtPct(Math.max(...r.monthlyReturns.map((m) => m.value)))},
                worst {fmtPct(Math.min(...r.monthlyReturns.map((m) => m.value)))}.
              </Text>
            </Card>
          </>
        ) : null}

        {/* Drawdown */}
        {r.drawdownSeries.length > 2 ? (
          <>
            <SectionTitle>Drawdown</SectionTitle>
            <Card>
              <Text style={styles.chartCaption}>
                How far below your running peak you were, day by day
              </Text>
              <DrawdownChart values={r.drawdownSeries} width={chartW} height={120} />
              <Text style={styles.note}>
                Deepest drop {fmtPct(r.maxDrawdownPct)}
                {r.benchMaxDrawdownPct ? ` · S&P 500 ${fmtPct(r.benchMaxDrawdownPct)}` : ''}.
              </Text>
            </Card>
          </>
        ) : null}

        {/* vs benchmark */}
        {r.hasHistory && r.benchEquityCurve.length > 2 ? (
          <>
            <SectionTitle>You vs the market</SectionTitle>
            <Card>
              <CompareBars
                width={chartW}
                rows={[
                  { label: 'Annualised return', a: r.annReturnPct, b: r.benchAnnReturnPct, format: (n) => fmtPct(n) },
                  { label: 'Volatility', a: r.annVolPct, b: r.benchAnnVolPct, format: (n) => fmtPct(n, false) },
                  { label: 'Max drawdown', a: r.maxDrawdownPct, b: r.benchMaxDrawdownPct, format: (n) => fmtPct(n) },
                ]}
              />
              <Text style={styles.note}>Blue = your portfolio · grey = S&P 500.</Text>
            </Card>
          </>
        ) : null}

        {/* Who drove the P/L */}
        {r.contributors.length > 0 ? (
          <>
            <SectionTitle>What drove your P/L</SectionTitle>
            <Card>
              {r.contributors.slice(0, 10).map((c) => (
                <HBar
                  key={c.symbol}
                  label={c.symbol}
                  value={c.pl}
                  maxAbs={Math.max(...r.contributors.map((x) => Math.abs(x.pl)), 1)}
                  suffix={fmtMoney(c.pl, 0)}
                />
              ))}
            </Card>
          </>
        ) : null}

        {/* Allocation breakdowns */}
        <SectionTitle>Breakdown</SectionTitle>
        <Card>
          <Text style={styles.chartCaption}>By sector</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <Donut slices={r.sectorWeights.slice(0, 8)} />
            <DonutLegend slices={r.sectorWeights.slice(0, 8)} />
          </View>
        </Card>
        {r.capWeights.some((c) => c.label !== 'Unclassified') ? (
          <Card>
            <Text style={styles.chartCaption}>By company size</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
              <Donut slices={r.capWeights} />
              <DonutLegend slices={r.capWeights} />
            </View>
          </Card>
        ) : null}
        <Card>
          <Text style={styles.chartCaption}>By position</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <Donut slices={r.positionWeights.slice(0, 8)} />
            <DonutLegend slices={r.positionWeights.slice(0, 8)} />
          </View>
        </Card>

        <SectionTitle>Risk-adjusted return</SectionTitle>
        <Card>
          {r.hasHistory ? (
            <>
              <Row label="Sharpe" value={ratio(r.sharpe)} good={r.sharpe >= 1} />
              <Row label="Sortino" value={ratio(r.sortino)} good={r.sortino >= 1} />
              <Row label="Volatility" value={fmtPct(r.annVolPct, false)} />
              <Row label="Max drawdown" value={fmtPct(r.maxDrawdownPct)} good={r.maxDrawdownPct > -20} />
              <Text style={styles.note}>
                Based on the last {r.windowDays} trading days. {r.upDaysPct.toFixed(0)}% of days were
                up; best {fmtPct(r.bestDayPct)}, worst {fmtPct(r.worstDayPct)}.
              </Text>
            </>
          ) : (
            <Text style={styles.note}>
              Risk-adjusted metrics need daily price history, which isn’t loading here (the
              free history source is often blocked in the browser). These compute in the native app
              build, or once history is available.
            </Text>
          )}
        </Card>

        <SectionTitle>Market sensitivity</SectionTitle>
        <Card>
          {r.weightedBeta !== null ? (
            <Row label="Beta" value={ratio(r.weightedBeta)} explKey="Beta" />
          ) : null}
          {r.hasBenchmark ? (
            <>
              <Row label="Alpha" value={fmtPct(r.alphaPct)} good={r.alphaPct > 0} />
              <Row label="R²" value={fmtPct(r.rSquaredPct, false)} explKey="R²" />
              <Row label="Information ratio" value={ratio(r.informationRatio)} good={r.informationRatio > 0} />
              <Text style={styles.note}>Measured against SPY (S&P 500) over {r.windowDays} days.</Text>
            </>
          ) : r.weightedBeta !== null ? (
            <Text style={styles.note}>
              Beta is value-weighted from each stock’s fundamentals. Alpha, R² and the
              information ratio need price history versus SPY (see above).
            </Text>
          ) : (
            <Text style={styles.note}>Add a Finnhub key in Settings to compute Beta and valuation.</Text>
          )}
        </Card>

        <SectionTitle>Diversification</SectionTitle>
        <Card>
          <Row label="Holdings" value={String(r.holdings)} />
          <Row label="Effective holdings" value={ratio(r.effectiveHoldings)} explKey="Effective holdings" />
          <Row
            label="Top position"
            value={`${r.topWeightSymbol} ${r.topWeightPct.toFixed(0)}%`}
            good={r.topWeightPct < 25}
            explKey="Top position"
          />
          <Row
            label="Sector concentration"
            value={`${r.topSector} ${r.topSectorPct.toFixed(0)}%`}
            good={r.topSectorPct < 40}
            explKey="Sector concentration"
          />
        </Card>

        {r.correlations.length > 0 ? (
          <>
            <SectionTitle>Correlation</SectionTitle>
            <Card>
              {r.corrSymbols.length > 1 ? (
                <View style={{ marginBottom: spacing.md }}>
                  <CorrelationHeatmap
                    symbols={r.corrSymbols}
                    width={chartW}
                    valueFor={(a, b) =>
                      r.correlations.find(
                        (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a),
                      )?.value ?? null
                    }
                  />
                  <Text style={styles.note}>
                    Green = moves independently · red = moves together (less diversification).
                  </Text>
                </View>
              ) : null}
              <Text style={styles.note}>
                How your top holdings move together (-1 opposite, +1 identical). Lower is better
                diversification.
              </Text>
              {r.correlations.map((c) => (
                <TouchableOpacity
                  key={c.a + c.b}
                  style={styles.row}
                  activeOpacity={0.6}
                  onPress={() => setSheet({ title: `${c.a} ↔ ${c.b}`, value: c.value.toFixed(2), body: EXPL.Correlation })}>
                  <Text style={styles.rowLabel}>
                    {c.a} {'↔'} {c.b}
                  </Text>
                  <Text
                    style={[
                      styles.rowValue,
                      { color: c.value >= 0.8 ? colors.red : c.value <= 0.4 ? colors.green : colors.gold },
                    ]}>
                    {c.value.toFixed(2)}
                  </Text>
                </TouchableOpacity>
              ))}
            </Card>
          </>
        ) : null}

        {r.weightedPE !== null || r.weightedDivYield !== null ? (
          <>
            <SectionTitle>Valuation</SectionTitle>
            <Card>
              {r.weightedPE !== null ? (
                <Row label="Weighted P/E" value={ratio(r.weightedPE)} explKey="Weighted P/E" />
              ) : null}
              {r.weightedDivYield !== null ? (
                <Row label="Dividend yield" value={`${r.weightedDivYield.toFixed(2)}%`} explKey="Dividend yield" />
              ) : null}
            </Card>
          </>
        ) : null}

        <Text style={styles.footer}>Educational analysis, not financial advice.</Text>
      </ScrollView>

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <TouchableOpacity style={styles.sheetBg} activeOpacity={1} onPress={() => setSheet(null)}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{sheet?.title}</Text>
            <Text style={styles.sheetValue}>{sheet?.value}</Text>
            <Text style={styles.sheetBody}>{sheet?.body}</Text>
            <TouchableOpacity style={styles.sheetClose} onPress={() => setSheet(null)}>
              <Text style={{ color: colors.blue, fontWeight: '700' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  status: { color: colors.text, fontSize: 14, fontWeight: '600' },
  statusSub: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  intro: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm },
  chartCaption: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  updating: { color: colors.blue, fontSize: 12, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.text, fontSize: 14 },
  info: { color: colors.faint, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  note: { color: colors.faint, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  footer: { color: colors.faint, fontSize: 11, textAlign: 'center', marginTop: spacing.lg },
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
  sheetValue: { color: colors.blue, fontSize: 28, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  sheetBody: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.md },
  sheetClose: { alignSelf: 'flex-end', marginTop: spacing.lg, paddingVertical: 6 },
});
