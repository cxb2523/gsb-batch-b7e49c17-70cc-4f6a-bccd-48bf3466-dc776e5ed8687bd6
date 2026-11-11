import { startOf, wallTime } from '../history/timezone';
import type { Zone } from '../history/timezone';
import type { Point } from '../history/types';

/**
 * The maths behind the heatmap: hourly groups folded into a week of hours, daily groups laid out
 * as a calendar, and where a value sits on the colour scale. No drawing here.
 */

/** One cell of a week grid: the mean of every hour that fell in it, and how many there were. */
export interface WeekCell {
  /** Row 0 is the zone's first weekday. */
  row: number;
  /** Hour of the day, 0–23. */
  hour: number;
  v: number | null;
  count: number;
}

/**
 * Fold one-hour groups into 7 × 24 cells by their weekday and hour on the wall clock in `zone`:
 * Tuesday 14:00 collects every Tuesday's 14:00–15:00. A cell is the plain mean of its hours (each
 * hour is already one value, so each counts the same); a cell with no known hour is a gap, not 0.
 * Rows start on the zone's first weekday. The hour the clocks go back happens twice and both
 * count; the hour they skip is a gap that day.
 */
export function weekCells(points: Point[], zone: Zone): WeekCell[] {
  const sums = new Array<number>(7 * 24).fill(0);
  const counts = new Array<number>(7 * 24).fill(0);
  for (const p of points) {
    if (p.v === null) continue;
    const w = wallTime(p.t, zone.timeZone);
    const i = ((w.weekday - zone.firstDay + 7) % 7) * 24 + w.hour;
    sums[i] += p.v;
    counts[i] += 1;
  }
  return sums.map((sum, i) => ({
    row: Math.floor(i / 24),
    hour: i % 24,
    v: counts[i] ? sum / counts[i] : null,
    count: counts[i],
  }));
}

/** One day of a calendar grid. */
export interface DayCell {
  /** The day's start. */
  t: number;
  /** Week column, 0 at the week holding the first day. */
  col: number;
  /** Row 0 is the zone's first weekday. */
  row: number;
  v: number | null;
}

export interface Calendar {
  cells: DayCell[];
  /** Number of week columns. */
  weeks: number;
  /** Where each month starts: its column, and the instant it starts (for its name). */
  months: { col: number; t: number }[];
}

/**
 * Lay one-day groups out as a calendar: a column per week (from the zone's first weekday), a row
 * per weekday, like a contribution graph. Weeks are counted from the first day's week by calendar
 * date, so a 23- or 25-hour day doesn't shift a column. A month is labelled at the column of its
 * first day, or at column 0 for the month the calendar opens in (unless the next month starts
 * within three columns: the two names would overlap).
 */
export function calendarCells(points: Point[], zone: Zone): Calendar {
  if (points.length === 0) return { cells: [], weeks: 0, months: [] };
  const dayNumber = (t: number) => {
    const w = wallTime(t, zone.timeZone);
    return Math.round(Date.UTC(w.year, w.month - 1, w.day) / 86_400_000);
  };
  const firstWeek = dayNumber(startOf('week', points[0].t, zone));
  const cells: DayCell[] = [];
  const months: { col: number; t: number }[] = [];
  let lastMonth = -1;
  for (const p of points) {
    const w = wallTime(p.t, zone.timeZone);
    const col = Math.floor((dayNumber(p.t) - firstWeek) / 7);
    cells.push({ t: p.t, col, row: (w.weekday - zone.firstDay + 7) % 7, v: p.v });
    const month = w.year * 12 + w.month;
    if (month !== lastMonth) {
      if (lastMonth === -1 || w.day === 1) months.push({ col, t: p.t });
      lastMonth = month;
    }
  }
  // The month the calendar opens in has no room for its name when the next starts soon after.
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();
  return { cells, weeks: cells[cells.length - 1].col + 1, months };
}

/**
 * The ends of the colour scale: the lowest and highest known value, or the card's fixed ends where
 * set. Undefined when there are no values. A flat set of values gets a scale of one unit, so every
 * cell shows at full strength rather than dividing by zero.
 */
export function colorExtent(
  values: (number | null)[],
  fixed: { min?: number; max?: number } = {},
): [number, number] | undefined {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0 && (fixed.min === undefined || fixed.max === undefined)) return undefined;
  let lo = fixed.min ?? Math.min(...known);
  let hi = fixed.max ?? Math.max(...known);
  if (hi <= lo) {
    if (fixed.max === undefined) hi = lo + 1;
    else lo = hi - 1;
  }
  return [lo, hi];
}

/** Where `v` sits between the scale's ends, 0–1, clamped. */
export function fraction(v: number, [lo, hi]: [number, number]): number {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/** The lightest shade on the scale, as a percent of the colour mixed into the card's background. */
export const SHADE_FLOOR = 12;

/** A shade of `color` for fraction `f`: from a faint tint (low) to the full colour (high). */
export function shade(color: string, f: number): string {
  const pct = Math.round(SHADE_FLOOR + (100 - SHADE_FLOOR) * f);
  return pct >= 100 ? color : `color-mix(in srgb, ${color} ${pct}%, var(--card-background-color, #fff))`;
}

/** A pointy-topped hexagon centred on (`cx`, `cy`), `w` across its flats. */
export function hexPath(cx: number, cy: number, w: number): string {
  const r = w / Math.sqrt(3);
  const pts = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = ((60 * k - 90) * Math.PI) / 180;
    return `${Math.round((cx + r * Math.cos(a)) * 100) / 100},${Math.round((cy + r * Math.sin(a)) * 100) / 100}`;
  });
  return `M${pts.join('L')}Z`;
}

/** Vertical step between rows of hexagons one unit across: they nest, so less than one. */
export const HEX_ROW = Math.sqrt(3) / 2;
