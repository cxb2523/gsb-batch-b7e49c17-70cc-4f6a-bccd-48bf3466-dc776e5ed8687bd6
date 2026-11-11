import type { Point } from '../history/types';

/**
 * Largest-triangle-three-buckets thinning of one unbroken run: keeps the first and last points
 * and, from each bucket between, the point that best preserves the line's shape.
 */
function lttb(points: Point[], target: number): Point[] {
  if (points.length <= target || target < 3) return points;
  const out: Point[] = [points[0]];
  const size = (points.length - 2) / (target - 2);
  let a = 0;
  for (let i = 0; i < target - 2; i++) {
    const from = Math.floor(i * size) + 1;
    const to = Math.min(Math.floor((i + 1) * size) + 1, points.length - 1);
    const nextFrom = to;
    const nextTo = Math.min(Math.floor((i + 2) * size) + 1, points.length);
    let avgT = 0;
    let avgV = 0;
    const n = Math.max(1, nextTo - nextFrom);
    for (let j = nextFrom; j < nextTo; j++) {
      avgT += points[j].t;
      avgV += points[j].v as number;
    }
    avgT /= n;
    avgV /= n;
    let best = from;
    let bestArea = -1;
    const pa = points[a];
    for (let j = from; j < to; j++) {
      const area = Math.abs(
        (pa.t - avgT) * ((points[j].v as number) - (pa.v as number)) - (pa.t - points[j].t) * (avgV - (pa.v as number)),
      );
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(points[best]);
    a = best;
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Thin a series to about `target` points so long histories stay fast to draw. Gaps survive:
 * each unbroken run is thinned on its own, in proportion to its length.
 */
export function downsample(points: Point[], target: number): Point[] {
  if (points.length <= target) return points;
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (run.length) runs.push(run);
      runs.push([p]);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length) runs.push(run);
  const total = points.length;
  return runs.flatMap((r) => (r[0].v === null ? r : lttb(r, Math.max(3, Math.round((r.length / total) * target)))));
}
