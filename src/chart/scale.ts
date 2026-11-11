import type { Point } from '../history/types';

/** Lowest and highest reading across every series, ignoring gaps; undefined when there is none. */
export function extent(series: Point[][]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const points of series) {
    for (const p of points) {
      for (const v of [p.v, p.min, p.max]) {
        if (typeof v !== 'number') continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/** A little headroom above and below so lines don't sit on the edges; flat data gets ±1. */
export function padDomain([lo, hi]: [number, number], fraction = 0.08): [number, number] {
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * fraction;
  return [lo - pad, hi + pad];
}

/** Map `domain` onto `range` linearly. */
export function linear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}
