import type { Point } from '../history/types';

/**
 * Stacking: several series added up at each moment, so stacked areas and columns show a total.
 * Series are read at one shared set of times first (`align`), then each moment's values are
 * piled up (`stackValues`): positive values upwards from zero and negative ones downwards, so an
 * export below zero never cancels an import above it.
 */

export const STACK_MODES = ['none', 'normal', 'percent'] as const;
export type StackMode = (typeof STACK_MODES)[number];

/** Throw a readable error for a bad `stack`. */
export function validateStack(raw: object): void {
  const stack = (raw as { stack?: unknown }).stack;
  if (stack !== undefined && !STACK_MODES.includes(stack as StackMode)) {
    throw new Error(`"stack" must be one of: ${STACK_MODES.join(', ')}`);
  }
}

/**
 * A series' value at `t`: its reading then, else the last one before (a sensor holds its value
 * until it changes). Null before its first reading and while it is in a gap.
 */
export function valueAt(points: readonly Point[], t: number): number | null {
  let lo = 0;
  let hi = points.length;
  // First index with a time after t.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : points[lo - 1].v;
}

export interface Aligned {
  /** Every reading time across the series, in order, once each. */
  times: number[];
  /** Per series, its value at each of those times. */
  values: (number | null)[][];
}

/** Read every series at the times any of them has a reading, so they can be added up. */
export function align(series: readonly (readonly Point[])[]): Aligned {
  const times = [...new Set(series.flatMap((points) => points.map((p) => p.t)))].sort((a, b) => a - b);
  return { times, values: series.map((points) => times.map((t) => valueAt(points, t))) };
}

/** One series' slice of a stack at one moment, from `base` to `top`; null where it has no value. */
export type Layer = [base: number, top: number] | null;

/**
 * Pile up `values` (per series, per moment). Positive values stack up from zero, negative ones
 * down from it, each in listed order. `percent` scales each moment so its sizes add up to 100
 * (a moment where every value is zero stays at zero). A missing value takes no room.
 */
export function stackValues(values: readonly (readonly (number | null)[])[], mode: 'normal' | 'percent'): Layer[][] {
  const n = values[0]?.length ?? 0;
  const out: Layer[][] = values.map(() => []);
  for (let i = 0; i < n; i++) {
    let scale = 1;
    if (mode === 'percent') {
      const size = values.reduce((a, s) => a + Math.abs(s[i] ?? 0), 0);
      scale = size > 0 ? 100 / size : 0;
    }
    let up = 0;
    let down = 0;
    values.forEach((s, k) => {
      const v = s[i];
      if (v === null || v === undefined) {
        out[k].push(null);
        return;
      }
      const size = v * scale;
      if (size >= 0) {
        out[k].push([up, up + size]);
        up += size;
      } else {
        out[k].push([down, down + size]);
        down += size;
      }
    });
  }
  return out;
}

/** Each moment's total (values added with their signs); null where no series has a value. */
export function totals(values: readonly (readonly (number | null)[])[]): (number | null)[] {
  const n = values[0]?.length ?? 0;
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    let sum: number | null = null;
    for (const s of values) if (s[i] !== null && s[i] !== undefined) sum = (sum ?? 0) + (s[i] as number);
    out.push(sum);
  }
  return out;
}

/** Lowest and highest edge across every layer (zero included), for the value axis. */
export function stackExtent(layers: readonly Layer[][]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of layers) {
    for (const l of s) {
      if (!l) continue;
      lo = Math.min(lo, l[0], l[1]);
      hi = Math.max(hi, l[0], l[1]);
    }
  }
  return [lo, hi];
}
