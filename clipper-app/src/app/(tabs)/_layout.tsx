import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.faint,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Review',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="run"
        options={{
          title: 'Run',
          tabBarIcon: ({ color, size }) => <Ionicons name="play-circle" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sources"
        options={{
          title: 'Sources',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="server"
        options={{
          title: 'Server',
          tabBarIcon: ({ color, size }) => <Ionicons name="wifi" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
