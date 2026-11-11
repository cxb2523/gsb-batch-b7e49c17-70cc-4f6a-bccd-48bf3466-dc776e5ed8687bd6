import { groupHistory, groupStatistics } from '../history/group';
import type { Aggregate } from '../history/group';
import type { Point, Source } from '../history/types';

/**
 * Open, high, low and close for each period, from history (a reading holds until the next) or
 * from long-term statistics rows (each an hour or five minutes, with its own mean, min and max).
 */

export interface Candle {
  /** Where the period starts and ends. */
  t: number;
  end: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Candles from history. Open is the value held as the period began (carried in from before it),
 * close the last value in it, high and low every value that held in it. A period with nothing
 * known, or one that starts after `until` (now), has no candle (null).
 */
export function historyCandles(points: Point[], bounds: number[], until: number): (Candle | null)[] {
  const of = (aggregate: Aggregate) => groupHistory(points, bounds, aggregate, until);
  const [open, high, low, close] = (['first', 'max', 'min', 'last'] as const).map(of);
  return open.map((g, i) => {
    if (g.v === null || high[i].v === null || low[i].v === null || close[i].v === null) return null;
    return { t: g.t, end: g.end ?? g.t, open: g.v, high: high[i].v!, low: low[i].v!, close: close[i].v! };
  });
}

/**
 * Candles from statistics rows: open is the first row's value (its mean, or its state for a
 * sensor without one), close the last row's, high and low the highest max and lowest min (each
 * row's value where it has none). A row moved to the range's start belongs to the period before.
 */
export function statisticsCandles(rows: Point[], bounds: number[], until: number): (Candle | null)[] {
  const out: (Candle | null)[] = [];
  let j = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    while (j < rows.length && rows[j].t < start) j++;
    let candle: Candle | null = null;
    for (let k = j; k < rows.length && rows[k].t < end; k++) {
      const r = rows[k];
      if (r.v === null || r.carried || start >= until) continue;
      const hi = typeof r.max === 'number' ? Math.max(r.max, r.v) : r.v;
      const lo = typeof r.min === 'number' ? Math.min(r.min, r.v) : r.v;
      if (!candle) candle = { t: start, end, open: r.v, high: hi, low: lo, close: r.v };
      else {
        candle.high = Math.max(candle.high, hi);
        candle.low = Math.min(candle.low, lo);
        candle.close = r.v;
      }
    }
    out.push(candle);
  }
  return out;
}

/**
 * One value per period for a series drawn under the candles (usage, a second price): grouped
 * with `aggregate` as the line chart would. Statistics rows of a meter carry its reading, so its
 * sum or change is how far that reading rose (resets handled), not the rows added up.
 */
export function underValues(
  points: Point[],
  bounds: number[],
  aggregate: Aggregate,
  source: Source,
  until: number,
): Point[] {
  if (source === 'history') return groupHistory(points, bounds, aggregate, until);
  if (aggregate === 'sum' || aggregate === 'change') return groupHistory(points, bounds, 'change', until);
  return groupStatistics(points, bounds, aggregate, until);
}

/** Lowest low and highest high, or undefined with no candles. */
export function candleExtent(candles: (Candle | null)[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (!c) continue;
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  return lo === Infinity ? undefined : [lo, hi];
}
