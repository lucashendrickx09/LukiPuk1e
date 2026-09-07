export const colors = {
  bg: '#0B0F14',
  surface: '#121821',
  surfaceAlt: '#1A222E',
  border: '#232D3B',
  text: '#E6EDF3',
  muted: '#8B98A9',
  // Was #5C6878 — 3.4:1 on the page background, below the 4.5:1 AA floor, and
  // it is the colour on the app's *smallest* text (captions, chart axis
  // labels, inactive tab labels). #808D9E clears AA on all three surfaces:
  // 5.69 on bg, 5.28 on surface, 4.74 on surfaceAlt.
  faint: '#808D9E',
  green: '#53D769',
  red: '#FF6B6B',
  blue: '#5AA9FF',
  gold: '#FFC95C',
  purple: '#B388FF',
};

/**
 * Direction is semantic, not decorative. Everything that means "up" or "down"
 * reads these rather than green/red directly, so the pair can be swapped for a
 * colour-blind palette in one place.
 */
export const semantic = {
  up: colors.green,
  down: colors.red,
  flat: colors.muted,
};

export const chartPalette = [
  '#5AA9FF',
  '#53D769',
  '#FFC95C',
  '#FF6B6B',
  '#B388FF',
  '#4DD0E1',
  '#F48FB1',
  '#AED581',
  '#FFB74D',
  '#90A4AE',
];

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

/**
 * One type scale instead of ad-hoc sizes. `hero` is the portfolio total,
 * `title` a screen or card heading, `body` running text, `label` a field
 * label, `caption` the smallest text that is still allowed to carry meaning.
 */
export const type = {
  hero: { fontSize: 34, fontWeight: '800' },
  large: { fontSize: 28, fontWeight: '800' },
  title: { fontSize: 19, fontWeight: '800' },
  heading: { fontSize: 16, fontWeight: '700' },
  subhead: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 14, fontWeight: '400' },
  bodyStrong: { fontSize: 14, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

/** Minimum comfortable touch target (Apple HIG / WCAG 2.5.5). */
export const HIT = 44;

/** Applied to any number that changes in place, so digits do not jitter. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

export function plColor(value: number): string {
  if (value > 0) return semantic.up;
  if (value < 0) return semantic.down;
  return semantic.flat;
}
