import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, radius, spacing } from '@/theme';
import { DeckCard, SwipeDirection } from '@/types';
import { capTierLabel, fmtMoney } from '@/utils/format';
import { Chip, Logo, PctText, ScoreBar } from './ui';

const SWIPE_THRESHOLD = 110;

export function SwipeDeckView({
  cards,
  onSwipe,
  onOpenDetail,
}: {
  cards: DeckCard[];
  onSwipe: (card: DeckCard, direction: SwipeDirection) => void;
  onOpenDetail: (card: DeckCard) => void;
}) {
  const { width } = useWindowDimensions();
  const pan = useRef(new Animated.ValueXY()).current;
  const flying = useRef(false);
  const top = cards[0];
  const next = cards[1];

  // The card is released when the deck changes, so a new top card is always
  // interactive even if the previous animation was interrupted.
  useEffect(() => {
    flying.current = false;
    pan.setValue({ x: 0, y: 0 });
  }, [top?.symbol, pan]);

  /**
   * Send the top card away and report it.
   *
   * Two guards matter here. `flying` rejects a second trigger while the first
   * is still animating: without it a double-tap started a second animation,
   * which stopped the first, whose callback then fired against a stale `top`
   * — recording the same company twice and silently discarding the card
   * underneath it, unseen and unrecorded. And `finished` is checked because
   * an interrupted animation still calls back.
   */
  const flyOut = (direction: SwipeDirection) => {
    if (!top || flying.current) return;
    flying.current = true;
    const card = top;
    Animated.timing(pan, {
      toValue: { x: direction === 'right' ? width * 1.3 : -width * 1.3, y: 0 },
      duration: 220,
      // JS driver throughout: the PanResponder writes to `pan` from JS, and a
      // value touched by the native driver can't be JS-driven afterwards.
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      pan.setValue({ x: 0, y: 0 });
      onSwipe(card, direction);
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          !flying.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > SWIPE_THRESHOLD) flyOut('right');
          else if (g.dx < -SWIPE_THRESHOLD) flyOut('left');
          else {
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              friction: 6,
              useNativeDriver: false,
            }).start();
          }
        },
      }),
    // Recreate when the top card changes so the closure captures it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [top?.symbol, width],
  );

  if (!top) return null;

  const rotate = pan.x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-14deg', '0deg', '14deg'],
  });
  const acceptOpacity = pan.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const rejectOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {next ? (
          <View style={[styles.cardWrap, { transform: [{ scale: 0.95 }], opacity: 0.5 }]}>
            <CardFace card={next} />
          </View>
        ) : null}
        <Animated.View
          {...responder.panHandlers}
          style={[
            styles.cardWrap,
            { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
          ]}>
          <CardFace card={top} onOpenDetail={() => onOpenDetail(top)} />
          <Animated.View style={[styles.stamp, styles.stampRight, { opacity: acceptOpacity }]}>
            <Text style={[styles.stampText, { color: colors.green }]}>CATALOG</Text>
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.stampLeft, { opacity: rejectOpacity }]}>
            <Text style={[styles.stampText, { color: colors.red }]}>PASS</Text>
          </Animated.View>
        </Animated.View>
      </View>
      {/* Labelled buttons, not bare glyphs: a path gesture is undiscoverable
          and unusable with assistive input, so each swipe has an equivalent
          button that says what it does. */}
      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Pass on ${top.symbol}`}
          style={[styles.actionBtn, { borderColor: colors.red }]}
          onPress={() => flyOut('left')}>
          <Text style={[styles.actionTxt, { color: colors.red }]}>✕</Text>
          <Text style={[styles.actionLabel, { color: colors.red }]}>Pass</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Save ${top.symbol} to catalog`}
          style={[styles.actionBtn, { borderColor: colors.green }]}
          onPress={() => flyOut('right')}>
          <Text style={[styles.actionTxt, { color: colors.green }]}>✓</Text>
          <Text style={[styles.actionLabel, { color: colors.green }]}>Catalog</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CardFace({ card, onOpenDetail }: { card: DeckCard; onOpenDetail?: () => void }) {
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Logo uri={card.profile.logo} symbol={card.symbol} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {card.profile.name}
          </Text>
          <Text style={styles.symbol}>
            {card.symbol} · {card.profile.sector}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.price}>{fmtMoney(card.price)}</Text>
          <PctText value={card.changePct} size={13} />
        </View>
      </View>

      <View style={{ marginTop: spacing.md }}>
        <Chip label={capTierLabel(card.capTier)} color={colors.gold} />
      </View>

      <Text style={styles.hook}>“{card.thesis.hook}”</Text>
      <Text style={styles.blurb} numberOfLines={4}>
        {card.thesis.blurb}
      </Text>

      <View style={{ marginTop: 'auto', gap: 2 }}>
        <ScoreBar label="Long-term score" value={card.longTermScore} color={colors.blue} />
        <ScoreBar label="Momentum score" value={card.momentumScore} color={colors.purple} />
        <View style={styles.whyBox}>
          <Text style={styles.whyLabel}>Why you’re seeing this</Text>
          <Text style={styles.whyText}>{card.whyTag}</Text>
        </View>
        {onOpenDetail ? (
          <TouchableOpacity onPress={onOpenDetail} style={{ paddingVertical: 6 }}>
            <Text style={{ color: colors.blue, fontSize: 13, textAlign: 'center' }}>
              View full analysis →
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: spacing.sm,
    bottom: spacing.sm,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  name: { color: colors.text, fontSize: 19, fontWeight: '800' },
  symbol: { color: colors.muted, fontSize: 13, marginTop: 2 },
  price: { color: colors.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hook: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    fontStyle: 'italic',
    lineHeight: 24,
    marginTop: spacing.lg,
  },
  blurb: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  whyBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  whyLabel: { color: colors.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  whyText: { color: colors.text, fontSize: 13, marginTop: 3, lineHeight: 18 },
  stamp: {
    position: 'absolute',
    top: 24,
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    transform: [{ rotate: '-12deg' }],
  },
  stampRight: { left: 20, borderColor: colors.green },
  stampLeft: { right: 20, borderColor: colors.red, transform: [{ rotate: '12deg' }] },
  stampText: { fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  actionBtn: {
    minWidth: 104,
    minHeight: 56,
    borderRadius: 28,
    borderWidth: 2,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  actionTxt: { fontSize: 20, fontWeight: '800' },
  actionLabel: { fontSize: 14, fontWeight: '700' },
});
