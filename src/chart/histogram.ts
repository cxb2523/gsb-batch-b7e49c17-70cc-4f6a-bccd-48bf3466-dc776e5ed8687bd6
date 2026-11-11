import type { Point } from '../history/types';
import { niceStep } from './axes';

/**
 * Histogram maths: where the bins go, and how much of each series' readings fall in each.
 *
 * History records changes, not samples: a sensor that sat at 20 °C all day and flickered to 21
 * ten times in a minute has eleven rows, ten of them 21. Counting rows says it was mostly 21;
 * weighting each reading by how long it held says it was 20, which is what the room was. So bins
 * count time by default (as the grouped mean in group.ts does), and plain row counts are an option
 * for sensors where each reading is an event (a response time, a measured dose).
 */

export const COUNT_MODES = ['time', 'readings'] as const;
export type CountMode = (typeof COUNT_MODES)[number];

/** The most bins a histogram draws; a narrower bin width is widened to fit. */
export const MAX_BINS = 100;

const tidy = (v: number) => Number(v.toPrecision(12));

export interface BinOptions {
  /** How many bins (exact edges from the lowest to the highest reading). */
  bins?: number;
  /** How wide each bin is (edges on whole multiples of it). Wins over `bins`. */
  width?: number;
  /** Fixed ends of the binned range; readings outside are left out. */
  min?: number;
  max?: number;
}

/**
 * Bin edges (each bin's start, then the last end) for readings from `lo` to `hi`. A set width
 * lines edges up on its multiples; a set count splits the span exactly; otherwise a round width
 * (1, 2 or 5 × 10ⁿ) gives about `target` bins. Flat data gets one bin around its value.
 */
export function binEdges(lo: number, hi: number, opts: BinOptions = {}, target = 12): number[] {
  const start0 = opts.min ?? lo;
  const end0 = opts.max ?? hi;
  if (opts.bins !== undefined && opts.width === undefined) {
    let [a, b] = [start0, end0];
    if (!(b > a)) [a, b] = [a - 0.5, a + 0.5];
    const step = (b - a) / opts.bins;
    return Array.from({ length: opts.bins + 1 }, (_, i) => (i === opts.bins ? b : tidy(a + i * step)));
  }
  const span = end0 - start0;
  let width = opts.width ?? (span > 0 ? niceStep(span, target) : niceStep(Math.max(Math.abs(start0), 1), 10));
  while (span / width > MAX_BINS) width = niceStep(span, MAX_BINS / 2);
  const first = opts.min ?? tidy(Math.floor(start0 / width + 1e-9) * width);
  let last = opts.max ?? tidy(Math.ceil(end0 / width - 1e-9) * width);
  if (!(last > first)) last = tidy(first + width);
  const edges = [first];
  for (let i = 1; edges[edges.length - 1] < last - width * 1e-9; i++)
    edges.push(Math.min(last, tidy(first + i * width)));
  return edges;
}

/** The bin a value falls in (the top edge belongs to the last bin), or -1 outside the edges. */
export function binIndex(v: number, edges: readonly number[]): number {
  const n = edges.length - 1;
  if (n < 1 || v < edges[0] || v > edges[n]) return -1;
  if (v === edges[n]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface WeightOptions {
  mode: CountMode;
  /** Nothing is known past this moment (now, or the range's end). */
  until: number;
  /** Long-term statistics rows (each one equal period), not history. */
  statistics: boolean;
}

/**
 * How much each point counts, in ms of time or in readings.
 *
 * - Grouped points (`end` set) are one value per group: time counts the group's length up to
 *   `until`, readings count each group once.
 * - Statistics rows are all one period long, so each counts the typical gap between rows (a
 *   missing row is missing data, not a long-held value).
 * - History holds each value until the next reading; the last holds until `until`. In readings
 *   mode the value carried in from before the range, and the copy carried on to its right edge,
 *   are not readings and count nothing.
 *
 * Gaps (`v: null`) count nothing.
 */
export function pointWeights(points: readonly Point[], opts: WeightOptions): number[] {
  const { mode, until, statistics } = opts;
  if (points.length === 0) return [];
  if (points[0].end !== undefined) {
    return points.map((p) => (p.v === null ? 0 : mode === 'readings' ? 1 : Math.max(0, Math.min(p.end!, until) - p.t)));
  }
  if (statistics) {
    if (mode === 'readings') return points.map((p) => (p.v === null || p.carried ? 0 : 1));
    const gaps = points
      .slice(1)
      .map((p, i) => p.t - points[i].t)
      .filter((g) => g > 0)
      .sort((a, b) => a - b);
    const period = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 3_600_000;
    return points.map((p) => (p.v === null || p.carried ? 0 : period));
  }
  const last = points.length - 1;
  return points.map((p, i) => {
    if (p.v === null) return 0;
    if (mode === 'readings') {
      const edgeCopy = i === last && i > 0 && p.t >= until && points[i - 1].v === p.v;
      return p.carried || edgeCopy ? 0 : 1;
    }
    const next = i < last ? points[i + 1].t : Math.max(p.t, until);
    return Math.max(0, Math.min(next, until) - p.t);
  });
}

/** How much of the weight falls in each bin; readings outside the edges are left out. */
export function binTotals(points: readonly Point[], weights: readonly number[], edges: readonly number[]): number[] {
  const totals = new Array<number>(Math.max(0, edges.length - 1)).fill(0);
  points.forEach((p, i) => {
    if (p.v === null || !(weights[i] > 0)) return;
    const b = binIndex(p.v, edges);
    if (b >= 0) totals[b] += weights[i];
  });
  return totals;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A length of time in a few words: "2 d 4 h", "3 h 20 min", "45 min", "< 1 min". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return ms > 0 ? '< 1 min' : '0 min';
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  if (ms < DAY) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const hours = Math.round(ms / HOUR);
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${d} d ${h} h` : `${d} d`;
}
