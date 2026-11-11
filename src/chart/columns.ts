import type { ResolvedEntity } from '../resolve';
import { parsePeriod } from '../history/period';
import type { Period } from '../history/period';
import type { GroupUnit } from '../history/group';
import type { Point } from '../history/types';
import type { CardConfig } from '../types';
import { valueAt } from './stack';

/**
 * Column maths: which grouping a column chart uses when none is set, how readings line up into
 * slots (one per group, or per reading), and where each series' column sits in its slot.
 */

/** Grouping choices a column chart offers: `auto` picks one for the span, `none` draws each reading. */
export const COLUMN_GROUPS = ['auto', 'none', 'hour', 'day', 'week', 'month'] as const;
export const COLUMN_AGGREGATES = ['auto', 'mean', 'sum', 'min', 'max', 'first', 'last', 'change'] as const;

/** A column chart with no period shows the last 7 days: with automatic grouping, a column a day. */
export const COLUMN_PERIOD = { last: 7, unit: 'day' } as const;

const PERIOD_DAYS = { hour: 1 / 24, day: 1, week: 7, month: 30 } as const;

/**
 * The group a span reads best in: hours for up to two days, days up to about two months, weeks
 * up to half a year, then months. Calendar spans: today by hour, a week or month by day, a year
 * by month.
 */
export function autoGroupUnit(period: Period): GroupUnit {
  if (period.calendar) return ({ day: 'hour', week: 'day', month: 'day', year: 'month' } as const)[period.calendar];
  const days = period.last * PERIOD_DAYS[period.unit];
  if (days <= 2) return 'hour';
  if (days <= 62) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}

/** A meter that counts up (energy, water, gas): its columns should show how much it went up. */
export function isMeter(e: ResolvedEntity): boolean {
  if (e.config.attribute) return false;
  // Drawn as its rate of change, a meter reads like any measurement.
  if ((e.config as { transform?: string }).transform === 'derivative') return false;
  const stateClass = e.stateObj?.attributes?.state_class;
  return stateClass === 'total_increasing' || stateClass === 'total';
}

/**
 * The card config the shared history frame should read: the column chart's own defaults filled
 * in. No period means the last 7 days; `group_by` auto (or unset) picks a unit for the span, and
 * `none` draws one column per reading; `aggregate` auto (or unset) is the change of meters when
 * every entity is one (energy per day), else the average. Range columns always use the average.
 */
export function columnRaw(raw: CardConfig, items: readonly ResolvedEntity[]): CardConfig {
  const out: Record<string, unknown> = { ...raw, period: raw.period ?? { ...COLUMN_PERIOD } };
  if (raw.group_by === 'none') {
    delete out.group_by;
  } else if (raw.group_by === undefined || raw.group_by === 'auto') {
    out.group_by = autoGroupUnit(parsePeriod(out.period as CardConfig['period']));
  }
  if (raw.aggregate === undefined || raw.aggregate === 'auto') {
    out.aggregate = raw.range !== true && items.length > 0 && items.every(isMeter) ? 'change' : 'mean';
  }
  return out as CardConfig;
}

/** Every series' readings at one shared set of slots. */
export interface ColumnTable {
  /** Slot starts, in order. */
  times: number[];
  /** Where each slot ends (the next slot's start, a group's end, or the range's end). */
  ends: number[];
  /** Per series, its value in each slot: its reading then, or the one it held. */
  values: (number | null)[][];
  /** Per series, each slot's lowest and highest (statistics, or a grouped range); null if unknown. */
  lows: (number | null)[][];
  highs: (number | null)[][];
}

/**
 * Line series up into slots. Grouped points already share their times; readings that don't are
 * read at every time any series has one (a value holds until it changes). A slot ends at its
 * group's end, else at the next slot, else at `end`; one with no width (the reading carried to
 * the right edge) is dropped.
 */
export function columnTable(series: readonly (readonly Point[])[], end: number): ColumnTable {
  const all = [...new Set(series.flatMap((points) => points.map((p) => p.t)))].sort((a, b) => a - b);
  const exact = series.map((points) => new Map(points.map((p) => [p.t, p])));
  const groupEnd = new Map<number, number>();
  for (const points of series) for (const p of points) if (p.end !== undefined) groupEnd.set(p.t, p.end);
  const table: ColumnTable = {
    times: [],
    ends: [],
    values: series.map(() => []),
    lows: series.map(() => []),
    highs: series.map(() => []),
  };
  all.forEach((t, i) => {
    const slotEnd = Math.min(groupEnd.get(t) ?? all[i + 1] ?? end, end);
    if (!(slotEnd > t)) return;
    table.times.push(t);
    table.ends.push(slotEnd);
    series.forEach((points, k) => {
      const p = exact[k].get(t);
      table.values[k].push(p ? p.v : valueAt(points, t));
      table.lows[k].push(p?.min ?? null);
      table.highs[k].push(p?.max ?? null);
    });
  });
  return table;
}

/** Share of a slot left empty, split either side, so neighbouring slots don't touch. */
export const SLOT_GAP = 0.2;
/** Share of a series' column width left between columns side by side in one slot. */
export const SERIES_GAP = 0.12;

/**
 * Where column `k` of `n` side by side sits in a slot from `x0` to `x1` (plot units): its left
 * edge and width. One column (or a stack) takes the slot's middle 80 %.
 */
export function columnBox(x0: number, x1: number, k: number, n: number): [left: number, width: number] {
  const w = x1 - x0;
  const inner = w * (1 - SLOT_GAP);
  const each = inner / n;
  const pad = n > 1 ? each * SERIES_GAP : 0;
  return [x0 + (w * SLOT_GAP) / 2 + k * each + pad / 2, each - pad];
}

/**
 * Value-axis ends to fix so columns stand on zero: readings all at or above zero start the axis
 * at zero, all at or below end it there. Ends the user set always win.
 */
export function zeroBased(data: [number, number], raw: CardConfig): CardConfig {
  const out: Record<string, unknown> = { ...raw };
  if (raw.y_min === undefined && data[0] >= 0) out.y_min = 0;
  if (raw.y_max === undefined && data[1] <= 0) out.y_max = 0;
  return out as CardConfig;
}

/** Lowest and highest of some numbers (nulls skipped), with zero in unless `zero` is false. */
export function spread(values: Iterable<number | null>, zero = true): [number, number] | undefined {
  let lo = zero ? 0 : Infinity;
  let hi = zero ? 0 : -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/** The time labels to keep so about `fit` of `count` show: every first, every second, … */
export function labelEvery(count: number, fit: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, fit)));
}
