/** Angles are in radians, measured clockwise from 12 o'clock, as a compass reads. */

const TAU = Math.PI * 2;

/** The point at radius `r` and `angle` from the centre (0, 0), in SVG coordinates (y down). */
export function polar(r: number, angle: number): [number, number] {
  return [round(r * Math.sin(angle)), round(-r * Math.cos(angle))];
}

function round(n: number): number {
  return Math.round(n * 100) / 100 || 0;
}

/**
 * The SVG path of a ring sector from `a0` to `a1` between radii `r0` (inner) and `r1` (outer).
 * An inner radius of 0 makes a pie wedge; a span of a full turn makes a whole ring (or disc).
 */
export function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  if (r1 <= 0 || a1 <= a0) return '';
  const inner = Math.max(0, r0);
  if (a1 - a0 >= TAU - 1e-6) {
    // A full turn: two half arcs each way, since one arc can't start and end on the same point.
    const ring = (r: number, sweep: 0 | 1) => {
      const [x0, y0] = polar(r, 0);
      const [x1, y1] = polar(r, Math.PI);
      return `M${x0} ${y0}A${r} ${r} 0 1 ${sweep} ${x1} ${y1}A${r} ${r} 0 1 ${sweep} ${x0} ${y0}Z`;
    };
    return inner > 0 ? `${ring(r1, 1)}${ring(inner, 0)}` : ring(r1, 1);
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(r1, a0);
  const [ox1, oy1] = polar(r1, a1);
  const outer = `M${ox0} ${oy0}A${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1}`;
  if (inner === 0) return `${outer}L0 0Z`;
  const [ix1, iy1] = polar(inner, a1);
  const [ix0, iy0] = polar(inner, a0);
  return `${outer}L${ix1} ${iy1}A${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0}Z`;
}

/** The angle of spoke `i` of `n` evenly spaced round a circle, the first straight up. */
export function axisAngle(i: number, n: number): number {
  return n > 0 ? (i * TAU) / n : 0;
}

/** `points` as an SVG polygon `points` attribute. */
export function polygonPoints(points: [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/**
 * Where a label at `angle` should hang from its anchor point: text left of the centre line ends
 * at the point, right of it starts there, and on the line itself it is centred.
 */
export function labelAnchor(angle: number): 'start' | 'middle' | 'end' {
  const x = Math.sin(angle);
  if (Math.abs(x) < 0.2) return 'middle';
  return x > 0 ? 'start' : 'end';
}
