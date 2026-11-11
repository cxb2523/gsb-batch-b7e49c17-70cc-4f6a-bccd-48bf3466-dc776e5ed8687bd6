import { formatNumber } from '../format';
import type { Point } from '../history/types';
import type { HomeAssistant } from '../types';
import type { ValueAxis } from './axes';

/**
 * A logarithmic value axis. Only readings above zero have a place on it: zero and negatives are
 * left out of the drawing (a gap in the line), though the tooltip still reads them out.
 */

/** Which steps inside each power of ten carry a label, finest first. */
const MANTISSAS = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 5], [1]];
/** With more decades than labels, label every n-th power of ten. */
const DECADE_STEPS = [2, 3, 5, 10, 20, 50, 100];

/** Clean up floating-point fuzz (2 × 0.1 → 0.2, 10 ** -3 → 0.001). */
const tidy = (v: number) => Number(v.toPrecision(12));
const pow = (e: number) => tidy(10 ** e);
const decadeOf = (v: number) => Math.floor(Math.log10(v) + 1e-9);

/** Readings at or below zero as gaps (min and max too), for drawing on a log axis. */
export function positivePoints(points: Point[]): Point[] {
  return points.map((p) => {
    const bad = (v: number | null | undefined) => typeof v === 'number' && v <= 0;
    if (!bad(p.v) && !bad(p.min) && !bad(p.max)) return p;
    return {
      ...p,
      v: bad(p.v) ? null : p.v,
      ...(p.min !== undefined ? { min: bad(p.min) ? null : p.min } : {}),
      ...(p.max !== undefined ? { max: bad(p.max) ? null : p.max } : {}),
    };
  });
}

/** The values `m × 10ⁿ` between lo and hi: m from `mantissas`, n every `every` decades counting from lo's. */
function steps(lo: number, hi: number, mantissas: number[], every = 1): number[] {
  const out: number[] = [];
  const first = decadeOf(lo);
  for (let e = first; e <= decadeOf(hi) + every; e += every) {
    for (const m of mantissas) {
      const v = tidy(m * 10 ** e);
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
    }
  }
  return out;
}

/** The largest step at or below `v` (`down`), or the smallest at or above it. */
function snap(v: number, mantissas: number[], down: boolean): number {
  const e = decadeOf(v);
  const around = steps(pow(e - 2), pow(e + 2), mantissas);
  const fit = down ? around.filter((s) => s <= v * (1 + 1e-9)) : around.filter((s) => s >= v * (1 - 1e-9));
  return down ? fit[fit.length - 1] : fit[0];
}

export interface LogAxis extends ValueAxis {
  /** Unlabelled steps between the labels, for fainter gridlines. */
  minor: number[];
  /** Decimals each tick needs (0.01 → 2, 20 → 0), in step with `ticks`. */
  tickDecimals: number[];
}

/**
 * The log axis for positive readings spanning `data`. Ends that aren't fixed move out to the
 * nearest labelled step. Labels go at every 1–9, else 1, 2 and 5, else each power of ten, else
 * every few powers of ten: the finest that gives at most `count + 1` labels. A fixed end at or
 * below zero, or no readings, falls back to sensible room (the caller validates fixed ends).
 */
export function logAxis(
  data: [number, number] | undefined,
  fixed: { min?: number; max?: number },
  count: number,
): LogAxis {
  let [lo, hi] = data ?? [1, 100];
  if (fixed.min !== undefined && fixed.min > 0) lo = fixed.min;
  if (fixed.max !== undefined && fixed.max > 0) hi = fixed.max;
  if (!(hi > 0)) hi = lo > 0 ? lo * 10 : 100;
  if (!(lo > 0)) lo = hi / 1000;
  const fixMin = fixed.min !== undefined && fixed.min === lo;
  const fixMax = fixed.max !== undefined && fixed.max === hi;
  if (hi <= lo) {
    // Flat readings, or all past a fixed end: a power of ten's room.
    if (fixMin) hi = lo * 10;
    else if (fixMax) lo = hi / 10;
    else {
      lo = lo / Math.sqrt(10);
      hi = hi * Math.sqrt(10);
    }
  }
  const budget = Math.max(2, count + 1);
  const choices: { mantissas: number[]; every: number }[] = [
    ...MANTISSAS.map((mantissas) => ({ mantissas, every: 1 })),
    ...DECADE_STEPS.map((every) => ({ mantissas: [1], every })),
  ];
  let chosen = choices[choices.length - 1];
  let domain: [number, number] = [lo, hi];
  let ticks: number[] = [];
  for (const choice of choices) {
    // Ends go to the next labelled step; when labels skip powers of ten, the next power of ten.
    const a = fixMin ? lo : snap(lo, choice.mantissas, true);
    const b = fixMax ? hi : snap(hi, choice.mantissas, false);
    const t = steps(a, b, choice.mantissas, choice.every);
    chosen = choice;
    domain = [a, b];
    ticks = t;
    if (t.length <= budget) break;
  }
  const minorSet = chosen.every > 1 ? [1] : MANTISSAS[0];
  const minor =
    chosen.mantissas.length === 9
      ? []
      : steps(domain[0], domain[1], minorSet)
          .filter((v) => !ticks.includes(v))
          .slice(0, 200);
  const tickDecimals = ticks.map((v) => Math.max(0, -decadeOf(v)));
  return { domain, ticks, decimals: Math.max(0, ...tickDecimals), minor, tickDecimals };
}

/** Map positive values onto `range` by their logarithm; zero and below have no place (NaN). */
export function logScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const l0 = Math.log10(domain[0]);
  const l1 = Math.log10(domain[1]);
  const [r0, r1] = range;
  const k = l1 === l0 ? 0 : (r1 - r0) / (l1 - l0);
  return (v) => (v > 0 ? r0 + (Math.log10(v) - l0) * k : NaN);
}

/** Above this, a log tick reads short: 10k, 1M. */
const COMPACT_FROM = 10_000;

/** A log axis label: as many decimals as the step needs, and big numbers in short form. */
export function logTickText(v: number, decimals: number, hass?: HomeAssistant): string {
  if (Math.abs(v) < COMPACT_FROM) return formatNumber(v, decimals, hass);
  const language = hass?.locale?.language ?? hass?.language ?? 'en';
  try {
    return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
}
