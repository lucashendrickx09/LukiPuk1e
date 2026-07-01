import { useVideoPlayer, VideoView } from 'expo-video';
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
import { api, ApiError, clipVideoUrl, ReviewClip } from '@/lib/api';
import { Badge, Button, Card, Empty } from '@/components/ui';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

function ClipCard({ clip, onDone }: { clip: ReviewClip; onDone: () => void }) {
  const [caption, setCaption] = useState(clip.caption ?? '');
  const [busy, setBusy] = useState<'approve' | 'save' | 'reject' | null>(null);
  const player = useVideoPlayer(clip.has_video ? clipVideoUrl(clip.id) : null, (p) => {
    p.loop = true;
  });

  const act = async (kind: 'approve' | 'save' | 'reject') => {
    setBusy(kind);
    try {
      const res =
        kind === 'approve'
          ? await api.approve(clip.id)
          : kind === 'reject'
            ? await api.reject(clip.id)
            : await api.saveCaption(clip.id, caption, true);
      Alert.alert(kind === 'reject' ? 'Rejected' : 'Approved', res.result);
      onDone();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const duration = clip.end - clip.start;
  return (
    <Card>
      {clip.has_video ? (
        <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
      ) : (
        <Text style={{ color: colors.muted, marginBottom: spacing.sm }}>no preview available</Text>
      )}
      <Text style={styles.title}>{clip.title || '(no title)'}</Text>
      <View style={styles.badges}>
        <Badge
          label={`🔐 ${clip.permission}${clip.permission_cleared ? '' : ' — blocked'}`}
          tone={clip.permission_cleared ? 'good' : 'bad'}
        />
        <Badge label={`hook ${clip.hook_score}/10`} tone={clip.hook_score >= 8 ? 'good' : 'neutral'} />
        <Badge label={`${duration.toFixed(0)}s`} />
      </View>
      <TextInput
        style={styles.caption}
        value={caption}
        onChangeText={setCaption}
        multiline
        placeholder="caption"
        placeholderTextColor={colors.faint}
      />
      {clip.hashtags.length > 0 && (
        <Text style={styles.tags}>{clip.hashtags.join(' ')}</Text>
      )}
      <View style={styles.actions}>
        <Button title="✅ Approve" onPress={() => act('approve')} busy={busy === 'approve'} style={{ flex: 1 }} />
        <Button
          title="✏️ Save + approve"
          kind="secondary"
          onPress={() => act('save')}
          busy={busy === 'save'}
          style={{ flex: 1 }}
        />
        <Button title="❌" kind="danger" onPress={() => act('reject')} busy={busy === 'reject'} />
      </View>
    </Card>
  );
}

export default function ReviewScreen() {
  const serverUrl = useConnection((s) => s.serverUrl);
  const hydrated = useConnection((s) => s.hydrated);
  const [clips, setClips] = useState<ReviewClip[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!serverUrl) return;
    setRefreshing(true);
    try {
      setClips(await api.review());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [serverUrl]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (hydrated && !serverUrl) {
    return <Empty text={'Not connected.\nGo to the Server tab and enter your computer’s address.'} />;
  }

  return (
    <FlatList
      data={clips}
      keyExtractor={(c) => String(c.id)}
      renderItem={({ item }) => <ClipCard clip={item} onDone={load} />}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.muted} />}
      ListEmptyComponent={
        <Empty
          text={
            error ??
            'No clips waiting for review.\nUse the Run tab to make some, then pull down to refresh.'
          }
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 9 / 16, borderRadius: 12, backgroundColor: '#000' },
  title: { color: colors.text, fontWeight: '700', fontSize: 16, marginTop: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  caption: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.sm,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  tags: { color: colors.accentAlt, marginTop: spacing.sm, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
