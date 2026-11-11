/** A rectangle in whatever units the caller lays out in. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst (largest) aspect ratio in a row of `areas` laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Infinity;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk): split `rect` into one rectangle per value,
 * each with an area in proportion to its value, kept as close to square as the values allow.
 * Rectangles come back in the order of `values`; zero, negative and non-finite values get an
 * empty rectangle at the corner.
 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const items = values
    .map((v, i) => ({ v: Number.isFinite(v) && v > 0 ? v : 0, i }))
    .filter((it) => it.v > 0)
    .sort((a, b) => b.v - a.v || a.i - b.i);
  const total = items.reduce((a, it) => a + it.v, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  let { x, y, w, h } = rect;
  let row: { area: number; i: number }[] = [];

  const place = () => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) {
      // Lay the row as a column down the left side.
      const cw = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.area / cw;
        out[r.i] = { x, y: cy, w: cw, h: rh };
        cy += rh;
      }
      x += cw;
      w -= cw;
    } else {
      // Lay the row along the top.
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.area / rh;
        out[r.i] = { x: cx, y, w: rw, h: rh };
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };

  for (const it of items) {
    const area = it.v * scale;
    const side = Math.min(w, h);
    const current = row.map((r) => r.area);
    if (row.length === 0 || worst([...current, area], side) <= worst(current, side)) {
      row.push({ area, i: it.i });
    } else {
      place();
      row.push({ area, i: it.i });
    }
  }
  if (row.length) place();
  return out;
}

/** `rect` shrunk by `pad` on every side, never below zero size. */
export function inset(rect: Rect, pad: number): Rect {
  const p = Math.min(pad, rect.w / 2, rect.h / 2);
  return { x: rect.x + p, y: rect.y + p, w: rect.w - 2 * p, h: rect.h - 2 * p };
}
