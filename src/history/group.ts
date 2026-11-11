import type { CardConfig } from '../types';
import type { StatisticField, StatisticsPeriod, StatisticsQuery } from './fetch';
import type { Zone } from './timezone';
import type { Point } from './types';

/**
 * Grouping: one value per hour, day, week or month, combined from the readings in it. Groups
 * follow the calendar in the card's time zone (see `boundaries` in timezone.ts), and a group with
 * nothing in it is a gap (`v: null`), never zero.
 */

export const GROUP_UNITS = ['hour', 'day', 'week', 'month'] as const;
export type GroupUnit = (typeof GROUP_UNITS)[number];

export const AGGREGATES = ['mean', 'sum', 'min', 'max', 'first', 'last', 'change'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export interface Grouping {
  unit: GroupUnit;
  aggregate: Aggregate;
}

/** `group_by` and `aggregate` from YAML. No `group_by`, no grouping. Throws a readable error. */
export function parseGrouping(raw: CardConfig): Grouping | undefined {
  if (raw.aggregate !== undefined && !AGGREGATES.includes(raw.aggregate as Aggregate)) {
    throw new Error(`"aggregate" must be one of: ${AGGREGATES.join(', ')}`);
  }
  if (raw.group_by === undefined) return undefined;
  if (!GROUP_UNITS.includes(raw.group_by as GroupUnit)) {
    throw new Error(`"group_by" must be one of: ${GROUP_UNITS.join(', ')}`);
  }
  return { unit: raw.group_by as GroupUnit, aggregate: (raw.aggregate as Aggregate | undefined) ?? 'mean' };
}

/**
 * How much a meter went up at each reading (null at a gap). A meter that only counts up can be
 * reset to zero (a new device, a counter that wraps): a drop of more than a tenth is taken as a
 * reset, and the new reading counts as what was used since. A smaller drop is noise (a meter that
 * reads 1000.1, then 1000.0): it is ignored and the higher reading kept as the baseline, so the
 * same energy isn't counted twice when it climbs back.
 */
export function increments(points: Point[]): (number | null)[] {
  let base: number | null = null;
  return points.map((p) => {
    if (p.v === null) return null;
    if (base === null) {
      base = p.v;
      return 0;
    }
    if (p.v >= base) {
      const up = p.v - base;
      base = p.v;
      return up;
    }
    if (base - p.v > Math.abs(base) * 0.1) {
      base = p.v;
      return Math.max(0, p.v);
    }
    return 0;
  });
}

/**
 * Group history (a reading holds until the next one) into one point per group. `bounds` are the
 * group boundaries (each start, then the last end). Nothing is known past `until` (now), so a
 * group starting after it is a gap and the current one counts only up to it.
 *
 * - mean: time-weighted. History records changes, not samples: a sensor that sat at 20 all day and
 *   flickered to 30 ten times in a minute has eleven readings, ten of them 30. A plain mean says
 *   29; weighting each reading by how long it held says 20, which is what the room was. It is
 *   also how Home Assistant's long-term statistics compute their mean, so history and statistics
 *   agree. Time spent unavailable doesn't count either way.
 * - min / max: of every value that held during the group, including the one carried in.
 * - first / last: the value at the start of the group (carried in) and the last one in it.
 * - sum: of the readings taken in the group, for sensors that report an amount each time.
 * - change: how much a meter went up in the group, resets handled (see `increments`). A rise
 *   counts in the group where the reading that shows it was taken, as in Home Assistant's own.
 *
 * A group with no value held at any time in it is a gap. For sum, a group with no readings is.
 */
export function groupHistory(
  points: Point[],
  bounds: number[],
  aggregate: Aggregate,
  until: number,
  range = false,
): Point[] {
  const ups = aggregate === 'change' ? increments(points) : [];
  const out: Point[] = [];
  // Index of the first point at or after the group's start.
  let j = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const stop = Math.min(end, until);
    while (j < points.length && points[j].t < start) j++;
    const group: Point = { t: start, end, v: null };
    out.push(group);
    if (stop <= start) continue;
    // Each value that held in the group, with how long it held.
    const held: { v: number | null; dt: number; reading: boolean; carried: boolean; up: number | null }[] = [];
    const before = points[j - 1];
    let k = j;
    const firstAt = k < points.length && points[k].t < stop ? points[k].t : stop;
    if (before && firstAt > start)
      held.push({ v: before.v, dt: firstAt - start, reading: false, carried: true, up: 0 });
    for (; k < points.length && points[k].t < stop; k++) {
      const next = k + 1 < points.length && points[k + 1].t < stop ? points[k + 1].t : stop;
      const p = points[k];
      held.push({ v: p.v, dt: next - p.t, reading: true, carried: p.carried === true, up: ups[k] ?? null });
    }
    const known = held.filter((h) => h.v !== null) as {
      v: number;
      dt: number;
      reading: boolean;
      carried: boolean;
      up: number | null;
    }[];
    if (known.length === 0) continue;
    const values = known.map((h) => h.v);
    if (range) {
      // The group's spread, for range charts: every value that held in it.
      group.min = Math.min(...values);
      group.max = Math.max(...values);
    }
    switch (aggregate) {
      case 'mean': {
        const time = known.reduce((a, h) => a + h.dt, 0);
        group.v =
          time > 0
            ? known.reduce((a, h) => a + h.v * h.dt, 0) / time
            : values.reduce((a, v) => a + v, 0) / values.length;
        break;
      }
      case 'min':
        group.v = Math.min(...values);
        break;
      case 'max':
        group.v = Math.max(...values);
        break;
      case 'first':
        group.v = values[0];
        break;
      case 'last':
        group.v = values[values.length - 1];
        break;
      case 'sum': {
        const taken = known.filter((h) => h.reading && !h.carried);
        group.v = taken.length ? taken.reduce((a, h) => a + h.v, 0) : null;
        break;
      }
      case 'change':
        group.v = known.reduce((a, h) => a + (h.reading && !h.carried ? (h.up ?? 0) : 0), 0);
        break;
    }
  }
  return out;
}

/**
 * Group long-term statistics rows (each already one period: an hour, a day …) into one point per
 * group. Rows of equal length, so the mean of means is the time-weighted mean. Sum and change add
 * up the rows' change; first is the state at the end of the row before the group (the meter's
 * reading at the group's start), or the group's first row when there is none. A group that starts
 * after `until` (now) is a gap whatever the server sent.
 */
export function groupStatistics(
  rows: Point[],
  bounds: number[],
  aggregate: Aggregate,
  until = Infinity,
  range = false,
): Point[] {
  const out: Point[] = [];
  let j = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    while (j < rows.length && rows[j].t < start) j++;
    let k = j;
    const values: number[] = [];
    const lows: number[] = [];
    const highs: number[] = [];
    // A row moved to the range's start is the previous period's: only `first` wants it.
    for (; k < rows.length && rows[k].t < end; k++) {
      const row = rows[k];
      if (row.v === null || row.carried) continue;
      values.push(row.v);
      lows.push(row.min ?? row.v);
      highs.push(row.max ?? row.v);
    }
    let v: number | null = null;
    if (values.length && start < until) {
      if (aggregate === 'mean') v = values.reduce((a, x) => a + x, 0) / values.length;
      else if (aggregate === 'sum' || aggregate === 'change') v = values.reduce((a, x) => a + x, 0);
      else if (aggregate === 'min') v = Math.min(...values);
      else if (aggregate === 'max') v = Math.max(...values);
      else if (aggregate === 'last') v = values[values.length - 1];
      else {
        const prior = rows
          .slice(0, j)
          .reverse()
          .find((r) => r.v !== null);
        const carried = rows.slice(j, k).find((r) => r.carried && r.v !== null);
        v = (prior ?? carried)?.v ?? values[0];
      }
    }
    const group: Point = { t: start, end, v };
    // The group's spread, for range charts: lowest of the rows' lows to highest of their highs.
    if (range && v !== null) {
      group.min = Math.min(...lows);
      group.max = Math.max(...highs);
    }
    out.push(group);
  }
  return out;
}

/** Roughly how long a statistics row is (for asking from one row earlier). */
export const PERIOD_MS: Record<StatisticsPeriod, number> = {
  '5minute': 5 * 60_000,
  hour: 3_600_000,
  day: 25 * 3_600_000,
  week: 8 * 86_400_000,
  month: 32 * 86_400_000,
};

const COLUMNS: Record<Aggregate, { types: StatisticField[]; value: StatisticField }> = {
  mean: { types: ['mean'], value: 'mean' },
  min: { types: ['min'], value: 'min' },
  max: { types: ['max'], value: 'max' },
  first: { types: ['state', 'mean'], value: 'state' },
  last: { types: ['state', 'mean'], value: 'state' },
  sum: { types: ['change'], value: 'change' },
  change: { types: ['change'], value: 'change' },
};

/**
 * What to ask the recorder for when grouping statistics. The server cuts its days, weeks and
 * months in its own time zone with weeks from Monday; when the card's calendar is the same, ask
 * for rows of the group's length and each row is a group. Otherwise ask for hours and group them
 * here, so a browser in another zone, or a week from Sunday, still gets its own calendar.
 * Meters give their change (sum, change) or state (first, last); measurements their mean, min
 * or max.
 */
export function statisticsQueryFor(
  grouping: Grouping,
  zone: Zone,
  serverTimeZone: string | undefined,
  range = false,
): StatisticsQuery {
  const sameCalendar = zone.timeZone === serverTimeZone && (grouping.unit !== 'week' || zone.firstDay === 1);
  const period: StatisticsPeriod = grouping.unit === 'hour' || !sameCalendar ? 'hour' : grouping.unit;
  const { types, value } = COLUMNS[grouping.aggregate];
  // A range chart also wants each row's lowest and highest.
  const wanted: StatisticField[] = range ? [...new Set<StatisticField>([...types, 'min', 'max'])] : types;
  return { period, types: wanted, value };
}
