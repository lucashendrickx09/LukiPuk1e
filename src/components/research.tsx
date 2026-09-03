import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';
import { EvidenceBlock, ResearchSource, ResearchVerdict, SourceKind, Stance } from '@/types';
import { confidenceLabel, verdictLabel } from '@/engine/deepResearch';

// Presentation pieces shared by the Research tab, the per-company brief, and
// the company/holding detail pages.

const VERDICT_COLOR: Record<ResearchVerdict, string> = {
  buy: colors.green,
  accumulate: colors.green,
  hold: colors.blue,
  trim: colors.gold,
  exit: colors.red,
  avoid: colors.red,
};

export function VerdictChip({ verdict, size = 12 }: { verdict: ResearchVerdict; size?: number }) {
  const c = VERDICT_COLOR[verdict];
  return (
    <View style={[styles.chip, { borderColor: c + '66', backgroundColor: c + '1F' }]}>
      <Text style={{ color: c, fontSize: size, fontWeight: '800', letterSpacing: 0.3 }}>
        {verdictLabel(verdict).toUpperCase()}
      </Text>
    </View>
  );
}

export function ConfidenceMeter({ value, compact }: { value: number; compact?: boolean }) {
  const c = value >= 70 ? colors.green : value >= 45 ? colors.gold : colors.red;
  return (
    <View style={{ marginTop: compact ? 4 : spacing.sm }}>
      <View style={styles.rowBetween}>
        <Text style={styles.meterLabel}>
          Confidence{compact ? '' : ` · ${confidenceLabel(value)}`}
        </Text>
        <Text style={{ color: c, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
          {value}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, value)}%`, backgroundColor: c }]} />
      </View>
    </View>
  );
}

/** Progressive disclosure: the long-form detail stays folded until asked for. */
export function Collapsible({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.collapsible}>
      <TouchableOpacity
        style={styles.rowBetween}
        activeOpacity={0.7}
        onPress={() => setOpen((o) => !o)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.collapsibleTitle}>{title}</Text>
          {subtitle ? <Text style={styles.collapsibleSub}>{subtitle}</Text> : null}
        </View>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open ? <View style={{ marginTop: spacing.md }}>{children}</View> : null}
    </View>
  );
}

/** Renders a multi-paragraph string with real paragraph spacing. */
export function Paragraphs({ text, muted }: { text: string; muted?: boolean }) {
  const paras = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return null;
  return (
    <View>
      {paras.map((p, i) => (
        <Text
          key={i}
          style={[styles.body, muted && { color: colors.muted }, i > 0 && { marginTop: 10 }]}>
          {p}
        </Text>
      ))}
    </View>
  );
}

const STANCE_MARK: Record<Stance, { glyph: string; color: string }> = {
  bullish: { glyph: '▲', color: colors.green },
  bearish: { glyph: '▼', color: colors.red },
  neutral: { glyph: '●', color: colors.muted },
};

const KIND_LABEL: Record<SourceKind, string> = {
  filing: 'Filing',
  transcript: 'Transcript',
  investorLetter: 'Investor letter',
  analyst: 'Analyst',
  institutional: '13F / insider',
  political: 'Congress',
  news: 'News',
  other: 'Source',
};

const KIND_COLOR: Record<SourceKind, string> = {
  filing: colors.blue,
  transcript: colors.blue,
  investorLetter: colors.purple,
  analyst: colors.gold,
  institutional: colors.purple,
  political: '#4DD0E1',
  news: colors.muted,
  other: colors.faint,
};

/** One evidence pillar: summary, the findings behind it, and its caveat. */
export function EvidencePillar({
  title,
  caveat,
  block,
  sources,
}: {
  title: string;
  caveat: string;
  block: EvidenceBlock;
  sources: ResearchSource[];
}) {
  const strengthColor =
    block.strength >= 60 ? colors.green : block.strength >= 30 ? colors.gold : colors.faint;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={styles.rowBetween}>
        <Text style={styles.pillarTitle}>{title}</Text>
        <Text style={{ color: strengthColor, fontSize: 11, fontWeight: '700' }}>
          evidence {block.strength}/100
        </Text>
      </View>
      <Paragraphs text={block.summary} muted />
      {block.items.map((item, i) => {
        const mark = STANCE_MARK[item.stance];
        const src = item.sourceIndex !== undefined ? sources[item.sourceIndex] : undefined;
        return (
          <View key={i} style={styles.evidenceItem}>
            <Text style={styles.evidenceClaim}>
              <Text style={{ color: mark.color }}>{mark.glyph} </Text>
              {item.claim}
            </Text>
            {item.detail ? <Text style={styles.evidenceDetail}>{item.detail}</Text> : null}
            {src ? (
              <TouchableOpacity onPress={() => Linking.openURL(src.url)} hitSlop={6}>
                <Text style={styles.evidenceSource} numberOfLines={1}>
                  {src.publisher || KIND_LABEL[src.kind]}
                  {src.date ? ` · ${src.date}` : ''} ↗
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
      <Text style={styles.caveat}>{caveat}</Text>
    </View>
  );
}

export function SourceList({ sources }: { sources: ResearchSource[] }) {
  if (sources.length === 0) {
    return <Text style={styles.caveat}>No sources were captured for this brief.</Text>;
  }
  return (
    <View>
      {sources.map((s, i) => (
        <TouchableOpacity
          key={s.url + i}
          style={styles.sourceRow}
          onPress={() => Linking.openURL(s.url)}>
          <View style={[styles.kindTag, { backgroundColor: KIND_COLOR[s.kind] + '22' }]}>
            <Text style={{ color: KIND_COLOR[s.kind], fontSize: 10, fontWeight: '700' }}>
              {KIND_LABEL[s.kind]}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle} numberOfLines={2}>
              {i + 1}. {s.title}
            </Text>
            <Text style={styles.sourceMeta} numberOfLines={1}>
              {[s.publisher, s.date].filter(Boolean).join(' · ') || s.url} ↗
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Bulleted list with a coloured glyph — used for drivers vs risks. */
export function BulletList({
  items,
  color,
  glyph = '•',
}: {
  items: string[];
  color: string;
  glyph?: string;
}) {
  return (
    <View>
      {items.map((t, i) => (
        <Text key={i} style={[styles.body, { marginBottom: 6 }]}>
          <Text style={{ color }}>{glyph} </Text>
          {t}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meterLabel: { color: colors.muted, fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginTop: 4, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  collapsible: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
  },
  collapsibleTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  collapsibleSub: { color: colors.faint, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.blue, fontSize: 15, fontWeight: '700', paddingLeft: spacing.md },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  pillarTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  evidenceItem: {
    marginTop: spacing.md,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  evidenceClaim: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  evidenceDetail: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  evidenceSource: { color: colors.blue, fontSize: 11, marginTop: 4 },
  caveat: { color: colors.faint, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  sourceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  kindTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm, marginTop: 1 },
  sourceTitle: { color: colors.text, fontSize: 13, lineHeight: 18 },
  sourceMeta: { color: colors.blue, fontSize: 11, marginTop: 2 },
});
