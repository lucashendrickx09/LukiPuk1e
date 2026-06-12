export const colors = {
  bg: '#0B0F14',
  surface: '#121821',
  surfaceAlt: '#1A222E',
  border: '#232D3B',
  text: '#E6EDF3',
  muted: '#8B98A9',
  faint: '#5C6878',
  green: '#53D769',
  red: '#FF6B6B',
  blue: '#5AA9FF',
  gold: '#FFC95C',
  purple: '#B388FF',
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

export const radius = { sm: 8, md: 12, lg: 16, xl: 24 };

export function plColor(value: number): string {
  if (value > 0) return colors.green;
  if (value < 0) return colors.red;
  return colors.muted;
}
