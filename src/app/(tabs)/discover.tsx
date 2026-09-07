import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SwipeDeckView } from '@/components/SwipeDeck';
import { Button, EmptyState, ProgressBar } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { useDeck } from '@/store/deck';
import { useSettings } from '@/store/settings';
import { colors, radius, spacing } from '@/theme';
import { DeckCard, SwipeDirection } from '@/types';
import { todayKey } from '@/utils/format';

/** How long the undo bar stays before the swipe is treated as final. */
const UNDO_MS = 6000;

export default function DiscoverScreen() {
  const cards = useDeck((s) => s.cards);
  const builtDay = useDeck((s) => s.builtDay);
  const progress = useDeck((s) => s.progress);
  const build = useDeck((s) => s.build);
  const cancelBuild = useDeck((s) => s.cancelBuild);
  const consumeTopCard = useDeck((s) => s.consumeTopCard);
  const restoreCard = useDeck((s) => s.restoreCard);
  const loadDemoDeck = useDeck((s) => s.loadDemoDeck);
  const swipe = useCatalog((s) => s.swipe);
  const undoSwipe = useCatalog((s) => s.undoSwipe);
  const hasKey = useSettings((s) => s.hasFinnhubKey);

  const [last, setLast] = useState<{ card: DeckCard; direction: SwipeDirection } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kick off today's build when the tab gains focus and the deck is stale.
  useFocusEffect(
    useCallback(() => {
      if (hasKey && builtDay !== todayKey()) build();
    }, [hasKey, builtDay, build]),
  );

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  // Every swipe says what it did and stays reversible for a few seconds. A
  // pass locks the company out of the deck for three weeks, which used to
  // happen silently with no way back short of wiping the whole history.
  const onSwipe = (card: DeckCard, direction: SwipeDirection) => {
    swipe(card, direction);
    consumeTopCard();
    setLast({ card, direction });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLast(null), UNDO_MS);
  };

  const undo = () => {
    if (!last) return;
    undoSwipe(last.card.symbol);
    restoreCard(last.card);
    setLast(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
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
        {/* The build has no timeout, so without this a hung network left the
            user staring at a frozen progress bar with no way out. */}
        <Button
          label={cards.length > 0 ? 'Stop and use the current deck' : 'Stop'}
          variant="ghost"
          onPress={cancelBuild}
          style={{ marginTop: spacing.md }}
        />
      </View>
    );
  }

  if (progress.phase === 'error') {
    return (
      <View style={styles.center}>
        <EmptyState title="Deck build failed" body={progress.message} />
        <Button label="Try again" onPress={() => build(true)} />
        {!cards.length ? (
          <Button label="Use demo cards instead" variant="ghost" onPress={loadDemoDeck} />
        ) : null}
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
          <Button label="Try the demo deck" onPress={loadDemoDeck} />
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
        <Button
          label={builtDay === todayKey() ? 'Rebuild deck' : 'Build deck'}
          onPress={() => build(true)}
        />
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
        <TouchableOpacity onPress={() => build(true)} style={{ paddingVertical: 10, paddingLeft: 16 }}>
          <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '600' }}>Rebuild</Text>
        </TouchableOpacity>
      </View>
      <SwipeDeckView
        cards={cards}
        onSwipe={onSwipe}
        onOpenDetail={(card) => router.push(`/company/${card.symbol}`)}
      />
      {last ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoTxt} numberOfLines={1}>
            {last.direction === 'right'
              ? `${last.card.symbol} saved to Catalog`
              : `${last.card.symbol} passed · hidden for 21 days`}
          </Text>
          <TouchableOpacity onPress={undo} style={styles.undoBtn} accessibilityRole="button">
            <Text style={styles.undoAction}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
  undoBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: 6,
  },
  undoTxt: { color: colors.text, fontSize: 13, flex: 1 },
  undoBtn: { paddingHorizontal: spacing.md, paddingVertical: 12 },
  undoAction: { color: colors.blue, fontSize: 14, fontWeight: '800' },
});
