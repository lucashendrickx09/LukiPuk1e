// Squarified treemap layout (Bruls, Huizing & van Wijk). Lays weighted items
// into a rectangle, packing each row along the shorter side so tiles come out
// close to square rather than as long slivers.

export interface TreemapInput<T> {
  item: T;
  /** Relative area. Non-positive values are dropped. */
  value: number;
}

export interface TreemapRect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst (furthest from 1) aspect ratio in a row of the given thickness. */
function worstRatio(areas: number[], sum: number, side: number): number {
  if (sum <= 0 || side <= 0) return Infinity;
  const thickness = sum / side;
  if (thickness <= 0) return Infinity;
  let worst = 0;
  for (const area of areas) {
    const len = area / thickness;
    if (len <= 0) return Infinity;
    worst = Math.max(worst, thickness / len, len / thickness);
  }
  return worst;
}

export function treemap<T>(
  input: TreemapInput<T>[],
  width: number,
  height: number,
): TreemapRect<T>[] {
  const items = input.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const total = items.reduce((s, d) => s + d.value, 0);
  const scale = (width * height) / total;
  const scaled = items.map((d) => ({ item: d.item, area: d.value * scale }));

  const out: TreemapRect<T>[] = [];
  // Remaining free rectangle.
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;

  while (i < scaled.length) {
    // Pack along the shorter side; a row grows until adding one more entry
    // would make the row's worst aspect ratio worse.
    const alongY = w >= h;
    const side = Math.min(w, h);
    const row: number[] = [];
    let rowArea = 0;
    let best = Infinity;

    while (i < scaled.length) {
      const next = scaled[i].area;
      const ratio = worstRatio([...row, next], rowArea + next, side);
      if (row.length > 0 && ratio > best) break;
      row.push(next);
      rowArea += next;
      best = ratio;
      i++;
    }

    const thickness = rowArea / side;
    let offset = 0;
    for (let k = 0; k < row.length; k++) {
      const len = row[k] / thickness;
      const entry = scaled[i - row.length + k];
      out.push(
        alongY
          ? { item: entry.item, x, y: y + offset, w: thickness, h: len }
          : { item: entry.item, x: x + offset, y, w: len, h: thickness },
      );
      offset += len;
    }

    if (alongY) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    // Floating-point crumbs left over — stop before producing zero-size tiles.
    if (w <= 0.5 || h <= 0.5) break;
  }

  return out;
}
