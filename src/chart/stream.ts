import { groupHistory, groupStatistics } from '../history/group';
import type { Point, Range, Source } from '../history/types';

/**
 * Stacking maths for the streamgraph: series resampled onto shared times, ordered, and stacked
 * on a baseline that is zero, centred, shares of the total, or "wiggle" (the streamgraph's own).
 */

export const BASELINES = ['wiggle', 'centre', 'share', 'zero'] as const;
export type Baseline = (typeof BASELINES)[number];

export const STREAM_ORDERS = ['inside_out', 'listed'] as const;
export type StreamOrder = (typeof STREAM_ORDERS)[number];

/** One layer of the stack: its bottom and top edge at each sample. */
export interface Layer {
  lower: number[];
  upper: number[];
}

/**
 * Even bins across `range`, up to `until` (now): each bin's start, then the last end. `count` is
 * how many bins; a range already over (or not begun) still gets at least one.
 */
export function sampleBounds(range: Range, until: number, count: number): number[] {
  const end = Math.max(range.start + 1, Math.min(range.end, until));
  const n = Math.max(1, Math.round(count));
  const step = (end - range.start) / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(range.start + i * step);
  out.push(end);
  return out;
}

/**
 * One value per bin: the time-weighted mean of history (a reading holds until the next, so a
 * short spike counts for as long as it lasted), or the mean of the statistics rows in it. Gaps
 * stay null.
 */
export function binSeries(points: Point[], bounds: number[], source: Source, until: number): (number | null)[] {
  const grouped =
    source === 'statistics'
      ? groupStatistics(points, bounds, 'mean', until)
      : groupHistory(points, bounds, 'mean', until);
  return grouped.map((p) => p.v);
}

/**
 * Values ready to stack: a gap is nothing (0), and so is a negative reading, which a stack of
 * shares can't show (power flowing back out, a sensor glitch).
 */
export function stackable(values: (number | null)[]): number[] {
  return values.map((v) => (v === null || !Number.isFinite(v) || v < 0 ? 0 : v));
}

/**
 * Inside-out order (Byron & Wattenberg): series that peak early go in first, each added to
 * whichever side of the stack is lighter, so the biggest swells sit in the middle and the
 * edges stay calm. Returns series indices, bottom to top.
 */
export function insideOut(values: number[][]): number[] {
  const peaks = values.map((row, i) => {
    let at = 0;
    for (let j = 1; j < row.length; j++) if (row[j] > row[at]) at = j;
    return { i, at, sum: row.reduce((a, v) => a + v, 0) };
  });
  peaks.sort((a, b) => a.at - b.at || a.i - b.i);
  let top = 0;
  let bottom = 0;
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const p of peaks) {
    if (top < bottom) {
      top += p.sum;
      tops.push(p.i);
    } else {
      bottom += p.sum;
      bottoms.push(p.i);
    }
  }
  return [...bottoms.reverse(), ...tops];
}

/**
 * The bottom of the stack at each sample.
 *
 * - zero: an ordinary stacked area, from nothing up.
 * - centre: the stack centred on zero (a "silhouette").
 * - wiggle: the baseline that keeps the layers' slopes smallest overall (Byron & Wattenberg,
 *   as in d3's stackOffsetWiggle), so each stream reads as flat as it can; then centred.
 * - share: zero, with every column already scaled to 100.
 *
 * `ordered` is the values bottom to top.
 */
export function baseline(ordered: number[][], kind: Baseline): number[] {
  const m = ordered[0]?.length ?? 0;
  const totals = Array.from({ length: m }, (_, j) => ordered.reduce((a, row) => a + row[j], 0));
  if (kind === 'zero' || kind === 'share') return new Array<number>(m).fill(0);
  if (kind === 'centre') return totals.map((t) => -t / 2);
  const g = new Array<number>(m).fill(0);
  for (let j = 1; j < m; j++) {
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < ordered.length; i++) {
      const now = ordered[i][j];
      let s3 = (now - ordered[i][j - 1]) / 2;
      for (let k = 0; k < i; k++) s3 += ordered[k][j] - ordered[k][j - 1];
      s1 += now;
      s2 += s3 * now;
    }
    g[j] = g[j - 1] - (s1 ? s2 / s1 : 0);
  }
  // Centre the whole stream on zero, so it sits in the middle of the plot.
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < m; j++) {
    lo = Math.min(lo, g[j]);
    hi = Math.max(hi, g[j] + totals[j]);
  }
  const shift = m ? -(lo + hi) / 2 : 0;
  return g.map((v) => v + shift);
}

/** Each column as a share of its total, in per cent; a column with nothing in it stays empty. */
export function toShares(values: number[][]): number[][] {
  const m = values[0]?.length ?? 0;
  const totals = Array.from({ length: m }, (_, j) => values.reduce((a, row) => a + row[j], 0));
  return values.map((row) => row.map((v, j) => (totals[j] > 0 ? (v / totals[j]) * 100 : 0)));
}

/**
 * Stack `values` (one row per series, same length) in `order` (bottom to top) on `kind`'s
 * baseline. Layers come back indexed like `values`, not in stacking order.
 */
export function stack(values: number[][], order: number[], kind: Baseline): Layer[] {
  const rows = kind === 'share' ? toShares(values) : values;
  const ordered = order.map((i) => rows[i]);
  let lower = baseline(ordered, kind);
  const layers: Layer[] = new Array(values.length);
  for (const i of order) {
    const upper = lower.map((b, j) => b + rows[i][j]);
    layers[i] = { lower, upper };
    lower = upper;
  }
  return layers;
}

/** Lowest bottom and highest top across the layers, or undefined when there are none. */
export function layersExtent(layers: Layer[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of layers) {
    for (const v of l.lower) lo = Math.min(lo, v);
    for (const v of l.upper) hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/** The sample where a layer is thickest, for its label. */
export function widest(layer: Layer): { at: number; thickness: number } {
  let at = 0;
  let thickness = -Infinity;
  layer.upper.forEach((u, j) => {
    const t = u - layer.lower[j];
    if (t > thickness) {
      thickness = t;
      at = j;
    }
  });
  return { at, thickness: Math.max(0, thickness) };
}

/** A name to put on a stream: where its middle is (px) and how wide the text is. */
export interface LabelSpot {
  key: number;
  x: number;
  y: number;
  width: number;
  /** How thick the stream is there (px): thicker streams get their label first. */
  thickness: number;
}

/** Text height in px, for keeping labels apart. */
const LABEL_H = 13;

/**
 * Where labels go without overlapping: thickest stream first, each centred on its spot but
 * kept inside the plot; one that would touch a label already placed is left out. Returns each
 * placed label's left edge (px), by key.
 */
export function placeLabels(spots: LabelSpot[], plotWidth: number): Map<number, number> {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const out = new Map<number, number>();
  for (const s of [...spots].sort((a, b) => b.thickness - a.thickness || a.key - b.key)) {
    if (s.width > plotWidth - 4) continue;
    const left = Math.min(Math.max(2, s.x - s.width / 2), plotWidth - s.width - 2);
    const box = { left, right: left + s.width, top: s.y - LABEL_H / 2, bottom: s.y + LABEL_H / 2 };
    const hit = placed.some(
      (p) => box.left < p.right + 4 && box.right > p.left - 4 && box.top < p.bottom && box.bottom > p.top,
    );
    if (hit) continue;
    placed.push(box);
    out.set(s.key, left);
  }
  return out;
}
