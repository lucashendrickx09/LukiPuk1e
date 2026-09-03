import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertsBell } from '@/components/AlertsBell';
import { colors } from '@/theme';

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

// Minimal shape of the props React Navigation passes to a custom tab bar.
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarIcon?: (p: { focused: boolean; color: string; size: number }) => React.ReactNode;
      };
    }
  >;
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: boolean }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

// Custom tab bar: we control the home-indicator clearance ourselves so devices
// with a home indicator (iPhone 14 Pro Max) don't get react-navigation's full
// ~34px inset rendered as an empty bar below the icons.
function CustomTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const paddingBottom = insets.bottom > 0 ? 12 : 8;
  return (
    <View style={[styles.bar, { paddingBottom }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? colors.blue : colors.faint;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            onPress={onPress}
            style={styles.item}
            activeOpacity={0.7}>
            {options.tabBarIcon?.({ focused, color: color as string, size: 23 })}
            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {options.title ?? route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...(props as unknown as TabBarProps)} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontWeight: '700', fontSize: 22 },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerRight: () => <AlertsBell />,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Portfolio', tabBarIcon: tabIcon('pie-chart') }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: tabIcon('flame') }} />
      <Tabs.Screen name="catalog" options={{ title: 'Catalog', tabBarIcon: tabIcon('bookmark') }} />
      <Tabs.Screen name="folders" options={{ title: 'Folders', tabBarIcon: tabIcon('folder') }} />
      <Tabs.Screen name="research" options={{ title: 'Research', tabBarIcon: tabIcon('flask') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 2 },
  label: { fontSize: 10, fontWeight: '600' },
});
