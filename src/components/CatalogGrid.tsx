import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Folder } from '@/store/folders';
import { CatalogEntry } from '@/types';
import { colors, radius } from '@/theme';
import { Logo } from './ui';

// iOS springboard-style grid: small tiles, long-press to pick one up, drop it on
// another tile to group them (or onto a folder to file it there). Folders live in
// the shared folders store, so anything created here shows up on the Folders tab.

export const COLUMNS = 4;

// react-native-web renders `dataSet` as data-* attributes; global CSS uses
// [data-tile="true"] to kill iOS's long-press image callout (Share / Save to
// Photos), which otherwise steals the drag gesture. Not typed in RN core.
const tileDataProps = { dataSet: { tile: 'true' } } as unknown as Record<string, unknown>;

export type GridItem =
  | { kind: 'stock'; key: string; entry: CatalogEntry }
  | { kind: 'folder'; key: string; folder: Folder };

interface Props {
  items: GridItem[];
  width: number; // available content width
  logoFor: (symbol: string) => string | undefined;
  onOpen: (item: GridItem) => void;
  onLongPressItem: (item: GridItem) => void;
  /** Dropped `dragged` onto `target`. */
  onDrop: (dragged: GridItem, target: GridItem) => void;
}

export function CatalogGrid({ items, width, logoFor, onOpen, onLongPressItem, onDrop }: Props) {
  const cell = width / COLUMNS;
  const tile = Math.min(cell - 14, 74);
  const rowH = cell + 20;

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Refs mirror state so the gesture callbacks (created once per item) always
  // read current values without being re-created mid-gesture.
  const armedRef = useRef<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const posOf = (index: number) => ({
    col: index % COLUMNS,
    row: Math.floor(index / COLUMNS),
  });

  // Which tile is the dragged tile's centre currently over?
  const targetFor = (index: number, dx: number, dy: number): number | null => {
    const { col, row } = posOf(index);
    const cx = col * cell + cell / 2 + dx;
    const cy = row * rowH + rowH / 2 + dy;
    if (cx < 0 || cx > width) return null;
    const tCol = Math.floor(cx / cell);
    const tRow = Math.floor(cy / rowH);
    if (tCol < 0 || tCol >= COLUMNS || tRow < 0) return null;
    const t = tRow * COLUMNS + tCol;
    if (t === index || t < 0 || t >= itemsRef.current.length) return null;
    return t;
  };

  const responders = useMemo(
    () =>
      items.map((_, index) =>
        PanResponder.create({
          // Claim the touch so we can time a long press, but hand it back to a
          // parent ScrollView if the user starts scrolling before the press
          // completes (see onPanResponderTerminationRequest).
          onStartShouldSetPanResponder: () => true,
          onPanResponderTerminationRequest: () => armedRef.current !== index,

          onPanResponderGrant: () => {
            longPressTimer.current = setTimeout(() => {
              armedRef.current = index;
              setDragIndex(index);
              pan.setValue({ x: 0, y: 0 });
              onLongPressItem(itemsRef.current[index]);
            }, 260);
          },

          onPanResponderMove: (_e, g) => {
            if (armedRef.current !== index) {
              // Moved before the long press armed — treat as a scroll/cancel.
              if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) clearTimer();
              return;
            }
            pan.setValue({ x: g.dx, y: g.dy });
            const t = targetFor(index, g.dx, g.dy);
            if (t !== hoverRef.current) {
              hoverRef.current = t;
              setHoverIndex(t);
            }
          },

          onPanResponderRelease: (_e, g) => {
            clearTimer();
            const wasArmed = armedRef.current === index;
            const moved = Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
            if (wasArmed) {
              const t = hoverRef.current;
              if (t !== null && itemsRef.current[t]) {
                onDrop(itemsRef.current[index], itemsRef.current[t]);
              }
            } else if (!moved) {
              onOpen(itemsRef.current[index]);
            }
            reset();
          },

          onPanResponderTerminate: () => {
            clearTimer();
            reset();
          },
        }),
      ),
    // Recreate when geometry or item count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, cell, rowH, width],
  );

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const reset = () => {
    armedRef.current = null;
    hoverRef.current = null;
    setDragIndex(null);
    setHoverIndex(null);
    pan.setValue({ x: 0, y: 0 });
  };

  const rows = Math.ceil(items.length / COLUMNS);

  return (
    <View style={{ width, height: rows * rowH }}>
      {items.map((item, index) => {
        const { col, row } = posOf(index);
        const isDragging = dragIndex === index;
        const isHovered = hoverIndex === index;
        const style: ViewStyle = {
          position: 'absolute',
          left: col * cell,
          top: row * rowH,
          width: cell,
          height: rowH,
          alignItems: 'center',
        };
        return (
          <Animated.View
            key={item.key}
            {...tileDataProps}
            {...responders[index].panHandlers}
            style={[
              style,
              isDragging && {
                transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: 1.12 }],
                zIndex: 50,
                opacity: 0.95,
              },
            ]}>
            <View
              style={[
                styles.tileWrap,
                { width: tile, height: tile },
                isHovered && styles.tileHovered,
              ]}>
              {item.kind === 'stock' ? (
                <Logo uri={logoFor(item.entry.card.symbol)} symbol={item.entry.card.symbol} size={tile} />
              ) : (
                <FolderTile folder={item.folder} logoFor={logoFor} size={tile} />
              )}
            </View>
            <Text numberOfLines={1} style={[styles.label, { width: cell - 6 }]}>
              {item.kind === 'stock' ? item.entry.card.symbol : item.folder.name}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** iOS-style folder icon: a rounded tray with up to four mini previews. */
function FolderTile({
  folder,
  logoFor,
  size,
}: {
  folder: Folder;
  logoFor: (symbol: string) => string | undefined;
  size: number;
}) {
  const mini = (size - 14) / 2 - 3;
  return (
    <View style={[styles.folder, { width: size, height: size }]}>
      <View style={styles.folderInner}>
        {folder.symbols.slice(0, 4).map((sym) => (
          <View key={sym} style={{ width: mini, height: mini, margin: 1.5 }}>
            <Logo uri={logoFor(sym)} symbol={sym} size={mini} />
          </View>
        ))}
        {folder.symbols.length === 0 ? <Text style={styles.emptyFolder}>empty</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tileWrap: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileHovered: {
    borderWidth: 2,
    borderColor: colors.blue,
    borderRadius: radius.lg,
    transform: [{ scale: 1.08 }],
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 5,
  },
  folder: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    width: '86%',
    height: '86%',
  },
  emptyFolder: { color: colors.faint, fontSize: 9 },
});
