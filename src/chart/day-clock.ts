import { groupHistory } from '../history/group';
import type { Aggregate } from '../history/group';
import { addUnits, offsetAt, startOf } from '../history/timezone';
import type { Zone } from '../history/timezone';
import type { Point, Range } from '../history/types';

/**
 * Maths for the 24-hour clock: when each entity was "active" on a day, where that falls on a
 * 24-hour dial, and its numbers bucketed by the hour. Angles are radians clockwise from midnight
 * at the top. Pure functions, so the drawing code stays thin.
 */

export const TAU = Math.PI * 2;
export const DAY_MINUTES = 1440;
const MINUTE = 60_000;

/** States that count as "active" when an entity sets no `active` list of its own. */
export const DEFAULT_ACTIVE = [
  'on',
  'open',
  'opening',
  'closing',
  'home',
  'playing',
  'heating',
  'cooling',
  'drying',
  'active',
  'running',
  'cleaning',
  'detected',
];

/** States that mean "no reading": a gap on the dial, neither active nor not. */
const GAP_STATES = new Set(['unavailable', 'unknown']);

export function isGap(state: string | undefined): boolean {
  return state === undefined || state === '' || GAP_STATES.has(state);
}

/** An entity's `active` option (one state or a list) as a set, or the defaults when unset. */
export function activeSet(raw: unknown): Set<string> {
  if (typeof raw === 'string' && raw.trim() !== '') return new Set([raw.trim()]);
  if (Array.isArray(raw)) {
    const list = raw.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim());
    if (list.length) return new Set(list);
  }
  return new Set(DEFAULT_ACTIVE);
}

/** A stretch of time, ms since the epoch. `from` is set when it began before the range (carried in). */
export interface Interval {
  start: number;
  end: number;
  /** Began before the range: not a switch-on inside it. */
  carried?: boolean;
}

export interface StateIntervals {
  /** When the entity was in an active state. */
  active: Interval[];
  /** When its state was known at all (not unavailable, unknown or unrecorded). */
  known: Interval[];
  /** The last active state seen ("heating"), for the centre's label. */
  word?: string;
}

function push(list: Interval[], start: number, end: number, carried: boolean): void {
  const last = list[list.length - 1];
  if (last && last.end === start) last.end = end;
  else list.push(carried ? { start, end, carried } : { start, end });
}

/**
 * Text points (oldest first) as active and known intervals inside `range`. Each state lasts until
 * the next point, the last one until `range.end`; repeats join. A point carried in from before the
 * range (the store marks it) makes its interval `carried`, so a heater already on at midnight is
 * not counted as switching on at midnight.
 */
export function stateIntervals(points: readonly Point[], range: Range, active: Set<string>): StateIntervals {
  const out: StateIntervals = { active: [], known: [] };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = i + 1 < points.length ? points[i + 1].t : range.end;
    const start = Math.max(range.start, p.t);
    const end = Math.min(range.end, next);
    if (end <= start || isGap(p.s)) continue;
    const carried = p.carried === true || p.t < range.start;
    push(out.known, start, end, carried);
    if (active.has(p.s as string)) {
      push(out.active, start, end, carried);
      out.word = p.s;
    }
  }
  return out;
}

/** Intervals cut to `range`, empty ones left out. A cut start counts as carried in. */
export function clip(intervals: readonly Interval[], range: Range): Interval[] {
  const out: Interval[] = [];
  for (const iv of intervals) {
    const start = Math.max(range.start, iv.start);
    const end = Math.min(range.end, iv.end);
    if (end <= start) continue;
    const carried = iv.carried === true || iv.start < range.start;
    out.push(carried ? { start, end, carried } : { start, end });
  }
  return out;
}

export function totalMs(intervals: readonly Interval[]): number {
  return intervals.reduce((n, iv) => n + iv.end - iv.start, 0);
}

/** How many times it switched on: intervals that began inside the range. */
export function switchOns(intervals: readonly Interval[]): number {
  return intervals.filter((iv) => !iv.carried).length;
}

/**
 * Minutes on the wall clock from the day's midnight to `t`, in the zone: what the dial shows.
 * On the day the clocks go forward, 01:59 is followed by 03:00, so the hour between is never
 * reached; on the day they go back, 01:00–02:00 comes round twice.
 */
export function wallMinute(t: number, dayStart: number, timeZone: string): number {
  const wall = t + offsetAt(t, timeZone);
  const midnight = dayStart + offsetAt(dayStart, timeZone);
  return (wall - midnight) / MINUTE;
}

/** The instant (to the second) in (lo, hi] where the zone's offset changes from its value at lo. */
function jump(lo: number, hi: number, timeZone: string): number {
  const before = offsetAt(lo, timeZone);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, timeZone) === before) lo = mid;
    else hi = mid;
  }
  // Offsets change on a whole second, and `offsetAt` reads whole seconds: snap to it.
  return Math.floor(hi / 1000) * 1000;
}

/**
 * An interval within one day as wall-clock minute spans [from, to] on the dial (0–1440). Usually
 * one span; split in two when the clocks change inside it. Each span uses the offset in force
 * during it, so an hour of heating across the clock change still draws as an hour.
 */
export function wallSpans(iv: Interval, dayStart: number, timeZone: string): [number, number][] {
  const clamp = (m: number) => Math.min(DAY_MINUTES, Math.max(0, m));
  const a = iv.start;
  const b = iv.end;
  const oa = offsetAt(a, timeZone);
  // The offset just before the end: the end itself may be the first instant after a change.
  const ob = offsetAt(Math.max(a, b - 1000), timeZone);
  const base = dayStart + offsetAt(dayStart, timeZone);
  const at = (t: number, offset: number) => clamp((t + offset - base) / MINUTE);
  if (oa === ob) return [[at(a, oa), at(b, oa)]];
  const j = jump(a, b - 1000, timeZone);
  return [
    [at(a, oa), at(j, oa)],
    [at(j, ob), at(b, ob)],
  ].filter(([x, y]) => y > x) as [number, number][];
}

/** Wall-clock minutes as an angle on the dial: midnight at the top, clockwise. */
export function minuteAngle(m: number): number {
  return (m / DAY_MINUTES) * TAU;
}

/** The days a clock covers: `days` whole days ending with the day `back` × `days` days ago. */
export function clockDays(now: number, zone: Zone, days: number, back: number): number[] {
  const today = startOf('day', now, zone);
  const last = addUnits('day', today, -back * days, zone);
  const out: number[] = [];
  for (let i = days - 1; i >= -1; i--) out.push(addUnits('day', last, -i, zone));
  // Each day's start, then the end of the last one.
  return out;
}

/** One run of minutes on the average day: active on `on` of the `of` days it was known. */
export interface AverageRun {
  from: number;
  to: number;
  on: number;
  of: number;
}

/** Mark wall minutes (by their middle) a span covers. */
function mark(slots: Uint8Array, [from, to]: [number, number]): void {
  const first = Math.max(0, Math.ceil(from - 0.5));
  const last = Math.min(DAY_MINUTES, Math.ceil(to - 0.5));
  for (let i = first; i < last; i++) slots[i] = 1;
}

/**
 * The average day: for each wall minute, on how many of the days it was active, out of the days
 * it was known (recorded and already happened). Runs of minutes with the same counts are joined.
 * Minutes active on no day are left out. `bounds` are each day's start, then the last day's end.
 */
export function averageDay(
  active: readonly Interval[],
  known: readonly Interval[],
  bounds: readonly number[],
  timeZone: string,
): AverageRun[] {
  const on = new Uint16Array(DAY_MINUTES);
  const of = new Uint16Array(DAY_MINUTES);
  for (let d = 0; d + 1 < bounds.length; d++) {
    const day = { start: bounds[d], end: bounds[d + 1] };
    const a = new Uint8Array(DAY_MINUTES);
    const k = new Uint8Array(DAY_MINUTES);
    for (const iv of clip(known, day)) for (const s of wallSpans(iv, day.start, timeZone)) mark(k, s);
    for (const iv of clip(active, day)) for (const s of wallSpans(iv, day.start, timeZone)) mark(a, s);
    for (let i = 0; i < DAY_MINUTES; i++) {
      of[i] += k[i];
      on[i] += a[i] & k[i];
    }
  }
  const runs: AverageRun[] = [];
  for (let i = 0; i < DAY_MINUTES; i++) {
    if (on[i] === 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === i && last.on === on[i] && last.of === of[i]) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, on: on[i], of: of[i] });
  }
  return runs;
}

/** Bucket lengths in minutes the bars can use. */
export const BUCKETS = [15, 30, 60] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * Bucket boundaries across `range`, every `minutes` of real time from its start. Real time, not
 * the wall clock, so the hour that repeats when the clocks go back is two buckets (both fold onto
 * the same place on the dial, see `foldSlots`), and every bucket is the same length.
 */
export function bucketBounds(range: Range, minutes: number): number[] {
  const step = minutes * MINUTE;
  const out: number[] = [];
  for (let t = range.start; t < range.end; t += step) out.push(t);
  out.push(range.end);
  return out;
}

/** One bar on the dial: a slot of the day and its value. */
export interface Slot {
  /** Index round the dial: slot × bucket minutes is its wall-clock start. */
  index: number;
  v: number;
  /** Days that had a value here (1 on a single day). */
  days: number;
}

const ADDITIVE: ReadonlySet<Aggregate> = new Set(['sum', 'change']);

function combine(values: number[], aggregate: Aggregate): number {
  if (aggregate === 'max') return Math.max(...values);
  if (aggregate === 'min') return Math.min(...values);
  if (aggregate === 'first') return values[0];
  if (aggregate === 'last') return values[values.length - 1];
  const sum = values.reduce((a, b) => a + b, 0);
  return ADDITIVE.has(aggregate) ? sum : sum / values.length;
}

/**
 * Numeric readings as bars round the dial, one per `bucket` minutes. Each day is grouped with the
 * shared `groupHistory` (time-weighted mean, sum, change for meters…), up to `until` (now). A
 * bucket lands on the dial by its wall-clock start; two buckets on one slot (the repeated hour
 * when the clocks go back) are combined as their aggregate is (summed, or averaged). Over several
 * days each slot is the mean of the days that had a value there.
 */
export function foldSlots(
  points: readonly Point[],
  bounds: readonly number[],
  bucket: number,
  aggregate: Aggregate,
  until: number,
  timeZone: string,
): Slot[] {
  const perSlot = new Map<number, number[]>();
  for (let d = 0; d + 1 < bounds.length; d++) {
    const day = { start: bounds[d], end: bounds[d + 1] };
    if (day.start >= until) break;
    const groups = groupHistory(points as Point[], bucketBounds(day, bucket), aggregate, until);
    const today = new Map<number, number[]>();
    for (const g of groups) {
      if (g.v === null) continue;
      const index = Math.floor(wallMinute(g.t, day.start, timeZone) / bucket);
      if (index < 0 || index * bucket >= DAY_MINUTES) continue;
      today.set(index, [...(today.get(index) ?? []), g.v]);
    }
    for (const [index, values] of today) {
      perSlot.set(index, [...(perSlot.get(index) ?? []), combine(values, aggregate)]);
    }
  }
  return [...perSlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, values]) => ({ index, v: values.reduce((a, b) => a + b, 0) / values.length, days: values.length }));
}

/** Whether an aggregate adds up (a total for the day makes sense) rather than averaging. */
export function isAdditive(aggregate: Aggregate): boolean {
  return ADDITIVE.has(aggregate);
}

/**
 * Bar heights 0–1. Totals (sum, change) are drawn from zero, so an empty hour is no bar; levels
 * (mean, min, max) from the day's lowest to highest, with the lowest still a sliver, since a room
 * at 19–21 °C would otherwise draw 24 bars of the same height.
 */
export function barHeights(slots: readonly Slot[], additive: boolean): number[] {
  if (slots.length === 0) return [];
  const values = slots.map((s) => s.v);
  if (additive) {
    const max = Math.max(...values.map(Math.abs));
    return values.map((v) => (max > 0 ? Math.abs(v) / max : 0));
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi > lo ? 0.15 + (0.85 * (v - lo)) / (hi - lo) : 1));
}

/** Ring radii, outermost first: each ring's inner and outer radius, and the hole left in the middle. */
export interface RingLayout {
  rings: { r0: number; r1: number }[];
  hole: number;
}

/**
 * Rings from `outer` inwards, state rings thinner than bar rings, with a gap between. Too many to
 * fit and they all shrink alike, so the centre keeps at least `minHole`.
 */
export function ringLayout(kinds: readonly ('state' | 'numeric')[], outer = 92, minHole = 44): RingLayout {
  const GAP = 4;
  const want = kinds.map((k) => (k === 'state' ? 15 : 22));
  const total = want.reduce((a, b) => a + b, 0) + GAP * Math.max(0, kinds.length - 1);
  const room = outer - minHole;
  const scale = total > room ? room / total : 1;
  const rings: { r0: number; r1: number }[] = [];
  let r = outer;
  for (const w of want) {
    const width = w * scale;
    rings.push({ r0: r - width, r1: r });
    r -= width + GAP * scale;
  }
  return { rings, hole: rings.length ? rings[rings.length - 1].r0 : outer };
}

/** "4 h 10 m", "25 m", "0 m": a length of time as the dial's centre and legend show it. */
export function formatClockDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / MINUTE));
  const h = Math.floor(m / 60);
  const rest = m - h * 60;
  if (h === 0) return `${rest} m`;
  return rest ? `${h} h ${rest} m` : `${h} h`;
}

/* Sector geometry, copied from the polar-area chart (feat/polar-area src/chart/polar.ts). */

/** The point at radius `r` and `angle` from the centre (0, 0), in SVG coordinates (y down). */
export function polar(r: number, angle: number): [number, number] {
  return [round(r * Math.sin(angle)), round(-r * Math.cos(angle))];
}

function round(n: number): number {
  return Math.round(n * 100) / 100 || 0;
}

/** The SVG path of a ring sector from `a0` to `a1` between radii `r0` (inner) and `r1` (outer). */
export function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  if (r1 <= 0 || a1 <= a0) return '';
  const inner = Math.max(0, r0);
  if (a1 - a0 >= TAU - 1e-6) {
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
