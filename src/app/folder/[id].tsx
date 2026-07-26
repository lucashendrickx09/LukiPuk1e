import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, EmptyState, Logo, PctText } from '@/components/ui';
import { showDialog } from '@/components/Dialog';
import { NameInputModal } from '@/components/NameInputModal';
import { useCatalog } from '@/store/catalog';
import { useFolders } from '@/store/folders';
import { useMarket } from '@/store/market';
import { colors, spacing } from '@/theme';
import { fmtMoney } from '@/utils/format';

export default function FolderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folder = useFolders((s) => s.folders.find((f) => f.id === id));
  const removeSymbol = useFolders((s) => s.removeSymbol);
  const renameFolder = useFolders((s) => s.renameFolder);
  const deleteFolder = useFolders((s) => s.deleteFolder);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const entries = useCatalog((s) => s.entries);
  const quotes = useMarket((s) => s.quotes);

  // Resolve folder symbols to their catalog entries (skip any since removed).
  const stocks = useMemo(
    () =>
      (folder?.symbols ?? [])
        .map((sym) => entries.find((e) => e.card.symbol === sym))
        .filter((e): e is NonNullable<typeof e> => !!e),
    [folder, entries],
  );

  useFocusEffect(
    useCallback(() => {
      const syms = stocks.map((e) => e.card.symbol);
      if (syms.length > 0) useMarket.getState().refreshQuotes(syms);
    }, [stocks]),
  );

  if (!folder) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState title="Folder not found" body="It may have been deleted." />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: folder.name,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setEditing((e) => !e)}
              hitSlop={8}
              style={{ paddingHorizontal: 12 }}>
              <Text style={{ color: colors.blue, fontWeight: '600' }}>
                {editing ? 'Done' : 'Edit'}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {stocks.length === 0 ? (
          <EmptyState
            title="No stocks in this folder"
            body="In the Catalog, drag a company onto this folder to add it."
          />
        ) : (
          stocks.map((entry) => {
            const { card } = entry;
            const q = quotes[card.symbol];
            const price = q?.price ?? card.price;
            const changePct = q?.changePct ?? card.changePct;
            return (
              <TouchableOpacity
                key={card.symbol}
                onPress={() => router.push(`/company/${card.symbol}`)}
                onLongPress={() =>
                  showDialog('Remove from folder', `Remove ${card.symbol} from ${folder.name}?`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => removeSymbol(folder.id, card.symbol),
                    },
                  ])
                }>
                <Card style={{ marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Logo uri={card.profile.logo} symbol={card.symbol} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sym}>{card.symbol}</Text>
                      <Text style={styles.name} numberOfLines={1}>
                        {card.profile.name}
                      </Text>
                    </View>
                    {editing ? (
                      <TouchableOpacity
                        onPress={() => removeSymbol(folder.id, card.symbol)}
                        hitSlop={10}
                        style={styles.removeBtn}>
                        <Text style={styles.removeBtnTxt}>Remove</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.price}>{fmtMoney(price)}</Text>
                        <PctText value={changePct} size={12} />
                      </View>
                    )}
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}

        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerBtn} onPress={() => setRenaming(true)}>
            <Text style={styles.footerBtnTxt}>Rename folder</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.footerBtn}
            onPress={() =>
              showDialog(
                `Delete “${folder.name}”`,
                'The folder is removed. The companies stay in your catalog.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete folder',
                    style: 'destructive',
                    onPress: () => {
                      deleteFolder(folder.id);
                      router.back();
                    },
                  },
                ],
              )
            }>
            <Text style={[styles.footerBtnTxt, { color: colors.red }]}>Delete folder</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <NameInputModal
        visible={renaming}
        title="Rename folder"
        initial={folder.name}
        submitLabel="Rename"
        onSubmit={(name) => renameFolder(folder.id, name)}
        onClose={() => setRenaming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sym: { color: colors.text, fontWeight: '700', fontSize: 15 },
  name: { color: colors.faint, fontSize: 12 },
  price: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  removeBtn: {
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  removeBtnTxt: { color: colors.red, fontSize: 13, fontWeight: '700' },
  footer: { marginTop: spacing.xl, gap: spacing.sm },
  footerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  footerBtnTxt: { color: colors.blue, fontSize: 14, fontWeight: '700' },
});
