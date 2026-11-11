import { wallTime } from '../history/timezone';
import type { Zone } from '../history/timezone';
import type { Point } from '../history/types';
import { weekCells } from './heatmap-grid';

/**
 * The maths behind the cycle plot: readings folded into one small panel per part of a cycle
 * (each weekday, each hour of the day, each day of the month), each panel a short line of values.
 * No drawing here.
 *
 * - day_of_week: a panel per weekday, its line the average of each hour of that day over the
 *   span (every Monday 8:00 averaged into one point). Reads one-hour groups.
 * - hour_of_day: a panel per hour of the day, its line that hour on each day of the span in turn
 *   (Cleveland's cycle plot): how 7:00 drifts through the weeks. Reads one-hour groups.
 * - day_of_month: a panel per day of the month, its line that day in each month of the span.
 *   Reads one-day groups.
 *
 * All by the wall clock in the card's time zone.
 */

export const CYCLES = ['day_of_week', 'hour_of_day', 'day_of_month'] as const;
export type Cycle = (typeof CYCLES)[number];

/** One panel: a value per slot (null where nothing was read), in order. */
export interface CyclePanel {
  /** The panel's part of the cycle: weekday row (0 is the zone's first day), hour (0–23), or day of month (1–31). */
  key: number;
  values: (number | null)[];
}

export interface CycleData {
  panels: CyclePanel[];
  /** Slots along each panel: 24 hours, or the days (months) in the span. */
  slots: number;
  /**
   * Hour of day / day number / month number of slot 0, so a slot can be named: for hour_of_day
   * the first day (days since 1 Jan 1970), for day_of_month the first month (year × 12 + month − 1).
   */
  first: number;
}

const DAY_MS = 86_400_000;

function dayNumber(t: number, timeZone: string): number {
  const w = wallTime(t, timeZone);
  return Math.round(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);
}

function monthNumber(t: number, timeZone: string): number {
  const w = wallTime(t, timeZone);
  return w.year * 12 + w.month - 1;
}

/** Fold the slot values of each panel, averaging two readings that land in one slot. */
function fold(cells: { panel: number; slot: number; v: number }[], keys: number[], slots: number): CyclePanel[] {
  const sums = keys.map(() => new Array<number>(slots).fill(0));
  const counts = keys.map(() => new Array<number>(slots).fill(0));
  for (const c of cells) {
    if (c.slot < 0 || c.slot >= slots) continue;
    sums[c.panel][c.slot] += c.v;
    counts[c.panel][c.slot] += 1;
  }
  return keys.map((key, i) => ({
    key,
    values: sums[i].map((s, k) => (counts[i][k] ? s / counts[i][k] : null)),
  }));
}

/**
 * Grouped readings (`points`, one per hour or per day, gaps as null) folded into the cycle's
 * panels. `range` is the span drawn: it sets how many days (months) the panels run across.
 */
export function cycleData(points: Point[], cycle: Cycle, zone: Zone, range: { start: number; end: number }): CycleData {
  const tz = zone.timeZone;
  if (cycle === 'day_of_week') {
    const cells = weekCells(points, zone);
    return {
      panels: [0, 1, 2, 3, 4, 5, 6].map((row) => ({
        key: row,
        values: cells.slice(row * 24, row * 24 + 24).map((c) => c.v),
      })),
      slots: 24,
      first: 0,
    };
  }
  const known = points.filter((p): p is Point & { v: number } => p.v !== null);
  // The span's last instant, not its end: a span ending at midnight doesn't reach the next day.
  const last = Math.max(range.start, range.end - 1);
  if (cycle === 'hour_of_day') {
    const first = dayNumber(range.start, tz);
    const slots = dayNumber(last, tz) - first + 1;
    const cells = known.map((p) => ({ panel: wallTime(p.t, tz).hour, slot: dayNumber(p.t, tz) - first, v: p.v }));
    return {
      panels: fold(
        cells,
        Array.from({ length: 24 }, (_, h) => h),
        slots,
      ),
      slots,
      first,
    };
  }
  const first = monthNumber(range.start, tz);
  const slots = monthNumber(last, tz) - first + 1;
  const cells = known.map((p) => ({ panel: wallTime(p.t, tz).day - 1, slot: monthNumber(p.t, tz) - first, v: p.v }));
  return {
    panels: fold(
      cells,
      Array.from({ length: 31 }, (_, d) => d + 1),
      slots,
    ),
    slots,
    first,
  };
}

/** The plain average of a panel's known values, or undefined when it has none. */
export function panelMean(values: (number | null)[]): number | undefined {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, v) => a + v, 0) / known.length : undefined;
}

/**
 * Columns for `count` panels on a card `width` px wide, each at least `minPx`: every panel in a
 * row when they fit, else the most that fit, evened out so the last row isn't a lone panel.
 */
export function cycleColumns(count: number, width: number, minPx: number, gap = 4): number {
  const fit = Math.max(1, Math.floor((width + gap) / (minPx + gap)));
  if (fit >= count) return count;
  const rows = Math.ceil(count / fit);
  return Math.ceil(count / rows);
}
