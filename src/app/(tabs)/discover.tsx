import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SwipeDeckView } from '@/components/SwipeDeck';
import { EmptyState, ProgressBar } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { useDeck } from '@/store/deck';
import { useSettings } from '@/store/settings';
import { colors, spacing } from '@/theme';
import { DeckCard, SwipeDirection } from '@/types';
import { todayKey } from '@/utils/format';

export default function DiscoverScreen() {
  const cards = useDeck((s) => s.cards);
  const builtDay = useDeck((s) => s.builtDay);
  const progress = useDeck((s) => s.progress);
  const build = useDeck((s) => s.build);
  const consumeTopCard = useDeck((s) => s.consumeTopCard);
  const loadDemoDeck = useDeck((s) => s.loadDemoDeck);
  const swipe = useCatalog((s) => s.swipe);
  const hasKey = useSettings((s) => s.hasFinnhubKey);

  // Kick off today's build when the tab gains focus and the deck is stale.
  useFocusEffect(
    useCallback(() => {
      if (hasKey && builtDay !== todayKey()) build();
    }, [hasKey, builtDay, build]),
  );

  const onSwipe = (card: DeckCard, direction: SwipeDirection) => {
    swipe(card, direction);
    consumeTopCard();
  };

  const building = progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error';

  if (building) {
    return (
      <View style={styles.center}>
        <Text style={styles.buildTitle}>Building today’s deck</Text>
        <Text style={styles.buildSub}>
          Reading analyst trends, news and filings across the candidate universe. This takes a
          couple of minutes on the free data tier.
        </Text>
        <ProgressBar done={progress.done} total={progress.total} message={progress.message} />
      </View>
    );
  }

  if (progress.phase === 'error') {
    return (
      <View style={styles.center}>
        <EmptyState title="Deck build failed" body={progress.message} />
        <TouchableOpacity style={styles.primaryBtn} onPress={() => build(true)}>
          <Text style={styles.primaryBtnTxt}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (cards.length === 0) {
    if (!hasKey) {
      return (
        <View style={styles.center}>
          <EmptyState
            title="No data key yet"
            body="Add a free Finnhub API key in Settings to get a real daily deck — or explore with demo cards first."
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={loadDemoDeck}>
            <Text style={styles.primaryBtnTxt}>Try the demo deck</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <EmptyState
          title={builtDay === todayKey() ? 'Deck finished for today' : 'No deck yet'}
          body={
            builtDay === todayKey()
              ? 'You’ve reviewed every candidate that cleared today’s consensus gate. A fresh deck builds tomorrow — or rebuild now if you’ve changed settings.'
              : 'Build today’s deck to see which companies multiple sources agree on.'
          }
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={() => build(true)}>
          <Text style={styles.primaryBtnTxt}>
            {builtDay === todayKey() ? 'Rebuild deck' : 'Build deck'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.deckHeader}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          {cards.length} candidate{cards.length === 1 ? '' : 's'} left
          {cards[0]?.demo ? ' · demo data' : ''}
        </Text>
        <TouchableOpacity onPress={() => build(true)}>
          <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '600' }}>Rebuild</Text>
        </TouchableOpacity>
      </View>
      <SwipeDeckView
        cards={cards}
        onSwipe={onSwipe}
        onOpenDetail={(card) => router.push(`/company/${card.symbol}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  buildTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  buildSub: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  deckHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.blue,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  primaryBtnTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
});
