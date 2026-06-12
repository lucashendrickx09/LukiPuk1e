import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Card, Chip, EmptyState, Logo, PctText, ScoreBar } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { useMarket } from '@/store/market';
import { colors, radius, spacing } from '@/theme';
import { CatalogEntry } from '@/types';
import { capTierLabel, fmtCompact, fmtMoney } from '@/utils/format';

export default function CatalogScreen() {
  const entries = useCatalog((s) => s.entries);
  const removeFromCatalog = useCatalog((s) => s.removeFromCatalog);
  const quotes = useMarket((s) => s.quotes);
  const [peek, setPeek] = useState<CatalogEntry | null>(null);

  const symbols = useMemo(() => entries.map((e) => e.card.symbol), [entries]);

  useFocusEffect(
    useCallback(() => {
      if (symbols.length > 0) useMarket.getState().refreshQuotes(symbols);
    }, [symbols]),
  );

  if (entries.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Catalog is empty"
          body="Swipe right on companies in Discover to shortlist them here for deeper research."
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
      <Text style={styles.hint}>Tap for the full analysis · hold for a quick peek</Text>
      {entries.map((entry) => {
        const { card } = entry;
        const quote = quotes[card.symbol];
        const price = quote?.price ?? card.price;
        const changePct = quote?.changePct ?? card.changePct;
        return (
          <TouchableOpacity
            key={card.symbol}
            onPress={() => router.push(`/company/${card.symbol}`)}
            onLongPress={() => setPeek(entry)}>
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Logo uri={card.profile.logo} symbol={card.symbol} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>
                    {card.profile.name}
                  </Text>
                  <Text style={{ color: colors.faint, fontSize: 12 }}>
                    {card.symbol} · added {entry.addedAt.slice(0, 10)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                    {fmtMoney(price)}
                  </Text>
                  <PctText value={changePct} size={12} />
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}

      <Modal visible={peek !== null} transparent animationType="fade" onRequestClose={() => setPeek(null)}>
        <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setPeek(null)}>
          {peek ? (
            <View style={styles.peekCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Logo uri={peek.card.profile.logo} symbol={peek.card.symbol} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>
                    {peek.card.profile.name}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {peek.card.profile.sector} · {fmtCompact(peek.card.profile.marketCapM * 1e6)} cap
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Chip label={capTierLabel(peek.card.capTier)} color={colors.gold} />
              </View>
              <Text style={styles.peekBlurb}>{peek.card.thesis.blurb}</Text>
              <ScoreBar label="Long-term score" value={peek.card.longTermScore} color={colors.blue} />
              <ScoreBar label="Momentum score" value={peek.card.momentumScore} color={colors.purple} />
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <TouchableOpacity
                  style={[styles.peekBtn, { backgroundColor: colors.blue }]}
                  onPress={() => {
                    setPeek(null);
                    router.push(`/company/${peek.card.symbol}`);
                  }}>
                  <Text style={{ color: '#08111E', fontWeight: '800' }}>Full analysis</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.peekBtn, { backgroundColor: colors.surfaceAlt }]}
                  onPress={() => {
                    removeFromCatalog(peek.card.symbol);
                    setPeek(null);
                  }}>
                  <Text style={{ color: colors.red, fontWeight: '700' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  hint: { color: colors.faint, fontSize: 12, marginBottom: spacing.md, textAlign: 'center' },
  modalBg: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  peekCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  peekBlurb: { color: colors.muted, fontSize: 14, lineHeight: 20, marginVertical: spacing.md },
  peekBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
});
