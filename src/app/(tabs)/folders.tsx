import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NameInputModal } from '@/components/NameInputModal';
import { Card, EmptyState, Logo } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { Folder, useFolders } from '@/store/folders';
import { colors, spacing } from '@/theme';

export default function FoldersScreen() {
  const folders = useFolders((s) => s.folders);
  const createFolder = useFolders((s) => s.createFolder);
  const renameFolder = useFolders((s) => s.renameFolder);
  const deleteFolder = useFolders((s) => s.deleteFolder);
  const entries = useCatalog((s) => s.entries);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Folder | null>(null);

  const logoFor = (symbol: string) =>
    entries.find((e) => e.card.symbol === symbol)?.card.profile.logo;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
      <TouchableOpacity style={styles.newBtn} onPress={() => setCreating(true)}>
        <Text style={styles.newBtnTxt}>+ New folder</Text>
      </TouchableOpacity>

      {folders.length === 0 ? (
        <EmptyState
          title="No folders yet"
          body="Group catalogued stocks into folders — e.g. 'AI', 'Dividends', 'Watch closely'. Create one here, then long-press a stock in the Catalog to add it."
        />
      ) : (
        folders.map((f) => (
          <TouchableOpacity
            key={f.id}
            onPress={() => router.push(`/folder/${f.id}`)}
            onLongPress={() =>
              Alert.alert(f.name, 'Manage folder', [
                { text: 'Rename', onPress: () => setRenaming(f) },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => deleteFolder(f.id),
                },
                { text: 'Cancel', style: 'cancel' },
              ])
            }>
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={styles.headerRow}>
                <Text style={styles.name}>{f.name}</Text>
                <Text style={styles.count}>
                  {f.symbols.length} stock{f.symbols.length === 1 ? '' : 's'}
                </Text>
              </View>
              {f.symbols.length > 0 ? (
                <View style={styles.logoRow}>
                  {f.symbols.slice(0, 8).map((sym) => (
                    <Logo key={sym} uri={logoFor(sym)} symbol={sym} size={30} />
                  ))}
                  {f.symbols.length > 8 ? (
                    <Text style={styles.more}>+{f.symbols.length - 8}</Text>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.empty}>Empty — add stocks from the Catalog</Text>
              )}
            </Card>
          </TouchableOpacity>
        ))
      )}

      <NameInputModal
        visible={creating}
        title="New folder"
        placeholder="Folder name"
        submitLabel="Create"
        onSubmit={(name) => createFolder(name)}
        onClose={() => setCreating(false)}
      />
      <NameInputModal
        visible={renaming !== null}
        title="Rename folder"
        initial={renaming?.name ?? ''}
        submitLabel="Rename"
        onSubmit={(name) => renaming && renameFolder(renaming.id, name)}
        onClose={() => setRenaming(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  newBtn: {
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  newBtnTxt: { color: colors.blue, fontWeight: '700', fontSize: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  count: { color: colors.faint, fontSize: 12 },
  logoRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md, flexWrap: 'wrap', alignItems: 'center' },
  more: { color: colors.muted, fontSize: 12, fontWeight: '600', alignSelf: 'center' },
  empty: { color: colors.faint, fontSize: 12, marginTop: spacing.sm },
});
