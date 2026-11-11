import { afterEach, describe, expect, it, vi } from 'vitest';
import { periodLabel } from '../src/chart/frame';
import { parseStatistics, loadStatistics } from '../src/history/fetch';
import { DEFAULT_PERIOD, parsePeriod, periodRange, rollingRange, setSteps, stepsFor } from '../src/history/period';
import type { Period } from '../src/history/period';
import { HistoryStore } from '../src/history/store';
import {
  addUnits,
  boundaries,
  browserTimeZone,
  isTimeZone,
  languageFirstDay,
  offsetAt,
  startOf,
  wallTime,
  zoneFor,
  zonedTime,
} from '../src/history/timezone';
import type { HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
const london = { timeZone: 'Europe/London', firstDay: 1 };
const newYork = { timeZone: 'America/New_York', firstDay: 7 };

describe('time zone helpers', () => {
  it('reads the wall clock and offset in a named zone', () => {
    const t = Date.UTC(2026, 6, 1, 23, 30);
    expect(wallTime(t, 'Europe/London')).toEqual({
      year: 2026,
      month: 7,
      day: 2,
      hour: 0,
      minute: 30,
      second: 0,
      weekday: 4,
    });
    expect(offsetAt(t, 'Europe/London')).toBe(H);
    expect(offsetAt(Date.UTC(2026, 0, 1), 'Europe/London')).toBe(0);
    expect(offsetAt(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(5.5 * H);
  });

  it('turns a wall-clock time into an instant, across DST changes', () => {
    expect(iso(zonedTime('Europe/London', 2026, 7, 2))).toBe('2026-07-01T23:00:00.000Z');
    // 01:30 doesn't happen on the morning the clocks go forward: the jump itself is used.
    expect(iso(zonedTime('Europe/London', 2026, 3, 29, 1, 30))).toBe('2026-03-29T01:00:00.000Z');
    // 01:30 happens twice when they go back: the first one.
    expect(iso(zonedTime('Europe/London', 2026, 10, 25, 1, 30))).toBe('2026-10-25T00:30:00.000Z');
    // Overflowing fields roll over as Date.UTC does.
    expect(iso(zonedTime('Europe/London', 2026, 13, 1))).toBe('2027-01-01T00:00:00.000Z');
  });

  it('finds the start of a day that begins with a jump (Santiago skips midnight)', () => {
    const start = startOf('day', Date.UTC(2026, 8, 6, 15), { timeZone: 'America/Santiago', firstDay: 1 });
    expect(wallTime(start, 'America/Santiago')).toMatchObject({ day: 6, hour: 1, minute: 0 });
    expect(offsetAt(start - 1000, 'America/Santiago')).toBe(-4 * H);
  });

  it('finds the start of an hour, day, week, month and year', () => {
    const t = Date.UTC(2026, 9, 29, 14, 25, 10, 500);
    expect(iso(startOf('hour', t, london))).toBe('2026-10-29T14:00:00.000Z');
    expect(iso(startOf('day', t, london))).toBe('2026-10-29T00:00:00.000Z');
    expect(iso(startOf('day', t, newYork))).toBe('2026-10-29T04:00:00.000Z');
    expect(iso(startOf('week', t, london))).toBe('2026-10-26T00:00:00.000Z');
    expect(iso(startOf('week', t, newYork))).toBe('2026-10-25T04:00:00.000Z');
    expect(iso(startOf('month', t, london))).toBe('2026-09-30T23:00:00.000Z');
    expect(iso(startOf('year', t, newYork))).toBe('2026-01-01T05:00:00.000Z');
    // Half-hour zones, and the second 01:xx of the night the clocks go back.
    expect(iso(startOf('hour', t, { timeZone: 'Asia/Kolkata', firstDay: 1 }))).toBe('2026-10-29T13:30:00.000Z');
    expect(iso(startOf('hour', Date.UTC(2026, 9, 25, 1, 40), london))).toBe('2026-10-25T01:00:00.000Z');
    // A week that started in the previous month (Monday 28 Sep).
    expect(iso(startOf('week', Date.UTC(2026, 9, 1, 12), london))).toBe('2026-09-27T23:00:00.000Z');
  });

  it('steps by calendar units, with 23 and 25 hour days and short months', () => {
    const spring = zonedTime('Europe/London', 2026, 3, 29);
    expect(addUnits('day', spring, 1, london) - spring).toBe(23 * H);
    const autumn = zonedTime('Europe/London', 2026, 10, 25);
    expect(addUnits('day', autumn, 1, london) - autumn).toBe(25 * H);
    expect(addUnits('hour', autumn, 2, london) - autumn).toBe(2 * H);
    expect(addUnits('week', autumn, -1, london)).toBe(zonedTime('Europe/London', 2026, 10, 18));
    expect(
      wallTime(addUnits('month', zonedTime('Europe/London', 2026, 1, 31, 9), 1, london), 'Europe/London'),
    ).toMatchObject({ month: 2, day: 28, hour: 9 });
    expect(addUnits('year', zonedTime('Europe/London', 2026, 1, 1), -2, london)).toBe(Date.UTC(2024, 0, 1));
  });

  it('lists group boundaries, every month from its own first day', () => {
    const b = boundaries('month', Date.UTC(2026, 0, 31), Date.UTC(2026, 3, 2), london);
    expect(b.map(iso)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T23:00:00.000Z',
      '2026-04-30T23:00:00.000Z',
    ]);
    expect(boundaries('day', Date.UTC(2026, 0, 1, 5), Date.UTC(2026, 0, 1, 6), london)).toHaveLength(2);
    expect(boundaries('hour', Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1, 3), london)).toHaveLength(4);
  });

  it('picks the zone and first weekday from Home Assistant settings', () => {
    const hass = (locale: Record<string, string>, tz = 'America/New_York') =>
      makeHass({}, { locale: { language: 'en', ...locale }, config: { time_zone: tz } });
    expect(zoneFor(hass({ time_zone: 'server', language: 'en-GB' }))).toEqual({
      timeZone: 'America/New_York',
      firstDay: 1,
    });
    expect(zoneFor(hass({ time_zone: 'local' })).timeZone).toBe(browserTimeZone());
    expect(zoneFor(hass({ time_zone: 'server' }, 'Not/AZone')).timeZone).toBe(browserTimeZone());
    expect(zoneFor(hass({ first_weekday: 'sunday' })).firstDay).toBe(7);
    expect(zoneFor(hass({ first_weekday: 'language', language: 'en-US' })).firstDay).toBe(languageFirstDay('en-US'));
    expect(zoneFor(undefined).firstDay).toBe(languageFirstDay('en'));
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('')).toBe(false);
  });

  it("reads a language's first weekday, or Monday when it can't", () => {
    expect(languageFirstDay('en-GB')).toBe(1);
    expect(languageFirstDay('not a language!')).toBe(1);
    const Locale = Intl.Locale;
    vi.stubGlobal('Intl', {
      ...Intl,
      Locale: class extends Locale {
        getWeekInfo() {
          return { firstDay: 7 };
        }
      },
    });
    expect(languageFirstDay('en-US')).toBe(7);
    vi.unstubAllGlobals();
  });
});

describe('period', () => {
  const now = Date.UTC(2026, 9, 29, 14, 25);
  const p = (raw: Record<string, unknown>): Period => parsePeriod(raw as never);

  it('reads calendar spans, offsets, navigation and until, and checks them', () => {
    expect(p({})).toEqual(DEFAULT_PERIOD);
    expect(p({ calendar: 'week', offset: '2', navigate: true, until: 'end' })).toEqual({
      ...DEFAULT_PERIOD,
      calendar: 'week',
      offset: 2,
      navigate: true,
      until: 'end',
    });
    expect(() => p({ calendar: 'fortnight' })).toThrow('"period.calendar" must be one of: day, week, month, year');
    expect(() => p({ offset: -1 })).toThrow(/period.offset/);
    expect(() => p({ until: 'later' })).toThrow(/period.until/);
    expect(() => p({ navigate: 'yes' })).toThrow(/period.navigate/);
  });

  it('runs a calendar span from its start to now, or to its end', () => {
    expect(periodRange(p({ calendar: 'day' }), now, london)).toEqual({
      start: Date.UTC(2026, 9, 29),
      end: now,
      live: true,
      back: 0,
    });
    expect(periodRange(p({ calendar: 'day', until: 'end' }), now, london).end).toBe(Date.UTC(2026, 9, 30));
    expect(periodRange(p({ calendar: 'month' }), now, london).start).toBe(Date.UTC(2026, 8, 30, 23));
    expect(periodRange(p({ calendar: 'year' }), now, newYork).start).toBe(Date.UTC(2026, 0, 1, 5));
  });

  it('goes back by whole spans: yesterday, last week, a 25-hour day', () => {
    expect(periodRange(p({ calendar: 'day', offset: 1 }), now, london)).toEqual({
      start: Date.UTC(2026, 9, 28),
      end: Date.UTC(2026, 9, 29),
      live: false,
      back: 1,
    });
    const week = periodRange(p({ calendar: 'week' }), now, london, 1);
    expect([iso(week.start), iso(week.end)]).toEqual(['2026-10-18T23:00:00.000Z', '2026-10-26T00:00:00.000Z']);
    const autumn = periodRange(p({ calendar: 'day', offset: 4 }), now, london);
    expect(autumn.end - autumn.start).toBe(25 * H);
  });

  it('moves a rolling span back by its own length', () => {
    expect(periodRange(p({ last: 24, unit: 'hour', offset: 1 }), now, london)).toEqual({
      start: now - 48 * H,
      end: now - 24 * H,
      live: false,
      back: 1,
    });
    expect(periodRange(p({}), now, london)).toMatchObject({ start: now - 24 * H, end: now, live: true });
    const month = periodRange(p({ last: 1, unit: 'month' }), now, london, 1);
    expect([iso(month.start), iso(month.end)]).toEqual(['2026-08-29T13:25:00.000Z', '2026-09-29T13:25:00.000Z']);
    expect(periodRange(p({ last: 2, unit: 'month' }), now, london).start).toBe(
      rollingRange(p({ last: 2, unit: 'month' }), now, london).start,
    );
  });

  it('never steps past the present', () => {
    expect(periodRange(p({ calendar: 'day', offset: 1 }), now, london, -5)).toMatchObject({ back: 0, live: true });
    const host = document.createElement('div');
    const period = p({ calendar: 'day', offset: 1, navigate: true });
    setSteps(host, period, -3);
    expect(stepsFor(host, period)).toBe(-1);
    setSteps(host, period, 2);
    expect(stepsFor(host, period)).toBe(2);
    // Editing the period starts again from the card's own span.
    expect(stepsFor(host, { ...period, calendar: 'week' })).toBe(0);
  });

  it('names a span in words, then by its dates', () => {
    const hass = makeHass({}, { locale: { language: 'en-GB' } });
    const label = (raw: Record<string, unknown>, back = 0) => {
      const period = p(raw);
      const range = periodRange(period, now, london, back - period.offset);
      return periodLabel(period, range, range.back, london, hass);
    };
    expect(label({ calendar: 'day' })).toBe('Today');
    expect(label({ calendar: 'day' }, 1)).toBe('Yesterday');
    expect(label({ calendar: 'day' }, 2)).toBe('Tue 27 Oct');
    expect(label({ calendar: 'week' }, 1)).toBe('Last week');
    expect(label({ calendar: 'week' }, 2)).toMatch(/12.*18 Oct/);
    expect(label({ calendar: 'month' }, 3)).toBe('July 2026');
    expect(label({ calendar: 'year' }, 1)).toBe('Last year');
    expect(label({ calendar: 'year' }, 3)).toBe('2023');
    expect(label({ calendar: 'month' }, 13)).toBe('September 2025');
    expect(label({ calendar: 'day' }, 400)).toMatch(/2025/);
    expect(label({ last: 24 })).toBe('Last 24 hours');
    expect(label({ last: 1, unit: 'day' })).toBe('Last day');
    expect(label({ last: 3, unit: 'day' })).toBe('Last 3 days');
    expect(label({ last: 1, unit: 'week' })).toBe('Last 7 days');
    expect(label({ last: 2, unit: 'week' })).toBe('Last 2 weeks');
    expect(label({ last: 1, unit: 'month' })).toBe('Last month');
    expect(label({ last: 6, unit: 'month' })).toBe('Last 6 months');
    expect(label({ last: 1, unit: 'hour' })).toBe('Last hour');
    expect(label({ last: 24 }, 1)).toMatch(/27 Oct.*14:25.*28 Oct.*14:25/);
    expect(label({ last: 1, unit: 'week' }, 1)).toMatch(/15.*22 Oct/);
  });
});

describe('store and periods', () => {
  afterEach(() => vi.useRealTimers());
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function setup() {
    const hass = makeHass({ 'sensor.a': '1' });
    hass.callWS = vi.fn(async () => ({ 'sensor.a': [{ s: '1', lu: 10 }] })) as HomeAssistant['callWS'];
    const changed = vi.fn();
    return { hass, store: new HistoryStore(changed), series: [{ entity: 'sensor.a' }] };
  }

  const withState = (hass: HomeAssistant, state: string, t: number) => ({
    ...hass,
    states: { 'sensor.a': { ...hass.states['sensor.a'], state, last_updated: new Date(t).toISOString() } },
  });

  it("doesn't append live states to a past span, and reloads on the way back to now", async () => {
    const { hass, store, series } = setup();
    const past = { start: 0, end: 20_000 };
    store.get(hass, series, past, 'history', { live: false });
    await flush();
    const later = withState(hass, '9', 15_000);
    expect(store.get(later, series, past, 'history', { live: false }).data.get('sensor.a')).toHaveLength(1);
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    // A rolling past span creeps forward with the clock: no reload for a few seconds' drift.
    store.get(later, series, { start: 5000, end: 30_000 }, 'history', { live: false });
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    // A later past span well beyond what is loaded (next, or an hour of drift): load it.
    store.get(later, series, { start: 5000, end: 3_700_000 }, 'history', { live: false });
    expect(hass.callWS).toHaveBeenCalledTimes(2);
    await flush();
    // Back to the present: what was loaded stops short of now, so load again.
    store.get(later, series, { start: 10_000, end: 40_000 }, 'history');
    expect(hass.callWS).toHaveBeenCalledTimes(3);
    await flush();
    const live = store.get(withState(hass, '7', 35_000), series, { start: 10_000, end: 40_000 }, 'history');
    expect(live.data.get('sensor.a')!.map((p) => p.v)).toEqual([1, 7]);
    // Stepping back to an earlier span loads it.
    store.get(hass, series, { start: -50_000, end: -10_000 }, 'history', { live: false });
    expect(hass.callWS).toHaveBeenCalledTimes(4);
  });

  it("doesn't reload a past span after an absence, or refresh past statistics", async () => {
    vi.useFakeTimers();
    const { hass, store, series } = setup();
    store.get(hass, series, { start: 0, end: H }, 'statistics', { live: false });
    await vi.advanceTimersByTimeAsync(0);
    store.pause();
    await vi.advanceTimersByTimeAsync(2 * H);
    store.get(hass, series, { start: 0, end: H }, 'statistics', { live: false });
    expect(hass.callWS).toHaveBeenCalledTimes(1);
  });

  it('asks for the statistics columns it is given, and reloads when they change', async () => {
    const { hass, store, series } = setup();
    const range = { start: 0, end: 10 * 24 * H };
    store.get(hass, series, range, 'statistics', { statistics: { period: 'day', types: ['change'], value: 'change' } });
    expect((hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      period: 'day',
      types: ['change'],
    });
    store.get(hass, series, range, 'statistics', { statistics: { period: 'day', types: ['change'], value: 'change' } });
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    store.get(hass, series, range, 'statistics', { statistics: { period: 'day', types: ['max'], value: 'max' } });
    expect(hass.callWS).toHaveBeenCalledTimes(2);
    await loadStatistics(hass, series, range);
    expect((hass.callWS as ReturnType<typeof vi.fn>).mock.calls[2][0]).toMatchObject({
      period: 'hour',
      types: ['mean', 'min', 'max', 'state'],
    });
  });

  it('reads the asked-for statistics column, falling back to mean or state', () => {
    const rows = [
      { start: 0, mean: 5, min: 1, max: 9, state: 100, change: 2 },
      { start: 1, state: 7 },
      { start: 2, mean: 3 },
    ];
    expect(parseStatistics(rows, 'change').map((p) => p.v)).toEqual([2, null, null]);
    expect(parseStatistics(rows, 'state').map((p) => p.v)).toEqual([100, 7, 3]);
    expect(parseStatistics(rows, 'min').map((p) => p.v)).toEqual([1, 7, 3]);
    expect(parseStatistics(rows, 'max').map((p) => p.v)).toEqual([9, 7, 3]);
    expect(parseStatistics(rows, 'mean').map((p) => p.v)).toEqual([5, 7, 3]);
  });
});
