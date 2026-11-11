import type { Range } from '../history/types';
import type { CardConfig, HomeAssistant } from '../types';
import { padDomain } from './scale';

/** How a history chart draws its axes. Every key has a default, so none is required in YAML. */
export interface AxisOptions {
  /** Time labels along the bottom. */
  x: boolean;
  /** Value labels up the side. */
  y: boolean;
  /** Labels in a margin beside the plot, or over its edges. */
  labels: AxisLabels;
  /** Lines across at each value label, and down at each time label. */
  horizontal: boolean;
  vertical: boolean;
  /** Fixed ends of the value axis; absent means fit the readings. */
  min?: number;
  max?: number;
  /** Even steps, or powers of ten (`y_scale: log`). */
  scale: YScale;
}

export const Y_SCALES = ['linear', 'log'] as const;
export type YScale = (typeof Y_SCALES)[number];

export const AXIS_LABELS = ['outside', 'inside'] as const;
export type AxisLabels = (typeof AXIS_LABELS)[number];

/** A chart without axis keys: labels in a margin, lines across but not down. */
export const DEFAULT_AXES: AxisOptions = {
  x: true,
  y: true,
  labels: 'outside',
  horizontal: true,
  vertical: false,
  scale: 'linear',
};

type AxisRaw = CardConfig & {
  x_axis?: unknown;
  y_axis?: unknown;
  axis_labels?: unknown;
  gridlines?: unknown;
  y_min?: unknown;
  y_max?: unknown;
  y_scale?: unknown;
};

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Throw a readable error for a bad axis option. */
export function validateAxisOptions(config: CardConfig): void {
  const raw = config as AxisRaw;
  for (const k of ['x_axis', 'y_axis'] as const) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  if (raw.axis_labels !== undefined && !AXIS_LABELS.includes(raw.axis_labels as AxisLabels)) {
    throw new Error(`"axis_labels" must be one of: ${AXIS_LABELS.join(', ')}`);
  }
  if (raw.gridlines !== undefined) {
    const g = raw.gridlines as Record<string, unknown>;
    if (typeof g !== 'object' || g === null || Array.isArray(g)) {
      throw new Error('"gridlines" must have "horizontal" and "vertical" (true or false)');
    }
    for (const k of ['horizontal', 'vertical']) {
      if (g[k] !== undefined && typeof g[k] !== 'boolean') throw new Error(`"gridlines.${k}" must be true or false`);
    }
  }
  for (const k of ['y_min', 'y_max'] as const) {
    if (raw[k] !== undefined && !isNumber(raw[k])) throw new Error(`"${k}" must be a number`);
  }
  if (isNumber(raw.y_min) && isNumber(raw.y_max) && raw.y_min >= raw.y_max) {
    throw new Error('"y_min" must be below "y_max"');
  }
  if (raw.y_scale !== undefined && !Y_SCALES.includes(raw.y_scale as YScale)) {
    throw new Error(`"y_scale" must be one of: ${Y_SCALES.join(', ')}`);
  }
  if (raw.y_scale === 'log') {
    // A log axis has no zero: its ends must be above it.
    for (const k of ['y_min', 'y_max'] as const) {
      if (isNumber(raw[k]) && raw[k] <= 0) throw new Error(`"${k}" must be above 0 on a log scale`);
    }
  }
}

/** The card's axis options with defaults filled in. Call after `validateAxisOptions`. */
export function axisOptions(config: CardConfig): AxisOptions {
  const raw = config as AxisRaw;
  const grid = (raw.gridlines ?? {}) as { horizontal?: boolean; vertical?: boolean };
  return {
    x: (raw.x_axis as boolean | undefined) ?? DEFAULT_AXES.x,
    y: (raw.y_axis as boolean | undefined) ?? DEFAULT_AXES.y,
    labels: (raw.axis_labels as AxisLabels | undefined) ?? DEFAULT_AXES.labels,
    horizontal: grid.horizontal ?? DEFAULT_AXES.horizontal,
    vertical: grid.vertical ?? DEFAULT_AXES.vertical,
    min: isNumber(raw.y_min) ? raw.y_min : undefined,
    max: isNumber(raw.y_max) ? raw.y_max : undefined,
    scale: (raw.y_scale as YScale | undefined) ?? DEFAULT_AXES.scale,
  };
}

/** A round step (1, 2 or 5 times a power of ten) that splits `span` into at most about `count` parts. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (m * mag >= raw * (1 - 1e-9)) return m * mag;
  return 10 * mag;
}

/** Decimals a step of 1, 2 or 5 × 10ⁿ needs to print exactly: 0.5 → 1, 20 → 0. */
export function stepDecimals(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

/** Clean up floating-point fuzz from repeated adding (0.30000000000000004 → 0.3). */
const tidy = (v: number) => Number(v.toPrecision(12));

export interface ValueAxis {
  domain: [number, number];
  ticks: number[];
  decimals: number;
  /** Log axes: unlabelled steps between the labels, for fainter gridlines. */
  minor?: number[];
  /** Log axes: the decimals each tick needs, in step with `ticks`. */
  tickDecimals?: number[];
}

/**
 * The value axis for readings spanning `data`: a little headroom, then out to the next round
 * step at each end that isn't fixed. Fixed ends are kept exactly; ticks are the round steps
 * between them. `count` is roughly how many gaps between ticks there should be.
 */
export function valueAxis(
  data: [number, number] | undefined,
  fixed: { min?: number; max?: number },
  count: number,
): ValueAxis {
  let [lo, hi] = padDomain(data ?? [0, 1]);
  if (fixed.min !== undefined) lo = fixed.min;
  if (fixed.max !== undefined) hi = fixed.max;
  if (hi <= lo) {
    // Every reading is on the wrong side of the one fixed end: show a unit's room past it.
    if (fixed.min !== undefined) hi = lo + Math.max(1, Math.abs(lo) * 0.1);
    else lo = hi - Math.max(1, Math.abs(hi) * 0.1);
  }
  const step = niceStep(hi - lo, count);
  if (fixed.min === undefined) lo = tidy(Math.floor(lo / step + 1e-9) * step);
  if (fixed.max === undefined) hi = tidy(Math.ceil(hi / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) ticks.push(tidy(i * step));
  return { domain: [lo, hi], ticks, decimals: stepDecimals(step) };
}

/* ------------------------------------------------------------------ time ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type TimeUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

interface Interval {
  unit: TimeUnit;
  n: number;
  /** Rough length, for choosing. */
  ms: number;
}

const INTERVALS: Interval[] = [
  ...[1, 5, 10, 15, 30].map((n) => ({ unit: 'minute' as const, n, ms: n * MINUTE })),
  ...[1, 2, 3, 6, 12].map((n) => ({ unit: 'hour' as const, n, ms: n * HOUR })),
  ...[1, 2, 7].map((n) => ({ unit: 'day' as const, n, ms: n * DAY })),
  ...[1, 2, 3, 6].map((n) => ({ unit: 'month' as const, n, ms: n * 30.44 * DAY })),
  ...[1, 2, 5, 10, 20, 50, 100].map((n) => ({ unit: 'year' as const, n, ms: n * 365.25 * DAY })),
];

/** The shortest calendar step that gives at most `count` labels across `span` ms. */
export function timeInterval(span: number, count: number): Interval {
  return INTERVALS.find((i) => span / i.ms <= Math.max(1, count)) ?? INTERVALS[INTERVALS.length - 1];
}

/** Milliseconds to add to a UTC time to get the wall-clock time in a zone. */
export type Offset = (t: number) => number;

const localOffset: Offset = (t) => -new Date(t).getTimezoneOffset() * MINUTE;

/** The offset function for an IANA zone, or the browser's own when none (or an unknown one) is given. */
export function zoneOffset(timeZone?: string): Offset {
  if (!timeZone) return localOffset;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return localOffset;
  }
  return (t) => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(t)) p[part.type] = Number(part.value);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return wall - Math.floor(t / 1000) * 1000;
  };
}

/** The UTC time showing wall-clock time `wall`: right everywhere but inside a clock change. */
function fromWall(wall: number, offset: Offset): number {
  return wall - offset(wall - offset(wall));
}

/** Wall-clock ticks from `first`, `next` stepping on, converted back to real times inside `range`. */
function collect(range: Range, offset: Offset, first: number, next: (wall: number) => number): number[] {
  const out: number[] = [];
  const endWall = range.end + offset(range.end);
  for (let wall = first, guard = 0; wall <= endWall && guard < 1000; wall = next(wall), guard++) {
    const t = fromWall(wall, offset);
    if (t >= range.start && t <= range.end && t !== out[out.length - 1]) out.push(t);
  }
  return out;
}

/**
 * Times for the axis labels across `range`, on round wall-clock boundaries in the zone `offset`
 * describes: every few minutes or hours (aligned to midnight), midnights, Mondays, the first of
 * a month, or new year.
 */
export function timeTicks(
  range: Range,
  count: number,
  offset: Offset = localOffset,
): { unit: TimeUnit; ticks: number[] } {
  const { unit, n } = timeInterval(range.end - range.start, count);
  const startWall = range.start + offset(range.start);
  if (unit === 'minute' || unit === 'hour' || (unit === 'day' && n !== 7)) {
    const step = n * (unit === 'minute' ? MINUTE : unit === 'hour' ? HOUR : DAY);
    // Hours and minutes align to midnight; whole days align to midnight too, being multiples of a day.
    const first = Math.ceil(startWall / step) * step;
    return { unit, ticks: collect(range, offset, first, (w) => w + step) };
  }
  if (unit === 'day') {
    // Weeks start on Monday. Day 0 of the epoch was a Thursday, so Mondays are days 4, 11, …
    const day = Math.ceil(startWall / DAY);
    const monday = day + ((((4 - day) % 7) + 7) % 7);
    return { unit, ticks: collect(range, offset, monday * DAY, (w) => w + 7 * DAY) };
  }
  const d = new Date(startWall);
  if (unit === 'month') {
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    if (Date.UTC(y, m) < startWall) m += 1;
    m = Math.ceil(m / n) * n;
    y += Math.floor(m / 12);
    m %= 12;
    const next = (w: number) => {
      const x = new Date(w);
      return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n);
    };
    return { unit, ticks: collect(range, offset, Date.UTC(y, m), next) };
  }
  let y = d.getUTCFullYear();
  if (Date.UTC(y, 0) < startWall) y += 1;
  y = Math.ceil(y / n) * n;
  return { unit, ticks: collect(range, offset, Date.UTC(y, 0), (w) => Date.UTC(new Date(w).getUTCFullYear() + n, 0)) };
}

/** The zone a user sees times in: Home Assistant's server zone when their profile asks for it. */
export function timeZoneOf(hass?: HomeAssistant): string | undefined {
  return hass?.locale?.time_zone === 'server' ? hass.config?.time_zone : undefined;
}

/** 12- or 24-hour clock from the user's profile; undefined follows their language. */
export function hour12Of(hass?: HomeAssistant): boolean | undefined {
  const f = hass?.locale?.time_format;
  return f === '12' ? true : f === '24' ? false : undefined;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(language: string, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  const k = `${language}|${timeZone}|${JSON.stringify(opts)}`;
  let f = formatters.get(k);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(language, { ...opts, timeZone });
    } catch {
      f = new Intl.DateTimeFormat(undefined, opts);
    }
    formatters.set(k, f);
  }
  return f;
}

/** A clock time, in the user's language, clock and zone. */
export function formatTime(t: number, hass?: HomeAssistant, seconds = false): string {
  return formatter(hass?.locale?.language ?? 'en', timeZoneOf(hass), {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: hour12Of(hass),
  }).format(t);
}

/** A date with a clock time, for a tooltip: "Tue 29 Oct, 14:05". */
export function formatDateTime(t: number, hass?: HomeAssistant): string {
  return formatter(hass?.locale?.language ?? 'en', timeZoneOf(hass), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: hour12Of(hass),
  }).format(t);
}

/**
 * The text under one time tick. Clock times for short spans (with the day's name at midnight),
 * day names for a week or less, day and month beyond that, month names (with the year in
 * January), and years.
 */
export function timeLabel(t: number, unit: TimeUnit, span: number, hass?: HomeAssistant, offset?: Offset): string {
  const language = hass?.locale?.language ?? 'en';
  const zone = timeZoneOf(hass);
  const wall = t + (offset ?? zoneOffset(zone))(t);
  const at = new Date(wall);
  const midnight = wall % DAY === 0;
  switch (unit) {
    case 'minute':
    case 'hour':
      return midnight ? formatter(language, zone, { weekday: 'short' }).format(t) : formatTime(t, hass);
    case 'day':
      return span <= 7 * DAY
        ? formatter(language, zone, { weekday: 'short' }).format(t)
        : formatter(language, zone, { day: 'numeric', month: 'short' }).format(t);
    case 'month':
      return formatter(
        language,
        zone,
        at.getUTCMonth() === 0 ? { month: 'short', year: 'numeric' } : { month: 'short' },
      ).format(t);
    default:
      return formatter(language, zone, { year: 'numeric' }).format(t);
  }
}
