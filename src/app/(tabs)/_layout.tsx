import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, StyleSheet } from 'react-native';
import { colors } from '@/theme';

// Tab icons swap between filled (focused) and outline (unfocused) — the iOS
// convention that makes the bar read as native.
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(base: string) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons
      name={(focused ? base : `${base}-outline`) as IoniconName}
      size={size}
      color={color as string}
    />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontWeight: '700', fontSize: 22 },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.faint,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Portfolio', tabBarIcon: tabIcon('pie-chart') }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: tabIcon('flame') }} />
      <Tabs.Screen name="catalog" options={{ title: 'Catalog', tabBarIcon: tabIcon('bookmark') }} />
      <Tabs.Screen name="folders" options={{ title: 'Folders', tabBarIcon: tabIcon('folder') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
