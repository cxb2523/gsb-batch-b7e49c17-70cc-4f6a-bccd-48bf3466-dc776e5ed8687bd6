export type Curve = 'smooth' | 'straight' | 'step';
export const CURVES: Curve[] = ['smooth', 'straight', 'step'];

export type XY = [number, number];

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Monotone cubic (Fritsch–Carlson) through the points: smooth, but it never overshoots the
 * readings, so a curve can't show a peak or dip that didn't happen.
 */
function smooth(pts: XY[]): string {
  const n = pts.length;
  if (n < 3) return straight(pts);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i][0] + h)},${f(pts[i][1] + m[i] * h)},${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - m[i + 1] * h)},${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}

function straight(pts: XY[]): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join('');
}

/** Hold each value until the next reading, then jump: right for set points and tariffs. */
function step(pts: XY[]): string {
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `H${f(pts[i][0])}V${f(pts[i][1])}`;
  return d;
}

/** The path for one unbroken run of points. A single point is a zero-length line (a dot). */
export function runPath(pts: XY[], curve: Curve): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${f(pts[0][0])},${f(pts[0][1])}h0`;
  return curve === 'smooth' ? smooth(pts) : curve === 'step' ? step(pts) : straight(pts);
}

/** Split readings into unbroken runs at the gaps (null values). */
export function runs<T extends { v: number | null }>(points: T[]): T[][] {
  const out: T[][] = [];
  let run: T[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}
