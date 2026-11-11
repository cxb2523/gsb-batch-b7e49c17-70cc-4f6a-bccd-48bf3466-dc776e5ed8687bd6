import type { CardConfig } from '../types';
import { addUnits, startOf } from './timezone';
import type { Zone } from './timezone';
import type { Range } from './types';

export const PERIOD_UNITS = ['hour', 'day', 'week', 'month'] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];

/** Calendar spans: today, this week, this month, this year. */
export const CALENDAR_SPANS = ['day', 'week', 'month', 'year'] as const;
export type CalendarSpan = (typeof CALENDAR_SPANS)[number];

/** Where a current calendar span stops: at the present moment, or at the end of the span. */
export const PERIOD_UNTIL = ['now', 'end'] as const;
export type PeriodUntil = (typeof PERIOD_UNTIL)[number];

export interface Period {
  /** Rolling span: the last `last` units. Ignored when `calendar` is set. */
  last: number;
  unit: PeriodUnit;
  /** A calendar span instead of a rolling one. */
  calendar?: CalendarSpan;
  /** Show the same span this many spans ago (0 is the current one). */
  offset: number;
  /** Show previous / next buttons on the card. */
  navigate: boolean;
  /** Current calendar span only: draw to now, or across the whole span. */
  until: PeriodUntil;
}

export const DEFAULT_PERIOD: Period = { last: 24, unit: 'hour', offset: 0, navigate: false, until: 'now' };

const UNIT_MS: Record<Exclude<PeriodUnit, 'month'>, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

function wholeNumber(raw: unknown, min: number, message: string): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min) throw new Error(message);
  return n;
}

function oneOf<T extends string>(raw: unknown, values: readonly T[], name: string): T {
  if (!values.includes(raw as T)) throw new Error(`"${name}" must be one of: ${values.join(', ')}`);
  return raw as T;
}

/**
 * `period` from YAML, every key optional. Throws a readable error.
 *
 * ```yaml
 * period: { last: 24, unit: hour }            # the last 24 hours
 * period: { calendar: day }                   # today, from midnight
 * period: { calendar: day, offset: 1 }        # yesterday
 * period: { calendar: week, navigate: true }  # this week, with previous / next buttons
 * ```
 */
export function parsePeriod(raw: CardConfig['period']): Period {
  if (raw === undefined || raw === null) return DEFAULT_PERIOD;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('"period" must have "last" and "unit"');
  const r = raw as Record<string, unknown>;
  const period: Period = {
    last: wholeNumber(r.last ?? DEFAULT_PERIOD.last, 1, '"period.last" must be a whole number of 1 or more'),
    unit: oneOf(r.unit ?? DEFAULT_PERIOD.unit, PERIOD_UNITS, 'period.unit'),
    offset: wholeNumber(r.offset ?? 0, 0, '"period.offset" must be a whole number of 0 or more'),
    navigate: r.navigate === undefined ? false : r.navigate === true,
    until: oneOf(r.until ?? 'now', PERIOD_UNTIL, 'period.until'),
  };
  if (r.navigate !== undefined && typeof r.navigate !== 'boolean')
    throw new Error('"period.navigate" must be true or false');
  if (r.calendar !== undefined) period.calendar = oneOf(r.calendar, CALENDAR_SPANS, 'period.calendar');
  return period;
}

/** The rolling span ending at `now`. Months step back by calendar month (in `zone` when given). */
export function rollingRange(period: Pick<Period, 'last' | 'unit'>, now: number, zone?: Zone): Range {
  if (period.unit === 'month') {
    if (zone) return { start: addUnits('month', now, -period.last, zone), end: now };
    const start = new Date(now);
    start.setMonth(start.getMonth() - period.last);
    return { start: start.getTime(), end: now };
  }
  return { start: now - period.last * UNIT_MS[period.unit], end: now };
}

/** The span a chart covers, and whether it reaches the present (so live readings belong in it). */
export interface PeriodRange extends Range {
  live: boolean;
  /** How many spans back this is (the card's offset plus any steps taken with the buttons). */
  back: number;
}

/**
 * The span to draw at `now`, `steps` spans further back than the card's own offset (the
 * previous / next buttons; negative steps go forward, never past the present).
 *
 * A rolling span moves back by its own length: the last 24 hours, one back, is the 24 hours
 * before that. A calendar span moves by the calendar: today, one back, is yesterday. The current
 * calendar span runs to now, or to its end with `until: end`; earlier ones always run to their end.
 */
export function periodRange(period: Period, now: number, zone: Zone, steps = 0): PeriodRange {
  const back = Math.max(0, period.offset + steps);
  if (period.calendar) {
    const span = period.calendar;
    const start = addUnits(span, startOf(span, now, zone), -back, zone);
    const end = addUnits(span, start, 1, zone);
    return { start, end: back === 0 && period.until === 'now' ? now : end, live: back === 0, back };
  }
  if (period.unit === 'month') {
    const end = back === 0 ? now : addUnits('month', now, -back * period.last, zone);
    return { ...rollingRange(period, end, zone), live: back === 0, back };
  }
  const length = period.last * UNIT_MS[period.unit];
  return { start: now - (back + 1) * length, end: now - back * length, live: back === 0, back };
}

/** Steps taken with a card's previous / next buttons. Kept on the card, never written to its config. */
const steps = new WeakMap<HTMLElement, { key: string; steps: number }>();

/** A card's steps back from its own period; forgotten when the period's config changes. */
export function stepsFor(host: HTMLElement, period: Period): number {
  const kept = steps.get(host);
  return kept && kept.key === JSON.stringify(period) ? kept.steps : 0;
}

/** Set a card's steps back, never past the present. */
export function setSteps(host: HTMLElement, period: Period, n: number): void {
  steps.set(host, { key: JSON.stringify(period), steps: Math.max(-period.offset, n) });
}
