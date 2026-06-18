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
import { fetchMetrics } from '@/api/finnhub';
import { fetchDailyCandles } from '@/api/stooq';
import { Card, EmptyState, SectionTitle } from '@/components/ui';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';
import { AnalyticsResult, computeAnalytics } from '@/engine/analytics';
import { getSecret, KEYS } from '@/lib/secure';
import { useMarket } from '@/store/market';
import { usePortfolio } from '@/store/portfolio';
import { colors, spacing } from '@/theme';
import { Candle, KeyMetrics } from '@/types';
import { fmtPct } from '@/utils/format';

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
  const positions = usePortfolio((s) => s.positions);
  const profiles = useMarket((s) => s.profiles);
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Crunching the numbers…');
  const [sheet, setSheet] = useState<{ title: string; value: string; body: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const syms = [...new Set(positions.map((p) => p.symbol))];
      if (syms.length === 0) {
        setLoading(false);
        return;
      }
      await useMarket.getState().refreshQuotes(syms);
      const key = await getSecret(KEYS.finnhub);
      const metricsBySymbol: Record<string, KeyMetrics> = {};
      if (key) {
        for (const sym of syms) {
          if (cancelled) return;
          setStatus(`Fundamentals · ${sym}`);
          try {
            metricsBySymbol[sym] = await fetchMetrics(key, sym);
          } catch {
            // skip
          }
        }
      }
      const candlesBySymbol: Record<string, Candle[]> = {};
      for (const sym of syms) {
        if (cancelled) return;
        setStatus(`Price history · ${sym}`);
        const c = await fetchDailyCandles(sym);
        if (c) candlesBySymbol[sym] = c;
      }
      setStatus('Benchmark · SPY');
      const benchmark = await fetchDailyCandles('SPY');
      if (cancelled) return;
      const sectorOf = (sym: string) =>
        profiles[sym]?.sector ?? UNIVERSE_BY_SYMBOL.get(sym)?.fallbackSector ?? 'Other';
      const res = computeAnalytics({
        positions,
        quotes: useMarket.getState().quotes,
        metricsBySymbol,
        sectorOf,
        candlesBySymbol,
        benchmark,
      });
      if (!cancelled) {
        setResult(res);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (loading || !result) {
    return (
      <>
        <Stack.Screen options={{ title: 'Analytics' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.status}>{status}</Text>
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
