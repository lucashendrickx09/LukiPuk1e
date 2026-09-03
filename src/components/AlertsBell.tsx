import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNotifications } from '@/store/notifications';
import { colors } from '@/theme';

// Header bell with an unread badge. Used as headerRight on the tab screens.
export function AlertsBell() {
  const count = useNotifications((s) => s.items.filter((i) => !i.read).length);
  return (
    <TouchableOpacity
      onPress={() => router.push('/alerts')}
      style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      <Ionicons name="notifications-outline" size={22} color={colors.text} />
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -1,
            right: 10,
            backgroundColor: colors.red,
            borderRadius: 9,
            minWidth: 16,
            height: 16,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}
