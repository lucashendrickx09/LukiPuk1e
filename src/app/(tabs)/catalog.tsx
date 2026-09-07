import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { showDialog } from '@/components/Dialog';
import { CatalogGrid, GridItem } from '@/components/CatalogGrid';
import { NameInputModal } from '@/components/NameInputModal';
import { Button, Card, Chip, EmptyState, Logo, PctText, ScoreBar } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { Folder, useFolders } from '@/store/folders';
import { useMarket } from '@/store/market';
import { colors, radius, spacing } from '@/theme';
import { CatalogEntry } from '@/types';
import { capTierLabel, fmtCompact, fmtMoney } from '@/utils/format';

export default function CatalogScreen() {
  const { width } = useWindowDimensions();
  const entries = useCatalog((s) => s.entries);
  const removeFromCatalog = useCatalog((s) => s.removeFromCatalog);
  const quotes = useMarket((s) => s.quotes);
  const profiles = useMarket((s) => s.profiles);

  const folders = useFolders((s) => s.folders);
  const createFolder = useFolders((s) => s.createFolder);
  const renameFolder = useFolders((s) => s.renameFolder);
  const deleteFolder = useFolders((s) => s.deleteFolder);
  const addSymbol = useFolders((s) => s.addSymbol);
  const toggleSymbol = useFolders((s) => s.toggleSymbol);
  const foldersForSymbol = useFolders((s) => s.foldersForSymbol);

  const [peek, setPeek] = useState<CatalogEntry | null>(null);
  const [filing, setFiling] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [namingNew, setNamingNew] = useState<{ folderId: string } | null>(null);

  // While a tile is held for dragging the page must not scroll under it. The
  // grid drives `dragging`, and scrolls this view itself at the screen edges.
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  const symbols = useMemo(() => entries.map((e) => e.card.symbol), [entries]);

  useFocusEffect(
    useCallback(() => {
      if (symbols.length > 0) {
        useMarket.getState().refreshQuotes(symbols);
        useMarket.getState().ensureProfiles(symbols);
      }
    }, [symbols]),
  );

  const logoFor = useCallback(
    (symbol: string) =>
      profiles[symbol]?.logo ??
      entries.find((e) => e.card.symbol === symbol)?.card.profile.logo,
    [profiles, entries],
  );

  // Springboard contents: folders first, then any stock not filed in a folder.
  const items: GridItem[] = useMemo(() => {
    const filed = new Set(folders.flatMap((f) => f.symbols));
    return [
      ...folders.map((f) => ({ kind: 'folder' as const, key: 'f:' + f.id, folder: f })),
      ...entries
        .filter((e) => !filed.has(e.card.symbol))
        .map((e) => ({ kind: 'stock' as const, key: 's:' + e.card.symbol, entry: e })),
    ];
  }, [folders, entries]);

  const onOpen = (item: GridItem) => {
    // Tap: folders open, stocks show the quick peek (full analysis is a button
    // inside it). Long press is reserved for dragging, so it must not also open
    // anything — otherwise the peek covers the screen mid-drag.
    if (item.kind === 'folder') router.push(`/folder/${item.folder.id}`);
    else setPeek(item.entry);
  };

  const onLongPressItem = (_item: GridItem) => {
    // Drag begins — deliberately no UI here.
  };

  const onDrop = (dragged: GridItem, target: GridItem) => {
    setPeek(null);
    if (dragged.kind !== 'stock') {
      // Dragging a folder onto something: merge folders, ignore otherwise.
      if (target.kind === 'folder' && dragged.kind === 'folder') {
        for (const sym of dragged.folder.symbols) addSymbol(target.folder.id, sym);
        deleteFolder(dragged.folder.id);
      }
      return;
    }
    const symbol = dragged.entry.card.symbol;
    if (target.kind === 'folder') {
      addSymbol(target.folder.id, symbol);
      return;
    }
    // Stock onto stock -> new group containing both, then ask for a name.
    const other = target.entry.card.symbol;
    const id = createFolder('New group');
    addSymbol(id, other);
    addSymbol(id, symbol);
    setNamingNew({ folderId: id });
  };

  const folderMenu = (f: Folder) =>
    showDialog(f.name, `${f.symbols.length} stock${f.symbols.length === 1 ? '' : 's'}`, [
      { text: 'Open', onPress: () => router.push(`/folder/${f.id}`) },
      { text: 'Rename', onPress: () => setRenaming(f) },
      {
        text: 'Ungroup',
        style: 'destructive',
        onPress: () => deleteFolder(f.id),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

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

  const contentW = width - spacing.lg * 2;

  return (
    <ScrollView
      ref={scrollRef}
      scrollEnabled={!dragging}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 56 }}>
      <Text style={styles.hint}>
        Tap for a quick look, and to file it in a group. Holding and dragging one tile onto another
        groups them too.
      </Text>

      <CatalogGrid
        items={items}
        width={contentW}
        logoFor={logoFor}
        onOpen={onOpen}
        onLongPressItem={onLongPressItem}
        onDrop={onDrop}
        scrollRef={scrollRef}
        scrollYRef={scrollY}
        onDragChange={setDragging}
      />

      {folders.length > 0 ? (
        <>
          <Text style={styles.groupsHeading}>Groups</Text>
          <Text style={styles.groupsSub}>
            These are the same folders as the Folders tab — renaming here renames them there too.
          </Text>
          {folders.map((f) => (
            <TouchableOpacity key={f.id} onPress={() => folderMenu(f)}>
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.folderName}>{f.name}</Text>
                    <Text style={styles.folderSub}>
                      {f.symbols.length} stock{f.symbols.length === 1 ? '' : 's'} ·{' '}
                      {f.symbols.slice(0, 4).join(', ') || 'empty'}
                    </Text>
                  </View>
                  <Text style={styles.manage}>Manage</Text>
                </View>
              </Card>
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      {/* Quick peek (long-press a stock) */}
      <Modal visible={peek !== null} transparent animationType="fade" onRequestClose={() => setPeek(null)}>
        <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setPeek(null)}>
          {peek ? (
            <View style={styles.peekCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Logo uri={logoFor(peek.card.symbol)} symbol={peek.card.symbol} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.peekName}>{peek.card.profile.name}</Text>
                  <Text style={styles.peekSub}>
                    {peek.card.profile.sector}
                    {peek.card.profile.marketCapM
                      ? ` · ${fmtCompact(peek.card.profile.marketCapM * 1e6)} cap`
                      : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.peekPrice}>
                    {fmtMoney(quotes[peek.card.symbol]?.price ?? peek.card.price)}
                  </Text>
                  <PctText value={quotes[peek.card.symbol]?.changePct ?? peek.card.changePct} size={12} />
                </View>
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Chip label={capTierLabel(peek.card.capTier)} color={colors.gold} />
              </View>
              <Text style={styles.peekBlurb}>{peek.card.thesis.blurb}</Text>
              <ScoreBar label="Long-term score" value={peek.card.longTermScore} color={colors.blue} />
              <ScoreBar label="Momentum score" value={peek.card.momentumScore} color={colors.purple} />
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                <Button
                  label="Full analysis"
                  onPress={() => {
                    const sym = peek.card.symbol;
                    setPeek(null);
                    router.push(`/company/${sym}`);
                  }}
                />
                {/* Filing used to require dragging one tile onto another —
                    a gesture with no on-screen equivalent anywhere. */}
                <Button
                  label="Add to group…"
                  variant="secondary"
                  onPress={() => setFiling(peek.card.symbol)}
                />
                <Button
                  label="Remove from catalog"
                  variant="ghost"
                  tone={colors.red}
                  size="sm"
                  onPress={() => {
                    const sym = peek.card.symbol;
                    const inFolders = foldersForSymbol(sym).length;
                    setPeek(null);
                    showDialog(
                      `Remove ${sym}?`,
                      inFolders > 0
                        ? `This takes ${sym} out of your catalog and out of ${inFolders} group${inFolders === 1 ? '' : 's'}. Its saved analysis is discarded.`
                        : `This takes ${sym} out of your catalog and discards its saved analysis.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => removeFromCatalog(sym),
                        },
                      ],
                    );
                  }}
                />
              </View>
            </View>
          ) : null}
        </TouchableOpacity>
      </Modal>

      {/* Which groups is this stock in? A checklist beats a drag gesture. */}
      <Modal visible={filing !== null} transparent animationType="fade" onRequestClose={() => setFiling(null)}>
        <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setFiling(null)}>
          <View style={styles.peekCard}>
            <Text style={styles.peekName}>Add {filing} to a group</Text>
            {folders.length === 0 ? (
              <Text style={styles.peekSub}>You have no groups yet.</Text>
            ) : (
              folders.map((f) => {
                const inIt = f.symbols.includes(filing ?? '');
                return (
                  <TouchableOpacity
                    key={f.id}
                    onPress={() => filing && toggleSymbol(f.id, filing)}
                    style={styles.fileRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: inIt }}>
                    <Text style={{ color: inIt ? colors.blue : colors.faint, fontSize: 17, width: 24 }}>
                      {inIt ? '✓' : '○'}
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{f.name}</Text>
                    <Text style={styles.folderSub}>{f.symbols.length}</Text>
                  </TouchableOpacity>
                );
              })
            )}
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="New group…"
                variant="secondary"
                onPress={() => {
                  if (!filing) return;
                  const id = createFolder('New group');
                  addSymbol(id, filing);
                  setFiling(null);
                  setNamingNew({ folderId: id });
                }}
              />
              <Button label="Done" variant="ghost" onPress={() => setFiling(null)} />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Name a freshly created group */}
      <NameInputModal
        visible={namingNew !== null}
        title="Name this group"
        initial="New group"
        placeholder="Group name"
        submitLabel="Save"
        onSubmit={(name) => namingNew && renameFolder(namingNew.folderId, name)}
        onClose={() => setNamingNew(null)}
      />

      {/* Rename an existing group */}
      <NameInputModal
        visible={renaming !== null}
        title="Rename group"
        initial={renaming?.name ?? ''}
        submitLabel="Rename"
        onSubmit={(name) => renaming && renameFolder(renaming.id, name)}
        onClose={() => setRenaming(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  hint: { color: colors.faint, fontSize: 12, marginBottom: spacing.lg, textAlign: 'center' },
  groupsHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: 4,
  },
  groupsSub: { color: colors.faint, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
  folderName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  folderSub: { color: colors.faint, fontSize: 12, marginTop: 2 },
  manage: { color: colors.blue, fontSize: 13, fontWeight: '600' },
  modalBg: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', padding: spacing.xl },
  peekCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  peekName: { color: colors.text, fontWeight: '800', fontSize: 17 },
  peekSub: { color: colors.muted, fontSize: 12 },
  peekPrice: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  peekBlurb: { color: colors.muted, fontSize: 14, lineHeight: 20, marginVertical: spacing.md },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
