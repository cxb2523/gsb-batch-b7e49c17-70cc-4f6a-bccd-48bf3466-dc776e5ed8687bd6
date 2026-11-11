import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import {
  errorBarsOf,
  fitsAggregate,
  heldInHistory,
  heldInStatistics,
  validateErrorBars,
  whiskerOf,
  whiskersFor,
} from '../src/chart/error-bars';
import type { CardConfig } from '../src/types';
import { H, ago, chartHass, mountCard, mountEditor, pointAt, q, qa, tooltipRows } from './helpers/chart';

const now = Date.now();
const sec = (ms: number) => ago(now, ms);
const D = 24 * H;

const states = {
  'sensor.temp': ['20', { friendly_name: 'Temp', unit_of_measurement: '°C', state_class: 'measurement' }],
  'sensor.hum': ['50', { friendly_name: 'Humidity', unit_of_measurement: '%', state_class: 'measurement' }],
  'sensor.energy': ['1000', { friendly_name: 'Energy', unit_of_measurement: 'kWh', state_class: 'total_increasing' }],
} as const;

/** Every 6 hours for 5 days: 15, 25, 15, 25 … so each day's mean is 20 and its spread 5. */
const swing = (lo: number, hi: number) =>
  Array.from({ length: 21 }, (_, i) => ({ s: String(i % 2 ? hi : lo), lu: sec((20 - i) * 6 * H + 60_000) }));

const history = {
  'sensor.temp': swing(15, 25),
  'sensor.hum': swing(40, 60),
  'sensor.energy': Array.from({ length: 6 }, (_, i) => ({ s: String(1000 + 10 * i), lu: sec((5 - i) * D) })),
};

const mount = (config: Record<string, unknown>, hass = chartHass(states, history)) =>
  mountCard(
    { style: 'column', entities: ['sensor.temp'], period: { last: 5, unit: 'day' }, ...config } as Partial<CardConfig>,
    hass,
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('error bar maths', () => {
  it('reads the option, off by default', () => {
    const raw = (error_bars?: unknown) => ({ type: 'x', error_bars }) as CardConfig;
    expect(errorBarsOf(raw())).toBeUndefined();
    expect(errorBarsOf(raw('none'))).toBeUndefined();
    expect(errorBarsOf(raw('ci95'))).toBe('ci95');
    expect(() => validateErrorBars(raw('sem'))).toThrow('"error_bars" must be one of: none, std, min_max, ci95');
    expect(() => validateErrorBars(raw('std'))).not.toThrow();
  });

  it('fits whiskers only to columns that are a spread around a value', () => {
    expect(fitsAggregate('std', 'mean')).toBe(true);
    expect(fitsAggregate('std', 'max')).toBe(false);
    expect(fitsAggregate('min_max', 'last')).toBe(true);
    expect(fitsAggregate('min_max', 'change')).toBe(false);
    expect(fitsAggregate('ci95', 'sum')).toBe(false);
  });

  it('finds what held in a group of history: carried in, taken, stopped at now', () => {
    const points = [
      { t: 0, v: 10 },
      { t: 5, v: null },
      { t: 6, v: 20 },
      { t: 15, v: 30 },
    ];
    expect(heldInHistory(points, 2, 10, 100)).toEqual([
      { v: 10, dt: 3 },
      { v: 20, dt: 4 },
    ]);
    expect(heldInHistory(points, 10, 20, 17)).toEqual([
      { v: 20, dt: 5 },
      { v: 30, dt: 2 },
    ]);
    expect(heldInHistory(points, 20, 30, 18)).toEqual([]);
  });

  it('takes statistics rows in a group, leaving out the one carried in', () => {
    const rows = [
      { t: 0, v: 1, carried: true },
      { t: 0, v: 2, min: 1, max: 3 },
      { t: 1, v: null },
      { t: 2, v: 4, min: null, max: null },
      { t: 5, v: 9 },
    ];
    expect(heldInStatistics(rows, 0, 5)).toEqual([
      { v: 2, dt: 1, min: 1, max: 3 },
      { v: 4, dt: 1, min: undefined, max: undefined },
    ]);
  });

  it('spreads std, ci95 and min_max, weighted by time and kept within the readings', () => {
    const held = [
      { v: 15, dt: 1 },
      { v: 25, dt: 1 },
    ];
    expect(whiskerOf(held, 'std')).toEqual({ lo: 15, hi: 25 });
    // Two readings: 20 ± 6.9 would pass them, so it stops at them.
    expect(whiskerOf(held, 'ci95')).toEqual({ lo: 15, hi: 25 });
    const eight = Array.from({ length: 8 }, (_, i) => ({ v: i % 2 ? 25 : 15, dt: 1 }));
    const ci = whiskerOf(eight, 'ci95')!;
    expect(ci.lo).toBeCloseTo(20 - (1.96 * 5) / Math.sqrt(8));
    expect(ci.hi).toBeCloseTo(20 + (1.96 * 5) / Math.sqrt(8));
    expect(whiskerOf(held, 'min_max')).toEqual({ lo: 15, hi: 25 });
    // Three hours at 10, one at 30: mean 15, sd √75 ≈ 8.66, low end held at the lowest reading.
    const w = whiskerOf(
      [
        { v: 10, dt: 3 },
        { v: 30, dt: 1 },
      ],
      'std',
    )!;
    expect(w.lo).toBe(10);
    expect(w.hi).toBeCloseTo(15 + Math.sqrt(75));
    // Statistics rows bring their own lows and highs.
    expect(whiskerOf([{ v: 5, dt: 1, min: 2, max: 9 }], 'min_max')).toEqual({ lo: 2, hi: 9 });
  });

  it('has no whisker for an empty group, or one reading for std and ci95', () => {
    expect(whiskerOf([], 'min_max')).toBeNull();
    expect(whiskerOf([{ v: 1, dt: 1 }], 'std')).toBeNull();
    expect(
      whiskerOf(
        [
          { v: 1, dt: 0 },
          { v: 3, dt: 0 },
        ],
        'std',
      ),
    ).toEqual({ lo: 1, hi: 3 });
  });

  it('lines whiskers up with the slots', () => {
    const readings = [
      { t: 0, v: 1 },
      { t: 5, v: 3 },
      { t: 10, v: 7 },
    ];
    expect(whiskersFor(readings, [0, 10], [10, 20], 'min_max', false, 15)).toEqual([
      { lo: 1, hi: 3 },
      { lo: 7, hi: 7 },
    ]);
    expect(whiskersFor(readings, [0, 10], [10, 20], 'min_max', true, 15)).toEqual([
      { lo: 1, hi: 3 },
      { lo: 7, hi: 7 },
    ]);
  });
});

describe('error bars on the column chart', () => {
  it('draws a whisker on each grouped column and widens the axis to fit', async () => {
    const card = await mount({ group_by: 'day', error_bars: 'std' });
    const cols = qa(card, '.col');
    const whiskers = qa(card, '.whisker-bar');
    expect(cols.length).toBeGreaterThan(2);
    // A whisker for every column with more than one reading in it.
    expect(whiskers.length).toBeGreaterThanOrEqual(cols.length - 2);
    // The top whisker reaches 25, past the columns' 20.
    const top = Math.max(...qa(card, '.y-axis .axis-label').map((l) => Number(l.textContent)));
    expect(top).toBeGreaterThanOrEqual(25);
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.5);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).toMatch(/^Temp \d+\.\d °C \(\d+\.\d – \d+\.\d\)$/);
  });

  it("reads each shown series' own whiskers in the tooltip when names hide one", async () => {
    localStorage.clear();
    const card = await mount({
      group_by: 'day',
      error_bars: 'min_max',
      legend_toggle: true,
      entities: ['sensor.temp', 'sensor.hum'],
    });
    const first = q(card, 'button.series-toggle') as HTMLElement;
    first.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 3; i++) {
      await card.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(qa(card, '.whisker-bar').length).toBe(qa(card, '.col').length);
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.5);
    await card.updateComplete;
    const rows = tooltipRows(card);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^Humidity \d+ % \(\d+ – \d+\)$/);
    localStorage.clear();
  });

  it('draws whiskers beside each series in side-by-side columns', async () => {
    const card = await mount({ group_by: 'day', error_bars: 'min_max', entities: ['sensor.temp', 'sensor.hum'] });
    expect(qa(card, '.whisker-bar').length).toBe(qa(card, '.col').length);
  });

  it.each([
    ['ungrouped', { group_by: 'none' }],
    ['stacked', { group_by: 'day', stack: 'normal', entities: ['sensor.temp', 'sensor.hum'] }],
    ['as ranges', { group_by: 'day', range: true }],
    ['on a meter’s change', { entities: ['sensor.energy'] }],
  ])('leaves them out %s', async (_, extra) => {
    const card = await mount({ error_bars: 'min_max', ...extra });
    expect(qa(card, '.col').length).toBeGreaterThan(0);
    expect(qa(card, '.whisker-bar')).toHaveLength(0);
  });

  it('reads statistics as hourly rows so each day keeps its spread', async () => {
    const rows = Array.from({ length: 72 }, (_, i) => ({
      start: now - (72 - i) * H,
      mean: i % 2 ? 24 : 16,
      min: i % 2 ? 22 : 14,
      max: i % 2 ? 26 : 18,
    }));
    const hass = chartHass(states, history, { 'sensor.temp': rows });
    const card = await mount({ group_by: 'day', source: 'statistics', error_bars: 'min_max' }, hass);
    const call = (hass.callWS as unknown as { mock: { calls: [{ period: string; types: string[] }][] } }).mock
      .calls[0][0];
    expect(call.period).toBe('hour');
    expect(call.types).toEqual(expect.arrayContaining(['mean', 'min', 'max']));
    expect(qa(card, '.whisker-bar').length).toBeGreaterThan(0);
  });

  it('rejects an unknown kind', () => {
    const card = document.createElement('chartdeck-card') as HTMLElement & { setConfig(c: CardConfig): void };
    expect(() => card.setConfig({ type: 'x', style: 'column', entities: ['sensor.temp'], error_bars: 'big' })).toThrow(
      /error_bars/,
    );
  });
});

describe('error bars in the editor', () => {
  it('offers the choice only when columns are grouped, and writes it', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'column', entities: ['sensor.temp'] } as CardConfig;
    const { form, change, events } = await mountEditor(raw, chartHass(states, {}));
    expect(form().data).toMatchObject({ error_bars: 'none' });
    expect(JSON.stringify(form().schema)).toContain('"error_bars"');
    expect(JSON.stringify(form().schema)).toContain('95 % confidence interval of the mean');
    change({ error_bars: 'ci95' });
    expect(events.at(-1)).toEqual({ ...raw, error_bars: 'ci95' });
    const ungrouped = await mountEditor({ ...raw, group_by: 'none' }, chartHass(states, {}));
    expect(JSON.stringify(ungrouped.form().schema)).not.toContain('"error_bars"');
  });
});
