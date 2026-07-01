import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, Source } from '@/lib/api';
import { Badge, Button, Card, Empty, Segmented } from '@/components/ui';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

const TYPES = ['auto', 'video', 'channel', 'playlist'];
const PERMISSIONS = ['owner', 'licensed', 'fair_use', 'unverified'];

export default function SourcesScreen() {
  const serverUrl = useConnection((s) => s.serverUrl);
  const hydrated = useConnection((s) => s.hydrated);
  const [sources, setSources] = useState<Source[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [url, setUrl] = useState('');
  const [type, setType] = useState('auto');
  const [permission, setPermission] = useState('owner');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!serverUrl) return;
    setRefreshing(true);
    try {
      setSources(await api.sources());
    } catch {
      /* surfaced via empty state */
    } finally {
      setRefreshing(false);
    }
  }, [serverUrl]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const add = async () => {
    if (!url.trim()) return;
    setAdding(true);
    try {
      await api.addSource(url.trim(), type, permission);
      setUrl('');
      load();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = (s: Source) => {
    Alert.alert('Remove source?', s.url, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await api.deleteSource(s.id);
          load();
        },
      },
    ]);
  };

  if (hydrated && !serverUrl) {
    return <Empty text={'Not connected.\nGo to the Server tab and enter your computer’s address.'} />;
  }

  return (
    <FlatList
      data={sources}
      keyExtractor={(s) => String(s.id)}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.muted} />}
      ListHeaderComponent={
        <Card>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="YouTube video / channel / playlist URL"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.label}>Type</Text>
          <Segmented options={TYPES} value={type} onChange={setType} />
          <Text style={styles.label}>Permission</Text>
          <Segmented options={PERMISSIONS} value={permission} onChange={setPermission} />
          <Button title="Add source" onPress={add} busy={adding} style={{ marginTop: spacing.md }} />
          <Text style={styles.hint}>
            Only owner / licensed / fair_use sources enter the pipeline.
          </Text>
        </Card>
      }
      renderItem={({ item }) => (
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Badge label={item.permission_status} tone={item.cleared ? 'good' : 'bad'} />
            <Badge label={item.type} />
          </View>
          <Text style={styles.url}>{item.url}</Text>
          <Button title="Remove" kind="ghost" onPress={() => remove(item)} style={{ marginTop: spacing.sm }} />
        </Card>
      )}
      ListEmptyComponent={<Empty text="No sources yet — add one above." />}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs },
  hint: { color: colors.faint, fontSize: 12, marginTop: spacing.sm },
  url: { color: colors.text, marginTop: spacing.sm, fontSize: 14 },
});
