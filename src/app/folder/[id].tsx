import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, EmptyState, Logo, PctText } from '@/components/ui';
import { useCatalog } from '@/store/catalog';
import { useFolders } from '@/store/folders';
import { useMarket } from '@/store/market';
import { colors, spacing } from '@/theme';
import { fmtMoney } from '@/utils/format';

export default function FolderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folder = useFolders((s) => s.folders.find((f) => f.id === id));
  const removeSymbol = useFolders((s) => s.removeSymbol);
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
      <Stack.Screen options={{ title: folder.name }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {stocks.length === 0 ? (
          <EmptyState
            title="No stocks in this folder"
            body="Long-press a stock in the Catalog and pick this folder to add it."
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
                  Alert.alert('Remove from folder', `Remove ${card.symbol} from ${folder.name}?`, [
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
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.price}>{fmtMoney(price)}</Text>
                      <PctText value={changePct} size={12} />
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  sym: { color: colors.text, fontWeight: '700', fontSize: 15 },
  name: { color: colors.faint, fontSize: 12 },
  price: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
