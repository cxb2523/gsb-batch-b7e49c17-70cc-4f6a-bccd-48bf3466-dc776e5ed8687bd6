/**
 * Maths shared by the comparison charts (grouped bars, bullet, lollipop, dumbbell, slope). Pure
 * functions only, so each chart can carry this file without pulling in the others.
 */

/** A reading at a time; `v: null` is a gap. Matches the history store's points. */
export interface TimedValue {
  t: number;
  v: number | null;
  min?: number | null;
  max?: number | null;
}

/** A step of 1, 2, 2.5 or 5 times a power of ten, near `span / count`. */
export function niceStep(span: number, count = 5): number {
  if (!Number.isFinite(span) || span <= 0 || count < 1) return 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Round tick values covering `lo`..`hi`, about `count` of them, on a 1/2/2.5/5 step. The first and
 * last are on or outside the data, so the axis encloses it. Equal ends get a span of 1 around them.
 */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const step = niceStep(hi - lo, count);
  const first = Math.floor(lo / step + 1e-9) * step;
  const last = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0, v = first; v <= last + step / 2 && i < 100; i++, v = first + i * step) {
    // Clear floating-point dust (0.30000000000000004) so labels format cleanly.
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Lowest and highest of some numbers, skipping null and non-finite ones; undefined when none. */
export function extentOf(values: (number | null | undefined)[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/** A domain that always includes zero, for bars that grow from a zero line. */
export function withZero([lo, hi]: [number, number]): [number, number] {
  return [Math.min(0, lo), Math.max(0, hi)];
}

/**
 * The reading in force at time `t`: the last non-gap reading at or before it. Before the first
 * reading, or when a gap is in force at `t`, null. Points are oldest first.
 */
export function readingAt(points: TimedValue[], t: number): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.t > t) break;
    found = p.v;
  }
  return found;
}

/** The lowest and highest reading in some points (statistics' min and max count too). */
export function lowHigh(points: TimedValue[]): [number, number] | undefined {
  return extentOf(points.flatMap((p) => [p.v, p.min, p.max]));
}

/**
 * Change from `from` to `to` as a fraction of `from` (0.12 is +12 %). Undefined when either is
 * missing or `from` is zero, where a percentage means nothing.
 */
export function relativeChange(from: number | null, to: number | null): number | undefined {
  if (from === null || to === null || from === 0) return undefined;
  return (to - from) / Math.abs(from);
}

/** Which way a value moved: 'up', 'down' or 'flat' (within `epsilon`). */
export function direction(from: number, to: number, epsilon = 1e-9): 'up' | 'down' | 'flat' {
  if (Math.abs(to - from) <= epsilon) return 'flat';
  return to > from ? 'up' : 'down';
}
