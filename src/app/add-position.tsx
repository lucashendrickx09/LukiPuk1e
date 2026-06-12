import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { searchSymbols, SearchHit } from '@/api/finnhub';
import { getSecret, KEYS } from '@/lib/secure';
import { UNIVERSE_BY_SYMBOL } from '@/data/universe';
import { usePortfolio } from '@/store/portfolio';
import { colors, radius, spacing } from '@/theme';
import { isoDate } from '@/utils/format';

export default function AddPositionScreen() {
  const addPosition = usePortfolio((s) => s.addPosition);
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [shares, setShares] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDate, setBuyDate] = useState(isoDate(new Date()));
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Symbol search-as-you-type when a Finnhub key exists; manual entry otherwise.
  useEffect(() => {
    let cancelled = false;
    const q = symbol.trim();
    if (q.length < 2 || name) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const key = await getSecret(KEYS.finnhub);
      if (!key) return;
      try {
        const results = await searchSymbols(key, q);
        if (!cancelled) setHits(results);
      } catch {
        // search is best-effort
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [symbol, name]);

  const submit = () => {
    const sym = symbol.trim().toUpperCase();
    const sh = parseFloat(shares);
    const price = parseFloat(buyPrice);
    if (!sym || !/^[A-Z.\-]{1,8}$/.test(sym)) return setError('Enter a valid ticker symbol.');
    if (!isFinite(sh) || sh <= 0) return setError('Shares must be a positive number.');
    if (!isFinite(price) || price <= 0) return setError('Buy price must be a positive number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(buyDate)) return setError('Date must be YYYY-MM-DD.');
    addPosition({
      symbol: sym,
      name: name || UNIVERSE_BY_SYMBOL.get(sym)?.fallbackName || sym,
      shares: sh,
      buyPrice: price,
      buyDate,
    });
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Ticker symbol</Text>
      <TextInput
        style={styles.input}
        value={symbol}
        onChangeText={(t) => {
          setSymbol(t.toUpperCase());
          setName('');
        }}
        placeholder="AAPL"
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {hits.map((h) => (
        <TouchableOpacity
          key={h.symbol}
          style={styles.hit}
          onPress={() => {
            setSymbol(h.symbol);
            setName(h.description);
            setHits([]);
          }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{h.symbol}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
            {h.description}
          </Text>
        </TouchableOpacity>
      ))}
      {name ? <Text style={styles.resolved}>{name}</Text> : null}

      <Text style={styles.label}>Shares</Text>
      <TextInput
        style={styles.input}
        value={shares}
        onChangeText={setShares}
        placeholder="10"
        placeholderTextColor={colors.faint}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Buy price (USD per share)</Text>
      <TextInput
        style={styles.input}
        value={buyPrice}
        onChangeText={setBuyPrice}
        placeholder="196.50"
        placeholderTextColor={colors.faint}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Buy date</Text>
      <TextInput
        style={styles.input}
        value={buyDate}
        onChangeText={setBuyDate}
        placeholder="2026-01-15"
        placeholderTextColor={colors.faint}
        autoCorrect={false}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.primaryBtn} onPress={submit}>
        <Text style={styles.primaryBtnTxt}>Add to portfolio</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 13, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  hit: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 4,
  },
  resolved: { color: colors.green, fontSize: 12, marginTop: 6 },
  error: { color: colors.red, fontSize: 13, marginTop: spacing.md },
  primaryBtn: {
    backgroundColor: colors.blue,
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  primaryBtnTxt: { color: '#08111E', fontWeight: '800', fontSize: 15 },
});
