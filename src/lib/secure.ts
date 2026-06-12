import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// API keys live in the device keychain on iOS/Android. SecureStore has no web
// implementation, so the web build (used for development previews only) falls
// back to AsyncStorage.

const useFallback = Platform.OS === 'web';

export async function getSecret(key: string): Promise<string | null> {
  try {
    if (useFallback) return await AsyncStorage.getItem('secret.' + key);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (useFallback) {
    if (value) await AsyncStorage.setItem('secret.' + key, value);
    else await AsyncStorage.removeItem('secret.' + key);
    return;
  }
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

export const KEYS = {
  finnhub: 'stockpile.finnhubKey',
  anthropic: 'stockpile.anthropicKey',
};
