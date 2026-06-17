import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { colors } from '@/theme';
import { getSecret, KEYS } from '@/lib/secure';
import { useSettings } from '@/store/settings';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.blue,
  },
};

export default function RootLayout() {
  useEffect(() => {
    // Mirror key presence (not key material) into settings so UI can react.
    (async () => {
      const [finnhub, anthropic] = await Promise.all([
        getSecret(KEYS.finnhub),
        getSecret(KEYS.anthropic),
      ]);
      useSettings.getState().set({ hasFinnhubKey: !!finnhub, hasAnthropicKey: !!anthropic });
    })();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { color: colors.text, fontWeight: '700', fontSize: 18 },
          headerTintColor: colors.blue,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="company/[symbol]" options={{ title: 'Company' }} />
        <Stack.Screen name="folder/[id]" options={{ title: 'Folder' }} />
        <Stack.Screen
          name="add-position"
          options={{ presentation: 'modal', title: 'Add position' }}
        />
      </Stack>
    </ThemeProvider>
  );
}
