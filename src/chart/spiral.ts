import { wallTime } from '../history/timezone';
import type { Zone } from '../history/timezone';

/**
 * The maths behind the spiral chart: where an instant sits along a spiral of one turn per day (or
 * week), the turns' radii, the outline of a stretch of the spiral, and which stretch a point on
 * the drawing is over. No drawing here.
 *
 * Position along the spiral is counted in turns. The whole part is calendar days (or weeks) on the
 * wall clock in the card's time zone; the fraction is how far through the day (week) the wall
 * clock is. So midnight is always at the top and 6:00 always to the right, whatever the turn, and
 * a day across a clock change still takes exactly one turn.
 */

export const SPIRAL_TURNS = ['day', 'week'] as const;
export type SpiralTurn = (typeof SPIRAL_TURNS)[number];

const DAY_MS = 86_400_000;
const TAU = Math.PI * 2;

/** Whole calendar days from 1 Jan 1970 to the wall-clock date of `t` in the zone. */
function dayNumber(t: number, timeZone: string): { day: number; fraction: number } {
  const w = wallTime(t, timeZone);
  return {
    day: Math.round(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS),
    fraction: (w.hour * 3600 + w.minute * 60 + w.second) / 86_400,
  };
}

/**
 * Turns from the epoch to `t`: days (and the time through the day), or weeks from the zone's
 * first weekday. Day 0 (1 Jan 1970) was a Thursday, weekday 4.
 */
export function turnsAt(t: number, turn: SpiralTurn, zone: Zone): number {
  const { day, fraction } = dayNumber(t, zone.timeZone);
  if (turn === 'day') return day + fraction;
  const shift = (zone.firstDay - 4 + 7) % 7;
  return (day - shift + fraction) / 7;
}

/** The part of a number after its whole turns, 0 ≤ f < 1, negative numbers included. */
const frac = (n: number) => n - Math.floor(n);

/** A spiral of `turns` turns in a square `size` across, its innermost turn starting at `phase`. */
export interface SpiralGeometry {
  size: number;
  /** Centre, both ways. */
  centre: number;
  /** Turns from the start to the end of the span. */
  turns: number;
  /** Where the span starts in its first turn, 0–1 (0 is the top, a quarter is the right). */
  phase: number;
  /** Radius of the empty middle. */
  hole: number;
  /** Radius added per turn. */
  pitch: number;
  /** Width of the ring, across. */
  width: number;
}

/**
 * Lay out `turns` turns in a circle of `radius`: the oldest innermost round an empty middle, each
 * turn `ringWidth` (0–1) of the space between one turn and the next.
 */
export function spiralGeometry(
  size: number,
  turns: number,
  phase: number,
  ringWidth: number,
  radius = size / 2,
): SpiralGeometry {
  const hole = radius * 0.16;
  const n = Math.max(turns, 0.25);
  const pitch = (radius - hole) / (n + ringWidth);
  return { size, centre: size / 2, turns: n, phase: frac(phase), hole, pitch, width: pitch * ringWidth };
}

/** Radius of the middle of the ring `u` turns from the start. */
export function ringRadius(g: SpiralGeometry, u: number): number {
  return g.hole + g.width / 2 + u * g.pitch;
}

/** The angle (radians, 0 at the top, clockwise) of the spot `u` turns from the start. */
export function turnAngle(g: SpiralGeometry, u: number): number {
  return TAU * (u + g.phase);
}

/** The point at radius `r` and angle `a` (0 at the top, clockwise). */
export function spiralPoint(g: SpiralGeometry, r: number, a: number): [number, number] {
  return [g.centre + r * Math.sin(a), g.centre - r * Math.cos(a)];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The outline of the ring from `u0` to `u1` turns: along its outer edge, then back along its
 * inner edge. Curved edges are drawn as short straight steps, at least one every 4°.
 */
export function stretchPath(g: SpiralGeometry, u0: number, u1: number): string {
  if (!(u1 > u0)) return '';
  const steps = Math.max(1, Math.ceil((u1 - u0) * 90));
  const outer: string[] = [];
  const inner: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const u = u0 + ((u1 - u0) * k) / steps;
    const r = ringRadius(g, u);
    const a = turnAngle(g, u);
    const [ox, oy] = spiralPoint(g, r + g.width / 2, a);
    const [ix, iy] = spiralPoint(g, Math.max(0, r - g.width / 2), a);
    outer.push(`${round(ox)},${round(oy)}`);
    inner.unshift(`${round(ix)},${round(iy)}`);
  }
  return `M${outer.join('L')}L${inner.join('L')}Z`;
}

/**
 * How many turns from the start the spot at (`x`, `y`) is, if it is on the ring: of the turns
 * passing that angle, the one whose ring it is inside (with a little slack, for fingers).
 * Undefined in the middle, between turns, or past either end.
 */
export function turnUnder(g: SpiralGeometry, x: number, y: number, slack = 0): number | undefined {
  const dx = x - g.centre;
  const dy = y - g.centre;
  const r = Math.hypot(dx, dy);
  const a = frac(Math.atan2(dx, -dy) / TAU);
  // The spot at this angle on the turn through radius r: k whole turns past the first.
  const base = a - g.phase;
  const k = Math.round((r - ringRadius(g, base)) / g.pitch);
  const u = base + k;
  if (u < 0 || u > g.turns) return undefined;
  return Math.abs(r - ringRadius(g, u)) <= g.width / 2 + slack ? u : undefined;
}

/** One coloured stretch: a group of readings, from `u0` to `u1` turns. */
export interface Stretch {
  u0: number;
  u1: number;
}

/** The stretch under `u` turns, or undefined. Stretches must be in order. */
export function stretchAt(stretches: readonly Stretch[], u: number): number | undefined {
  let lo = 0;
  let hi = stretches.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = stretches[mid];
    if (u < s.u0) hi = mid - 1;
    else if (u >= s.u1) lo = mid + 1;
    else return mid;
  }
  return undefined;
}

/**
 * Where the hour (or weekday) labels go round the outside: the turn fraction of each one. A day
 * turn is labelled every `everyHours` hours from midnight; a week turn at the start of each day.
 */
export function spokes(turn: SpiralTurn, everyHours = 6): number[] {
  if (turn === 'week') return [0, 1, 2, 3, 4, 5, 6].map((d) => d / 7);
  const out: number[] = [];
  for (let h = 0; h < 24; h += everyHours) out.push(h / 24);
  return out;
}
