import type { Point } from '../history/types';

/**
 * Distribution maths shared by the violin, raincloud and beeswarm charts: the readings in a
 * series with how much each counts, weighted quantiles, the box-plot summary, and a kernel
 * density estimate with its bandwidth.
 */

/** One value in a distribution. */
export interface Reading {
  t: number;
  v: number;
  /** How much it counts: how long it held (ms) for history, 1 for a group or statistics row. */
  w: number;
  /** A reading taken in the range, not one carried in from before it (dots show only these). */
  real: boolean;
}

/**
 * The readings in a series. History is a step function (a sensor reports when it changes), so
 * each value counts for as long as it held, up to the next reading or a gap, and the value at the
 * left edge counts from there: a room that sat at 20 °C all night and flickered to 21 ten times
 * in a minute was at 20, not mostly at 21. Grouped values and statistics rows are already one per
 * period and count once each. The point the chart adds at `until` (now) to carry the last value
 * to the edge is not a reading.
 */
export function readingsOf(points: Point[], weighted: boolean, until: number): Reading[] {
  const out: Reading[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.v === null || !Number.isFinite(p.v)) continue;
    const next = i + 1 < points.length ? points[i + 1].t : until;
    if (weighted && i > 0 && i === points.length - 1 && p.t >= until) continue;
    // A reading that held for no time at all (two in the same instant) still counts, barely.
    const w = weighted ? Math.max(1, Math.min(next, until) - p.t) : 1;
    out.push({ t: p.t, v: p.v, w, real: p.carried !== true });
  }
  return out;
}

/**
 * The readings a strip plot or beeswarm draws as dots: one per reading taken in the period (not
 * the value carried in, nor the copy at the right edge). A sensor that held one value for the
 * whole span has none: Home Assistant's history then holds only the state it started the span
 * with, carried in to its start. That sensor still read that value the whole time, as the line
 * chart's flat line shows, so with `history` set its row gets that one reading, and `held` is
 * its value, rather than reading as "No readings". Statistics always have a row per period, so
 * a carried-in row there is the period before and is never held.
 */
export function dotReadings(points: Point[], history: boolean, until: number): { readings: Reading[]; held?: number } {
  const all = readingsOf(points, history, until);
  const readings = all.filter((r) => r.real).map((r) => ({ ...r, w: 1 }));
  if (readings.length || !history) return { readings };
  const carried = all.find((r) => !r.real);
  return carried ? { readings: [{ ...carried, w: 1, real: true }], held: carried.v } : { readings };
}

/** Readings sorted by value. */
export function byValue(readings: Reading[]): Reading[] {
  return [...readings].sort((a, b) => a.v - b.v);
}

/**
 * The value below which `p` (0–1) of the weight lies, interpolating between readings placed at
 * the middle of their own weight. With equal weights this is the usual "midpoint" quantile
 * (Hazen): the median of 1, 2, 3, 4 is 2.5. `sorted` must be sorted by value.
 */
export function quantile(sorted: Reading[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0].v;
  const total = sorted.reduce((a, r) => a + r.w, 0);
  const target = Math.min(1, Math.max(0, p)) * total;
  let before = 0;
  let prevAt = -Infinity;
  let prevV = sorted[0].v;
  for (const r of sorted) {
    const at = before + r.w / 2;
    if (target <= at) {
      if (prevAt === -Infinity) return r.v;
      return prevV + ((r.v - prevV) * (target - prevAt)) / (at - prevAt || 1);
    }
    before += r.w;
    prevAt = at;
    prevV = r.v;
  }
  return sorted[n - 1].v;
}

/** What a box plot shows. Whiskers reach the furthest readings within 1.5 box-lengths of the box. */
export interface Summary {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  low: number;
  high: number;
  mean: number;
}

export function summarize(readings: Reading[]): Summary | undefined {
  if (readings.length === 0) return undefined;
  const sorted = byValue(readings);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const reach = 1.5 * (q3 - q1);
  const inside = sorted.filter((r) => r.v >= q1 - reach && r.v <= q3 + reach);
  const total = sorted.reduce((a, r) => a + r.w, 0);
  return {
    n: readings.length,
    min: sorted[0].v,
    max: sorted[sorted.length - 1].v,
    q1,
    median,
    q3,
    low: inside.length ? inside[0].v : q1,
    high: inside.length ? inside[inside.length - 1].v : q3,
    mean: total > 0 ? sorted.reduce((a, r) => a + r.v * r.w, 0) / total : median,
  };
}

/**
 * How wide each reading's bump is in the density estimate: Silverman's rule of thumb,
 * 0.9 × min(standard deviation, IQR / 1.34) × n^(−1/5).
 *
 * - The smaller of the spread measures keeps a few outliers from blurring the main shape, and the
 *   n^(−1/5) narrows the bumps as there are more readings to show detail with.
 * - Weighted readings count as Kish's effective number, (Σw)² / Σw²: a value held for twelve
 *   hours is not twelve hundred readings.
 * - Never narrower than the sensor's own step (the smallest gap between two different values), so
 *   a sensor that reports in 0.5 °C steps draws one smooth shape, not a comb of spikes.
 * - Readings that are all the same give a bump 1 % of the value wide (or 1 for zero).
 */
export function bandwidth(readings: Reading[]): number {
  const n = readings.length;
  if (n === 0) return 1;
  const sorted = byValue(readings);
  const total = sorted.reduce((a, r) => a + r.w, 0);
  const mean = sorted.reduce((a, r) => a + r.v * r.w, 0) / total;
  const sd = Math.sqrt(sorted.reduce((a, r) => a + r.w * (r.v - mean) ** 2, 0) / total);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  const squares = sorted.reduce((a, r) => a + r.w * r.w, 0);
  const effective = squares > 0 ? (total * total) / squares : n;
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].v - sorted[i - 1].v;
    if (gap > 0 && gap < step) step = gap;
  }
  const h = 0.9 * spread * Math.max(1, effective) ** -0.2;
  if (h > 0) return Math.max(h, step === Infinity ? 0 : step);
  return step !== Infinity ? step : Math.abs(mean) * 0.01 || 1;
}

/** Density at each of `xs`: the weighted sum of a Gaussian bump of width `h` at each reading. */
export function kde(readings: Reading[], h: number, xs: number[]): number[] {
  const total = readings.reduce((a, r) => a + r.w, 0);
  if (total === 0 || h <= 0) return xs.map(() => 0);
  const k = 1 / (total * h * Math.sqrt(2 * Math.PI));
  return xs.map((x) => {
    let sum = 0;
    for (const r of readings) {
      const u = (x - r.v) / h;
      if (u > -6 && u < 6) sum += r.w * Math.exp(-0.5 * u * u);
    }
    return sum * k;
  });
}

/**
 * The density's outline: `steps` + 1 points from two bandwidths below the lowest reading to two
 * above the highest (where it has all but faded), kept inside `clip` (the axis). Each `d` is
 * scaled so the widest point is 1.
 */
export function densityCurve(
  readings: Reading[],
  h: number,
  clip: [number, number],
  steps = 64,
): { x: number; d: number }[] {
  if (readings.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of readings) {
    lo = Math.min(lo, r.v);
    hi = Math.max(hi, r.v);
  }
  const from = Math.max(clip[0], lo - 2 * h);
  const to = Math.min(clip[1], hi + 2 * h);
  if (!(to > from)) return [];
  const xs = Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);
  const ds = kde(readings, h, xs);
  const peak = Math.max(...ds);
  return xs.map((x, i) => ({ x, d: peak > 0 ? ds[i] / peak : 0 }));
}

/** A steady pseudo-random offset in −0.5…0.5 for item `i`, so jittered dots don't move on redraw. */
export function jitter(i: number): number {
  const s = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/** At most `max` of the readings taken in the range, evenly spread through them (oldest first). */
export function sampleReadings(readings: Reading[], max: number): Reading[] {
  const real = readings.filter((r) => r.real);
  if (real.length <= max) return real;
  const out: Reading[] = [];
  for (let i = 0; i < max; i++) out.push(real[Math.floor((i * real.length) / max)]);
  return out;
}

/**
 * Readings split at `bounds` (period starts, then the last end): one list per period. A value
 * that held across a boundary counts in each period for the time it held there; it is a reading
 * taken in a period (`real`) only in the one it was taken in. Unweighted readings go by time.
 */
export function splitReadings(readings: Reading[], bounds: number[], weighted: boolean): Reading[][] {
  const out: Reading[][] = bounds.slice(0, -1).map(() => []);
  for (const r of readings) {
    for (let i = 0; i + 1 < bounds.length; i++) {
      const start = bounds[i];
      const end = bounds[i + 1];
      if (!weighted) {
        if (r.t >= start && r.t < end) out[i].push(r);
        continue;
      }
      const overlap = Math.min(end, r.t + r.w) - Math.max(start, r.t);
      if (overlap <= 0) continue;
      out[i].push({ t: Math.max(start, r.t), v: r.v, w: overlap, real: r.real && r.t >= start });
    }
  }
  return out;
}
