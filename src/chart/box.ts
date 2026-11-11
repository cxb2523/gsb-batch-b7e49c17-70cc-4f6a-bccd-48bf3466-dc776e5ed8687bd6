import type { Point } from '../history/types';

/**
 * Box plot maths: the spread of a sensor's readings over a span, as quartiles, whiskers and
 * outliers. Readings come in two shapes:
 *
 * - History records changes, not samples. A value holds until the next one, so each reading is
 *   weighted by how long it held (as the grouped mean in group.ts is). A heater that sat at 20 °C
 *   all day and flickered to 30 °C ten times in a minute has a median of 20, not 30.
 * - Long-term statistics rows are all the same length (an hour, five minutes), so each row's
 *   mean counts once, which is already time-weighted. Each row also carries the lowest and highest
 *   reading within it; whiskers drawn to the extremes use those, so a short spike inside an hour
 *   still shows.
 */

/** One value and how much it counts (ms held, or 1 for a statistics row). */
export interface Sample {
  v: number;
  w: number;
}

/** The values that held within [start, stop), each weighted by how long it held. */
export function heldSamples(points: readonly Point[], start: number, stop: number): Sample[] {
  const out: Sample[] = [];
  if (stop <= start) return out;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t >= stop) break;
    const next = i + 1 < points.length ? points[i + 1].t : Infinity;
    const from = Math.max(p.t, start);
    const to = Math.min(next, stop);
    if (to <= from || p.v === null) continue;
    out.push({ v: p.v, w: to - from });
  }
  return out;
}

/** Statistics rows starting within [start, stop), one sample each, with the rows' extremes. */
export function rowSamples(
  rows: readonly Point[],
  start: number,
  stop: number,
): { samples: Sample[]; extremes?: [number, number] } {
  const samples: Sample[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    if (r.t < start || r.t >= stop || r.carried || r.v === null) continue;
    samples.push({ v: r.v, w: 1 });
    lo = Math.min(lo, r.v, typeof r.min === 'number' ? r.min : r.v);
    hi = Math.max(hi, r.v, typeof r.max === 'number' ? r.max : r.v);
  }
  return { samples, extremes: samples.length ? [lo, hi] : undefined };
}

/**
 * The `q` quantile (0–1) of weighted samples sorted by value. Each sample sits at the middle of
 * its share of the total weight, and values between are interpolated; with equal weights this is
 * the textbook (Hazen) quantile, so four readings 1, 2, 3, 4 have a median of 2.5.
 */
export function weightedQuantile(sorted: readonly Sample[], q: number): number {
  const total = sorted.reduce((a, s) => a + s.w, 0);
  let before = 0;
  let prev: { at: number; v: number } | undefined;
  for (const s of sorted) {
    const at = (before + s.w / 2) / total;
    before += s.w;
    if (q <= at) {
      if (!prev) return s.v;
      return prev.v + ((s.v - prev.v) * (q - prev.at)) / (at - prev.at);
    }
    prev = { at, v: s.v };
  }
  return sorted[sorted.length - 1].v;
}

export const WHISKERS = ['tukey', 'range'] as const;
export type Whiskers = (typeof WHISKERS)[number];

/** Outliers kept per box; beyond this the most extreme ones are kept. */
export const MAX_OUTLIERS = 60;

export interface BoxStats {
  /** How many readings (or rows) went into it. */
  count: number;
  q1: number;
  median: number;
  q3: number;
  /** Time-weighted mean. */
  mean: number;
  /** Where the whiskers end. */
  low: number;
  high: number;
  /** Lowest and highest of everything, outliers included. */
  min: number;
  max: number;
  /** Values beyond the whiskers (Tukey whiskers only), distinct and sorted. */
  outliers: number[];
}

/**
 * Quartiles, whiskers and outliers. Tukey whiskers reach the furthest reading within 1.5 × the
 * box's height of it, and readings beyond are outliers; range whiskers reach the lowest and
 * highest, with no outliers. `extremes` (statistics rows' own min and max) widen the range.
 * Undefined when there are no samples.
 */
export function boxStats(
  samples: readonly Sample[],
  whiskers: Whiskers,
  extremes?: [number, number],
): BoxStats | undefined {
  const sorted = samples.filter((s) => s.w > 0 && Number.isFinite(s.v)).sort((a, b) => a.v - b.v);
  if (sorted.length === 0) return undefined;
  const q1 = weightedQuantile(sorted, 0.25);
  const median = weightedQuantile(sorted, 0.5);
  const q3 = weightedQuantile(sorted, 0.75);
  const total = sorted.reduce((a, s) => a + s.w, 0);
  const mean = sorted.reduce((a, s) => a + s.v * s.w, 0) / total;
  const min = Math.min(sorted[0].v, extremes?.[0] ?? Infinity);
  const max = Math.max(sorted[sorted.length - 1].v, extremes?.[1] ?? -Infinity);
  const base = { count: sorted.length, q1, median, q3, mean, min, max };
  if (whiskers === 'range') return { ...base, low: min, high: max, outliers: [] };
  const reach = 1.5 * (q3 - q1);
  const inside = sorted.filter((s) => s.v >= q1 - reach && s.v <= q3 + reach);
  const low = Math.min(inside[0]?.v ?? q1, q1);
  const high = Math.max(inside[inside.length - 1]?.v ?? q3, q3);
  let outliers = [...new Set(sorted.filter((s) => s.v < low || s.v > high).map((s) => s.v))];
  if (outliers.length > MAX_OUTLIERS) {
    // Keep the furthest from the box on each side.
    outliers = outliers
      .map((v) => ({ v, d: v < low ? low - v : v - high }))
      .sort((a, b) => b.d - a.d)
      .slice(0, MAX_OUTLIERS)
      .map((o) => o.v)
      .sort((a, b) => a - b);
  }
  return { ...base, low, high, outliers };
}

/** At most `max` items, picked evenly through the list. */
export function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor((i * items.length) / max)]);
  return out;
}

/** A repeatable sideways offset in [-1, 1) for reading `i`, so dots don't jump on each redraw. */
export function jitter(i: number): number {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
