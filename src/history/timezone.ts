import type { HomeAssistant } from '../types';

/**
 * Calendar maths in a named time zone, with nothing but `Intl.DateTimeFormat`. A chart's days,
 * weeks and months follow Home Assistant's time zone setting, which may not be the browser's.
 */

/** Where calendar boundaries fall: an IANA time zone, and the weekday a week starts on. */
export interface Zone {
  timeZone: string;
  /** 1 = Monday … 7 = Sunday (ISO numbering, as `Intl.Locale` weekInfo uses). */
  firstDay: number;
}

/** Calendar units a chart can step or group by. */
export type CalendarUnit = 'hour' | 'day' | 'week' | 'month' | 'year';

/** A wall-clock reading in a zone. Months are 1–12; weekday is 1 = Monday … 7 = Sunday. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const HOUR = 3_600_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The browser's own time zone. */
export function browserTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** True when `Intl` knows the zone name. */
export function isTimeZone(name: unknown): name is string {
  if (typeof name !== 'string' || name === '') return false;
  try {
    formatter(name);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `timeZone` at instant `t`. */
export function wallTime(t: number, timeZone: string): WallTime {
  const out: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(t))) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // Some engines still write midnight as 24 under h23.
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS.indexOf(out.weekday) + 1,
  };
}

/** The zone's offset from UTC at instant `t`, in ms (positive east of Greenwich). */
export function offsetAt(t: number, timeZone: string): number {
  const w = wallTime(t, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in `timeZone`. Fields may overflow (day 0, month 13) and
 * are normalised as `Date.UTC` does. A time that happens twice (clocks going back) gives the
 * first; a time that never happens (clocks going forward) gives the moment the clocks jumped, so
 * the start of a day that begins with a jump is the first instant of that day.
 */
export function zonedTime(
  timeZone: string,
  year: number,
  month: number,
  day = 1,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const target = new Date(guess);
  // The offsets a day either side cover any one DST change near this time.
  const before = offsetAt(guess - 24 * HOUR, timeZone);
  const after = offsetAt(guess + 24 * HOUR, timeZone);
  const matches = [guess - before, guess - after].filter((t) => {
    const w = wallTime(t, timeZone);
    return (
      w.year === target.getUTCFullYear() &&
      w.month === target.getUTCMonth() + 1 &&
      w.day === target.getUTCDate() &&
      w.hour === target.getUTCHours() &&
      w.minute === target.getUTCMinutes() &&
      w.second === target.getUTCSeconds()
    );
  });
  return matches.length ? Math.min(...matches) : jumpBetween(guess - after, guess - before, before, timeZone);
}

/** The instant (to the second) between `lo` and `hi` when the offset stops being `before`. */
function jumpBetween(lo: number, hi: number, before: number, timeZone: string): number {
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (offsetAt(mid, timeZone) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Day arithmetic on a calendar date, with overflow normalised. */
function civil(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The start of the hour, day, week, month or year containing `t`, in the zone. */
export function startOf(unit: CalendarUnit, t: number, zone: Zone): number {
  const w = wallTime(t, zone.timeZone);
  switch (unit) {
    case 'hour':
      // Back to the wall clock's last :00, which also works in half-hour zones and in the hour
      // that happens twice when the clocks go back.
      return t - (t % 1000) - (w.minute * 60 + w.second) * 1000;
    case 'day':
      return zonedTime(zone.timeZone, w.year, w.month, w.day);
    case 'week': {
      const back = (w.weekday - zone.firstDay + 7) % 7;
      const d = civil(w.year, w.month, w.day - back);
      return zonedTime(zone.timeZone, d.year, d.month, d.day);
    }
    case 'month':
      return zonedTime(zone.timeZone, w.year, w.month, 1);
    case 'year':
      return zonedTime(zone.timeZone, w.year, 1, 1);
  }
}

/**
 * `start` moved by `n` units (negative goes back), keeping the wall-clock time. Hours step by the
 * clock (an hour is always 3,600 s); days and longer step by the calendar, so a day across a DST
 * change is 23 or 25 hours. Months keep the day of the month where they can (31 Jan + 1 month is
 * the last day of February).
 */
export function addUnits(unit: CalendarUnit, start: number, n: number, zone: Zone): number {
  if (unit === 'hour') return start + n * HOUR;
  const w = wallTime(start, zone.timeZone);
  let { year, month, day } = w;
  if (unit === 'day') ({ year, month, day } = civil(year, month, day + n));
  else if (unit === 'week') ({ year, month, day } = civil(year, month, day + 7 * n));
  else {
    const months = unit === 'year' ? 12 * n : n;
    const first = civil(year, month + months, 1);
    const length = civil(first.year, first.month + 1, 0).day;
    ({ year, month } = first);
    day = Math.min(day, length);
  }
  return zonedTime(zone.timeZone, year, month, day, w.hour, w.minute, w.second);
}

/**
 * The calendar boundaries from the group containing `start` up to `end`: each group's start, plus
 * the end of the last one. A span of under a group gives two boundaries.
 */
export function boundaries(unit: CalendarUnit, start: number, end: number, zone: Zone, max = 10_000): number[] {
  const out = [startOf(unit, start, zone)];
  let i = 1;
  while (out[out.length - 1] < end && out.length <= max) {
    // Step from the first boundary each time, so a short month doesn't shorten every later one.
    const next = unit === 'hour' ? out[0] + i * HOUR : addUnits(unit, out[0], i, zone);
    out.push(next > out[out.length - 1] ? next : out[out.length - 1] + HOUR);
    i++;
  }
  if (out.length === 1) out.push(addUnits(unit, out[0], 1, zone));
  return out;
}

/** The weekday a language's week starts on (1 = Monday … 7 = Sunday), or Monday if unknown. */
export function languageFirstDay(language: string): number {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const day = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
    return typeof day === 'number' && day >= 1 && day <= 7 ? day : 1;
  } catch {
    return 1;
  }
}

/**
 * The zone a card's calendar follows. Home Assistant's profile setting picks the server's time
 * zone (`hass.config.time_zone`) or the browser's (`local`, the default). The first weekday is
 * the profile's choice, or the language's when it says `language`.
 */
export function zoneFor(hass: HomeAssistant | undefined): Zone {
  const locale = hass?.locale;
  const server = hass?.config?.time_zone;
  const timeZone = locale?.time_zone === 'server' && isTimeZone(server) ? server : browserTimeZone();
  const chosen = DAY_NAMES.indexOf(String(locale?.first_weekday ?? 'language')) + 1;
  const language = locale?.language ?? hass?.language ?? 'en';
  return { timeZone, firstDay: chosen > 0 ? chosen : languageFirstDay(language) };
}
