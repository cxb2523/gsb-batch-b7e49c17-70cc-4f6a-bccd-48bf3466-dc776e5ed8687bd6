import { baseColor } from '../bands';
import { AGGREGATES, groupHistory, groupStatistics } from '../history/group';
import type { Aggregate } from '../history/group';
import type { Point, Range, Source } from '../history/types';
import type { ResolvedBand } from '../types';
import { padDomain } from './scale';

/**
 * The data side of the trend style: readings combined into evenly spaced buckets, the value
 * range the graph spans (with soft and hard bounds and a minimum range), the colour stops for
 * a graph coloured by bands, and the lowest, highest and average reading.
 */

/** Buckets per hour when `points_per_hour` isn't set: one per two hours, as mini-graph-card. */
export const DEFAULT_POINTS_PER_HOUR = 0.5;
/** Most buckets a graph draws; past this the buckets widen. */
export const MAX_BUCKETS = 500;
/** Most bars a bar graph draws; past this the bars widen. */
export const MAX_BARS = 96;

/** A value-axis end: `hard` always applies; a soft one (`~N` in YAML) moves out to fit readings past it. */
export interface Bound {
  value: number;
  soft: boolean;
}

/** `5` or `"5"` is a hard bound, `"~5"` a soft one; anything else is an error. */
export function parseBound(raw: unknown, name: string): Bound | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw, soft: false };
  if (typeof raw === 'string') {
    const text = raw.trim();
    const soft = text.startsWith('~');
    const n = Number(soft ? text.slice(1) : text);
    if (text !== '' && text !== '~' && Number.isFinite(n)) return { value: n, soft };
  }
  throw new Error(`"${name}" must be a number, or ~ and a number for a soft limit (e.g. "~0")`);
}

export interface DomainOptions {
  min?: Bound;
  max?: Bound;
  /** The range is never narrower than this, so small wobbles don't fill the graph. */
  minRange?: number;
  /** Bars: readings all on one side of zero stand on zero. */
  fromZero?: boolean;
}

/**
 * The values the graph spans, bottom to top. Readings are padded a little so the line's stroke
 * isn't cut by the card's edge; a hard bound is never padded past, and a soft bound only moves
 * when a reading goes beyond it.
 */
export function trendDomain(data: [number, number] | undefined, options: DomainOptions = {}): [number, number] {
  let [lo, hi] = data ?? [options.min?.value ?? 0, options.max?.value ?? 1];
  if (options.fromZero) {
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
  }
  if (options.minRange !== undefined && hi - lo < options.minRange) {
    const middle = (lo + hi) / 2;
    lo = middle - options.minRange / 2;
    hi = middle + options.minRange / 2;
  }
  let [padLo, padHi] = padDomain([lo, hi], 0.1);
  if (options.fromZero && lo === 0) padLo = 0;
  if (options.fromZero && hi === 0) padHi = 0;
  const { min, max } = options;
  if (min) padLo = min.soft && lo < min.value ? padLo : min.value;
  if (max) padHi = max.soft && hi > max.value ? padHi : max.value;
  if (padHi <= padLo) padHi = padLo + 1;
  return [padLo, padHi];
}

/** Bucket boundaries across `range`: each start, then the last end. Never more than `max` buckets. */
export function bucketBounds(range: Range, pointsPerHour: number, max = MAX_BUCKETS): number[] {
  const span = range.end - range.start;
  if (span <= 0 || pointsPerHour <= 0) return [];
  const count = Math.max(1, Math.min(max, Math.round((span / 3_600_000) * pointsPerHour)));
  const width = span / count;
  const bounds: number[] = [];
  for (let i = 0; i <= count; i++) bounds.push(i === count ? range.end : Math.round(range.start + i * width));
  return bounds;
}

/**
 * One value per bucket, combined with `aggregate` (time-weighted for the average). History is
 * readings that hold until the next one; statistics are rows. A bucket after `until` (now) is a
 * gap. The point the frame adds at `until` to carry the last reading on is dropped first: it
 * isn't a reading, and a sum would count it twice.
 */
export function bucketSeries(
  points: Point[],
  bounds: number[],
  aggregate: Aggregate,
  source: Source,
  until: number,
): Point[] {
  if (bounds.length < 2) return points;
  let readings = points;
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  if (source === 'history' && last && before && last.t === until && last.v === before.v) readings = points.slice(0, -1);
  return source === 'statistics'
    ? groupStatistics(readings, bounds, aggregate, until)
    : groupHistory(readings, bounds, aggregate, until);
}

/**
 * Where each bucket is drawn: at the middle of the part of it that has happened, so the last,
 * still-filling bucket sits between its start and now. The first and last values are carried
 * out to the graph's edges (marked `carried`, so hovering and dots skip them), as mini-graph-card
 * draws edge to edge.
 */
export function placeBuckets(buckets: Point[], range: Range, until: number): TrendPoint[] {
  const placed: TrendPoint[] = [];
  for (const b of buckets) {
    const stop = Math.min(b.end ?? b.t, until);
    if (b.t >= until) break;
    placed.push({ ...b, start: b.t, end: stop, t: Math.round((b.t + stop) / 2) });
  }
  const real = placed.filter((p) => p.v !== null);
  if (real.length === 0) return placed;
  const first = placed[0];
  const last = placed[placed.length - 1];
  const out = [...placed];
  if (first.v !== null && first.t > range.start) out.unshift({ t: range.start, v: first.v, carried: true });
  const edge = Math.min(range.end, until);
  if (last.v !== null && last.t < edge) out.push({ t: edge, v: last.v, carried: true });
  return out;
}

/** A drawn point. A bucket keeps the span it covers (`start` to `end`) for hovering. */
export interface TrendPoint extends Point {
  start?: number;
}

/** A gradient stop: `offset` 0 at the bottom of the graph, 1 at the top. */
export interface ColorStop {
  offset: number;
  color: string;
}

/**
 * Stops for a vertical gradient that colours the graph by bands. `hard` changes colour exactly at
 * each band's start; `smooth` blends from one band's colour to the next across the band, so the
 * colour reaches each band's own at its start.
 */
export function bandStops(bands: ResolvedBand[], domain: [number, number], transition: 'smooth' | 'hard'): ColorStop[] {
  const [lo, hi] = domain;
  const at = (v: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const stops: ColorStop[] = [];
  bands.forEach((band, i) => {
    const color = baseColor(band.color);
    const from = Number.isFinite(band.from) ? at(band.from) : 0;
    const to = i + 1 < bands.length ? at(bands[i + 1].from) : 1;
    if (transition === 'hard') {
      stops.push({ offset: from, color }, { offset: to, color });
    } else if (i === 0 || i === bands.length - 1 || from < to) {
      stops.push({ offset: from, color });
      if (i === bands.length - 1) stops.push({ offset: 1, color });
    }
  });
  return stops;
}

export interface Extreme {
  t: number;
  v: number;
}

export interface Extrema {
  min: Extreme;
  max: Extreme;
  /** Time-weighted when the readings hold until the next (history), else a plain mean. */
  mean: number;
}

/**
 * The lowest and highest reading and the average, over the readings drawn. Carried edge points
 * aren't readings and are skipped (except to weight the last reading's time).
 */
export function extrema(points: Point[], weighted: boolean): Extrema | undefined {
  let min: Extreme | undefined;
  let max: Extreme | undefined;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.v === null) continue;
    if (!p.carried) {
      if (!min || p.v < min.v) min = { t: p.t, v: p.v };
      if (!max || p.v > max.v) max = { t: p.t, v: p.v };
    }
    if (weighted) {
      const next = points[i + 1];
      const w = next ? next.t - p.t : 0;
      sum += p.v * w;
      weight += w;
    } else if (!p.carried) {
      sum += p.v;
      weight += 1;
    }
  }
  if (!min || !max) return undefined;
  return { min, max, mean: weight > 0 ? sum / weight : (min.v + max.v) / 2 };
}

/** Throw a readable error for a bad per-entity aggregate. */
export function checkAggregate(raw: unknown, where: string): void {
  if (raw !== undefined && !AGGREGATES.includes(raw as Aggregate)) {
    throw new Error(`${where} must be one of: ${AGGREGATES.join(', ')}`);
  }
}
