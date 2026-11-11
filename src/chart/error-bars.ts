import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import type { Aggregate } from '../history/group';
import type { Point } from '../history/types';
import type { CardConfig } from '../types';
import { VIEW_H, VIEW_W } from './frame';
import type { PlotScales } from './grid';

/*
 * Error bars on grouped columns: a whisker over each column showing how much the readings inside
 * its group spread.
 *
 * - std: the mean ± one standard deviation of the readings that held in the group, each weighted
 *   by how long it held (the same weighting as the column's mean, so the whisker is centred on it).
 * - ci95: the mean ± 1.96 × std / √n, n the readings in the group: a rough 95 % confidence
 *   interval for the mean. Sensor readings follow on from each other, so it is narrower than an
 *   honest one; it is there to compare groups, not for statistics homework.
 * - min_max: the lowest and highest value that held in the group.
 *
 * Long-term statistics: each hourly row counts as one reading (its mean), so the chart loads
 * hourly rows and groups them itself; min_max uses the rows' own lows and highs. A whisker never
 * reaches past the lowest or highest reading, so a spread can't push a positive column below zero.
 *
 * Whiskers belong to a group's spread around its mean, so std and ci95 draw only on mean columns,
 * min_max on mean, min, max, first and last ones; columns that add up (sum, change) get none.
 */

export const ERROR_BARS = ['none', 'std', 'min_max', 'ci95'] as const;
export type ErrorBars = (typeof ERROR_BARS)[number];

/** Aggregates each kind of whisker makes sense on. */
const FITS: Record<Exclude<ErrorBars, 'none'>, readonly Aggregate[]> = {
  std: ['mean'],
  ci95: ['mean'],
  min_max: ['mean', 'min', 'max', 'first', 'last'],
};

export interface Whisker {
  lo: number;
  hi: number;
}

/** A value that held in a group, and for how long (ms; statistics rows count 1 each). */
export interface Held {
  v: number;
  dt: number;
  min?: number;
  max?: number;
}

/** Check `error_bars`. Throws a readable error. */
export function validateErrorBars(raw: CardConfig): void {
  if (raw.error_bars !== undefined && !ERROR_BARS.includes(raw.error_bars as ErrorBars)) {
    throw new Error(`"error_bars" must be one of: ${ERROR_BARS.join(', ')}`);
  }
}

/** The card's error bars, or undefined when off. */
export function errorBarsOf(raw: CardConfig): Exclude<ErrorBars, 'none'> | undefined {
  const mode = raw.error_bars as ErrorBars | undefined;
  return mode && mode !== 'none' ? mode : undefined;
}

/** Whether whiskers of this kind fit a column of this aggregate. */
export function fitsAggregate(mode: Exclude<ErrorBars, 'none'>, aggregate: Aggregate): boolean {
  return FITS[mode].includes(aggregate);
}

/**
 * The values that held from `start` to `end` in history (a reading holds until the next one):
 * the one carried in from before, then each reading taken, nothing past `until` (now). Gaps
 * count for nothing.
 */
export function heldInHistory(points: readonly Point[], start: number, end: number, until: number): Held[] {
  const stop = Math.min(end, until);
  if (!(stop > start)) return [];
  let j = 0;
  while (j < points.length && points[j].t < start) j++;
  const out: Held[] = [];
  const before = points[j - 1];
  const firstAt = j < points.length && points[j].t < stop ? points[j].t : stop;
  if (before && before.v !== null && firstAt > start) out.push({ v: before.v, dt: firstAt - start });
  for (let k = j; k < points.length && points[k].t < stop; k++) {
    const next = k + 1 < points.length && points[k + 1].t < stop ? points[k + 1].t : stop;
    const v = points[k].v;
    if (v !== null) out.push({ v, dt: next - points[k].t });
  }
  return out;
}

/** Statistics rows starting from `start` to `end`, each one reading. A row moved to the start is the one before. */
export function heldInStatistics(rows: readonly Point[], start: number, end: number): Held[] {
  return rows
    .filter((r) => r.t >= start && r.t < end && r.v !== null && !r.carried)
    .map((r) => ({ v: r.v!, dt: 1, min: r.min ?? undefined, max: r.max ?? undefined }));
}

/** The whisker for what held in a group; null with nothing in it (or one reading, for std and ci95). */
export function whiskerOf(held: readonly Held[], mode: Exclude<ErrorBars, 'none'>): Whisker | null {
  if (!held.length) return null;
  const low = Math.min(...held.map((h) => h.min ?? h.v));
  const high = Math.max(...held.map((h) => h.max ?? h.v));
  if (mode === 'min_max') return { lo: low, hi: high };
  if (held.length < 2) return null;
  const time = held.reduce((a, h) => a + h.dt, 0);
  const weight = (h: Held) => (time > 0 ? h.dt / time : 1 / held.length);
  const mean = held.reduce((a, h) => a + h.v * weight(h), 0);
  const sd = Math.sqrt(held.reduce((a, h) => a + (h.v - mean) ** 2 * weight(h), 0));
  const half = mode === 'std' ? sd : (1.96 * sd) / Math.sqrt(held.length);
  return { lo: Math.max(low, mean - half), hi: Math.min(high, mean + half) };
}

/**
 * Each slot's whisker for one series: `times` and `ends` are the groups, `readings` the series'
 * readings as loaded. History groups stop at `until` (now).
 */
export function whiskersFor(
  readings: readonly Point[],
  times: readonly number[],
  ends: readonly number[],
  mode: Exclude<ErrorBars, 'none'>,
  statistics: boolean,
  until: number,
): (Whisker | null)[] {
  return times.map((t, i) =>
    whiskerOf(statistics ? heldInStatistics(readings, t, ends[i]) : heldInHistory(readings, t, ends[i], until), mode),
  );
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 10000) / 100}%`;
const clampY = (y: number) => Math.min(VIEW_H, Math.max(0, y));

/** A whisker over a column whose middle is at `x` (plot units), its caps `width` plot units wide. */
export function whiskerMark(scales: PlotScales, x: number, width: number, w: Whisker): TemplateResult {
  const top = clampY(scales.y(w.hi));
  const bottom = clampY(scales.y(w.lo));
  return html`<div
    class="whisker-bar"
    style="left:${pct(x, VIEW_W)};width:${pct(width, VIEW_W)};top:${pct(top, VIEW_H)};height:${pct(
      bottom - top,
      VIEW_H,
    )}"
  ></div>`;
}

export const errorBarStyles = css`
  /* Caps top and bottom, the stem down the middle; caps at most 14 px wide. */
  .whisker-bar {
    position: absolute;
    box-sizing: border-box;
    max-width: 14px;
    transform: translateX(-50%);
    border-top: 1.5px solid var(--primary-text-color);
    border-bottom: 1.5px solid var(--primary-text-color);
    opacity: 0.8;
    animation: cd-whisker-in var(--cd-duration) var(--cd-easing);
  }
  .whisker-bar::before {
    content: '';
    position: absolute;
    left: calc(50% - 0.75px);
    top: 0;
    bottom: 0;
    border-left: 1.5px solid var(--primary-text-color);
  }
  :host([static]) .whisker-bar {
    animation: none;
  }
  @keyframes cd-whisker-in {
    from {
      opacity: 0;
    }
  }
`;
