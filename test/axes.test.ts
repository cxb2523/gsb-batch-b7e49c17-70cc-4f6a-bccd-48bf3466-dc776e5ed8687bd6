import { describe, expect, it } from 'vitest';
import {
  axisOptions,
  DEFAULT_AXES,
  formatDateTime,
  formatTime,
  hour12Of,
  niceStep,
  stepDecimals,
  timeInterval,
  timeLabel,
  timeTicks,
  timeZoneOf,
  validateAxisOptions,
  valueAxis,
  zoneOffset,
} from '../src/chart/axes';
import type { CardConfig, HomeAssistant } from '../src/types';

const MIN = 60_000;
const H = 3_600_000;
const D = 86_400_000;
const utc = zoneOffset('UTC');
const iso = (t: number) => new Date(t).toISOString();
const hass = (locale: Record<string, string>, zone = 'Europe/London') =>
  ({ states: {}, locale: { language: 'en-GB', ...locale }, config: { time_zone: zone } }) as unknown as HomeAssistant;

describe('value axis', () => {
  it('picks round steps of 1, 2 or 5 and the decimals they need', () => {
    expect(niceStep(9.2, 4)).toBe(5);
    expect(niceStep(8, 4)).toBe(2);
    expect(niceStep(0.37, 4)).toBe(0.1);
    expect(niceStep(4000, 4)).toBe(1000);
    expect(niceStep(0, 4)).toBe(1);
    expect(niceStep(NaN, 4)).toBe(1);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.02)).toBe(2);
    expect(stepDecimals(20)).toBe(0);
  });

  it('pads the readings and extends both ends to a round step', () => {
    expect(valueAxis([14, 22], {}, 4)).toEqual({ domain: [10, 25], ticks: [10, 15, 20, 25], decimals: 0 });
    const small = valueAxis([0.1, 0.4], {}, 4);
    expect(small.ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(small.decimals).toBe(1);
    expect(valueAxis(undefined, {}, 4).ticks[0]).toBeLessThanOrEqual(0);
  });

  it('keeps fixed ends exactly and fills in round ticks between', () => {
    expect(valueAxis([14, 22], { min: 0 }, 4)).toEqual({ domain: [0, 30], ticks: [0, 10, 20, 30], decimals: 0 });
    expect(valueAxis([14, 22], { min: 3, max: 27 }, 4)).toEqual({ domain: [3, 27], ticks: [10, 20], decimals: 0 });
    expect(valueAxis([14, 22], { max: 100 }, 4).domain).toEqual([0, 100]);
  });

  it('still has room when every reading is past the one fixed end', () => {
    expect(valueAxis([-5, -2], { min: 0 }, 4).domain).toEqual([0, 1]);
    expect(valueAxis([50, 60], { max: 0 }, 4).domain).toEqual([-1, 0]);
  });
});

describe('time axis', () => {
  it('chooses the shortest calendar step that fits', () => {
    expect(timeInterval(H, 6)).toMatchObject({ unit: 'minute', n: 10 });
    expect(timeInterval(24 * H, 6)).toMatchObject({ unit: 'hour', n: 6 });
    expect(timeInterval(7 * D, 7)).toMatchObject({ unit: 'day', n: 1 });
    expect(timeInterval(30 * D, 6)).toMatchObject({ unit: 'day', n: 7 });
    expect(timeInterval(365 * D, 6)).toMatchObject({ unit: 'month', n: 2 });
    expect(timeInterval(365 * D, 4)).toMatchObject({ unit: 'month', n: 3 });
    expect(timeInterval(1e14, 6)).toMatchObject({ unit: 'year', n: 100 });
  });

  it('puts hour ticks on round wall-clock hours aligned to midnight', () => {
    const start = Date.UTC(2026, 9, 28, 13, 20);
    const { unit, ticks } = timeTicks({ start, end: start + 24 * H }, 6, utc);
    expect(unit).toBe('hour');
    expect(ticks.map(iso)).toEqual([
      '2026-10-28T18:00:00.000Z',
      '2026-10-29T00:00:00.000Z',
      '2026-10-29T06:00:00.000Z',
      '2026-10-29T12:00:00.000Z',
    ]);
  });

  it('follows the zone, across a clock change', () => {
    // UK clocks went back at 02:00 BST on 25 Oct 2026; local midnights are 23:00Z before, 00:00Z after.
    const london = zoneOffset('Europe/London');
    const start = Date.UTC(2026, 9, 23, 12);
    const { ticks } = timeTicks({ start, end: start + 4 * D }, 6, london);
    expect(ticks.map(iso)).toEqual([
      '2026-10-23T23:00:00.000Z',
      '2026-10-24T23:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
      '2026-10-27T00:00:00.000Z',
    ]);
  });

  it('puts minute, week, month and year ticks on their boundaries', () => {
    const t0 = Date.UTC(2026, 9, 29, 10, 7);
    expect(timeTicks({ start: t0, end: t0 + H }, 6, utc).ticks.map(iso)[0]).toBe('2026-10-29T10:10:00.000Z');
    const weeks = timeTicks({ start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 31) }, 6, utc);
    expect(weeks.ticks.map((t) => new Date(t).getUTCDay())).toEqual([1, 1, 1, 1]);
    const months = timeTicks({ start: Date.UTC(2025, 10, 15), end: Date.UTC(2026, 10, 15) }, 4, utc);
    expect(months.unit).toBe('month');
    expect(months.ticks.map((t) => iso(t).slice(0, 7))).toEqual(['2026-01', '2026-04', '2026-07', '2026-10']);
    const years = timeTicks({ start: Date.UTC(2019, 5), end: Date.UTC(2026, 5) }, 6, utc);
    expect(years.ticks.map((t) => new Date(t).getUTCFullYear())).toEqual([2020, 2022, 2024, 2026]);
    const fromJan = timeTicks({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 6, 1) }, 6, utc);
    expect(iso(fromJan.ticks[0]).slice(0, 7)).toBe('2026-01');
  });

  it('falls back to the browser zone for no zone or an unknown one', () => {
    const t = Date.UTC(2026, 0, 1);
    expect(zoneOffset()(t)).toBe(-new Date(t).getTimezoneOffset() * MIN);
    expect(zoneOffset('Mars/Olympus')(t)).toBe(zoneOffset()(t));
    expect(zoneOffset('Asia/Kolkata')(t)).toBe(5.5 * H);
  });
});

describe('time labels', () => {
  const server = hass({ time_zone: 'server', time_format: '24' }, 'UTC');

  it('reads the zone and clock from the user profile', () => {
    expect(timeZoneOf(server)).toBe('UTC');
    expect(timeZoneOf(hass({ time_zone: 'local' }))).toBeUndefined();
    expect(hour12Of(hass({ time_format: '12' }))).toBe(true);
    expect(hour12Of(server)).toBe(false);
    expect(hour12Of(undefined)).toBeUndefined();
  });

  it('labels each unit in the user language, clock and zone', () => {
    const noon = Date.UTC(2026, 9, 29, 12);
    const midnight = Date.UTC(2026, 9, 29);
    expect(timeLabel(noon, 'hour', D, server)).toBe('12:00');
    expect(timeLabel(noon, 'hour', D, hass({ time_zone: 'server', time_format: '12' }, 'UTC'))).toMatch(/12:00\s?pm/i);
    expect(timeLabel(midnight, 'hour', D, server)).toBe('Thu');
    expect(timeLabel(midnight, 'day', 7 * D, server)).toBe('Thu');
    expect(timeLabel(midnight, 'day', 30 * D, server)).toBe('29 Oct');
    expect(timeLabel(Date.UTC(2026, 9, 1), 'month', 365 * D, server)).toBe('Oct');
    expect(timeLabel(Date.UTC(2026, 0, 1), 'month', 365 * D, server)).toBe('Jan 2026');
    expect(timeLabel(Date.UTC(2026, 0, 1), 'year', 3650 * D, server)).toBe('2026');
    expect(formatTime(noon + 5000, server, true)).toBe('12:00:05');
    expect(formatDateTime(noon, server)).toMatch(/Thu.*29 Oct.*12:00/);
  });

  it('copes with a language Intl does not know', () => {
    const odd = { states: {}, locale: { language: 'xx-invalid-!!' } } as unknown as HomeAssistant;
    expect(timeLabel(Date.UTC(2026, 0, 1), 'year', 3650 * D, odd)).toMatch(/2026|2025/);
  });
});

describe('axis options', () => {
  const base = { type: 'x', entities: [] } as unknown as CardConfig;
  const check = (extra: Record<string, unknown>) => () => validateAxisOptions({ ...base, ...extra } as CardConfig);

  it('defaults to labels beside the chart and lines across', () => {
    expect(axisOptions(base)).toEqual({ ...DEFAULT_AXES, min: undefined, max: undefined });
    expect(
      axisOptions({
        ...base,
        x_axis: false,
        axis_labels: 'inside',
        gridlines: { vertical: true },
        y_min: 0,
      } as CardConfig),
    ).toEqual({
      x: false,
      y: true,
      labels: 'inside',
      horizontal: true,
      vertical: true,
      min: 0,
      max: undefined,
      scale: 'linear',
    });
  });

  it('explains a bad option', () => {
    expect(check({ x_axis: 'yes' })).toThrow('"x_axis" must be true or false');
    expect(check({ axis_labels: 'left' })).toThrow('"axis_labels" must be one of: outside, inside');
    expect(check({ gridlines: true })).toThrow(/"gridlines" must have/);
    expect(check({ gridlines: { vertical: 1 } })).toThrow('"gridlines.vertical" must be true or false');
    expect(check({ y_min: '0' })).toThrow('"y_min" must be a number');
    expect(check({ y_min: 5, y_max: 5 })).toThrow('"y_min" must be below "y_max"');
    expect(check({ y_min: 0, y_max: 5, gridlines: { horizontal: false } })).not.toThrow();
  });
});

describe('time labels across the plot', () => {
  it('count from the plot width, leaving room for the value labels', async () => {
    const { plotAxes } = await import('../src/chart/grid');
    const range = { start: Date.UTC(2026, 9, 29, 0), end: Date.UTC(2026, 9, 29, 24) };
    const at = (width: number, raw: Record<string, unknown> = {}) => {
      const host = Object.assign(document.createElement('div'), {});
      Object.defineProperty(host, 'clientWidth', { value: width });
      const ctx = { host, raw, requestUpdate: () => {}, hass: undefined } as never;
      return plotAxes(ctx, range, [0, 10]).times.filter((t) => t >= range.start && t <= range.end).length;
    };
    // 320 px card: 320 - 32 padding - 40 value labels = 248 px of plot, room for 3 labels at 70 px.
    expect(at(320)).toBeLessThanOrEqual(4);
    expect(at(320, { y_axis: false })).toBeGreaterThanOrEqual(at(320));
    expect(at(1000)).toBeGreaterThan(at(320));
  });
});
