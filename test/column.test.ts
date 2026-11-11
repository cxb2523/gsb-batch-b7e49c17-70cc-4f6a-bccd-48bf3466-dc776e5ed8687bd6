import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import {
  autoGroupUnit,
  columnBox,
  columnRaw,
  columnTable,
  isMeter,
  labelEvery,
  spread,
  zeroBased,
} from '../src/chart/columns';
import { groupHistory, groupStatistics, statisticsQueryFor } from '../src/history/group';
import { parsePeriod } from '../src/history/period';
import type { ResolvedEntity } from '../src/resolve';
import { fullPeriod, groupHeading } from '../src/styles/column';
import type { CardConfig } from '../src/types';
import { H, ago, chartHass, mountCard, mountEditor, pointAt, q, qa, tooltipRows } from './helpers/chart';
import type { Card } from './helpers/chart';

const now = Date.now();
const sec = (ms: number) => ago(now, ms);
const D = 24 * H;

const states = {
  'sensor.energy': ['1000', { friendly_name: 'Energy', unit_of_measurement: 'kWh', state_class: 'total_increasing' }],
  'sensor.solar': ['40', { friendly_name: 'Solar', unit_of_measurement: 'kWh', state_class: 'total_increasing' }],
  'sensor.temp': ['20', { friendly_name: 'Temp', unit_of_measurement: '°C', state_class: 'measurement' }],
  'sensor.grid': ['-200', { friendly_name: 'Grid', unit_of_measurement: 'W' }],
} as const;

/** A meter that goes up 10 a day for the last 10 days. */
const meter = (perDay: number) =>
  Array.from({ length: 11 }, (_, i) => ({ s: String(1000 + perDay * i), lu: sec((10 - i) * D + H) }));

const history = {
  'sensor.energy': meter(10),
  'sensor.solar': meter(4),
  'sensor.temp': [
    { s: '15', lu: sec(30 * H) },
    { s: '25', lu: sec(20 * H) },
    { s: '18', lu: sec(5 * H) },
  ],
  'sensor.grid': [
    { s: '400', lu: sec(20 * H) },
    { s: '-600', lu: sec(10 * H) },
    { s: 'unavailable', lu: sec(5 * H) },
  ],
};

const mount = (config: Record<string, unknown>, hass = chartHass(states, history)) =>
  mountCard({ style: 'column', entities: ['sensor.energy'], ...config } as Partial<CardConfig>, hass);

const entity = (attrs: Record<string, unknown>, attribute?: string) =>
  ({ config: { entity: 'sensor.x', attribute }, stateObj: { attributes: attrs } }) as unknown as ResolvedEntity;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('column maths', () => {
  it('picks a grouping for the span', () => {
    expect(autoGroupUnit(parsePeriod({ last: 24, unit: 'hour' }))).toBe('hour');
    expect(autoGroupUnit(parsePeriod({ last: 7, unit: 'day' }))).toBe('day');
    expect(autoGroupUnit(parsePeriod({ last: 12, unit: 'week' }))).toBe('week');
    expect(autoGroupUnit(parsePeriod({ last: 12, unit: 'month' }))).toBe('month');
    expect(autoGroupUnit(parsePeriod({ calendar: 'day' }))).toBe('hour');
    expect(autoGroupUnit(parsePeriod({ calendar: 'year' }))).toBe('month');
  });

  it('fills in 7 days, automatic grouping, and the change for meters', () => {
    const meters = [entity({ state_class: 'total_increasing' }), entity({ state_class: 'total' })];
    const raw = { type: 'x' } as CardConfig;
    expect(columnRaw(raw, meters)).toMatchObject({
      period: { last: 7, unit: 'day' },
      group_by: 'day',
      aggregate: 'change',
    });
    expect(columnRaw({ ...raw, range: true }, meters).aggregate).toBe('mean');
    expect(columnRaw(raw, [...meters, entity({ state_class: 'measurement' })]).aggregate).toBe('mean');
    expect(columnRaw({ ...raw, group_by: 'none', aggregate: 'max' }, meters)).not.toHaveProperty('group_by');
    expect(columnRaw({ ...raw, group_by: 'week', period: { calendar: 'day' } }, meters).group_by).toBe('week');
    expect(isMeter(entity({ state_class: 'total_increasing' }, 'reading'))).toBe(false);
  });

  it('lines readings up into slots, holding values and dropping the empty last one', () => {
    const t = columnTable(
      [
        [
          { t: 0, v: 1 },
          { t: 20, v: 2 },
          { t: 30, v: 2 },
        ],
        [{ t: 10, v: 5, min: 4, max: 6 }],
      ],
      30,
    );
    expect(t.times).toEqual([0, 10, 20]);
    expect(t.ends).toEqual([10, 20, 30]);
    expect(t.values).toEqual([
      [1, 1, 2],
      [null, 5, 5],
    ]);
    expect(t.lows[1]).toEqual([null, 4, null]);
    const grouped = columnTable([[{ t: 0, end: 24, v: 3 }]], Infinity);
    expect(grouped.ends).toEqual([24]);
  });

  it('places columns side by side in a slot, and fits the axis to zero', () => {
    expect(columnBox(0, 100, 0, 1)).toEqual([10, 80]);
    const [l0, w0] = columnBox(0, 100, 0, 2);
    const [l1] = columnBox(0, 100, 1, 2);
    expect(l1 - l0).toBeCloseTo(40);
    expect(w0).toBeCloseTo(40 * 0.88);
    const raw = { type: 'x' } as CardConfig;
    expect(zeroBased([5, 10], raw).y_min).toBe(0);
    expect(zeroBased([-5, -1], raw).y_max).toBe(0);
    expect(zeroBased([5, 10], { ...raw, y_min: 3 }).y_min).toBe(3);
    expect(spread([3, null, 7])).toEqual([0, 7]);
    expect(spread([3, 7], false)).toEqual([3, 7]);
    expect(spread([null], false)).toBeUndefined();
    expect(labelEvery(30, 8)).toBe(4);
    expect(labelEvery(3, 0)).toBe(3);
  });

  it('keeps each group’s lowest and highest when asked', () => {
    const pts = [
      { t: 0, v: 5 },
      { t: 10, v: 9 },
      { t: 20, v: 1 },
    ];
    const [g] = groupHistory(pts, [0, 30], 'mean', 30, true);
    expect([g.min, g.max]).toEqual([1, 9]);
    expect(groupHistory(pts, [0, 30], 'mean', 30)[0].min).toBeUndefined();
    const rows = [
      { t: 0, v: 5, min: 2, max: 8 },
      { t: 10, v: 6, min: null, max: null },
    ];
    const [s] = groupStatistics(rows, [0, 20], 'mean', Infinity, true);
    expect([s.min, s.max]).toEqual([2, 8]);
    const zone = { timeZone: 'UTC', firstDay: 1 };
    expect(statisticsQueryFor({ unit: 'day', aggregate: 'mean' }, zone, 'UTC', true).types).toEqual([
      'mean',
      'min',
      'max',
    ]);
    expect(statisticsQueryFor({ unit: 'day', aggregate: 'mean' }, zone, 'UTC').types).toEqual(['mean']);
  });

  it('names a group in the tooltip', () => {
    const start = Date.UTC(2026, 9, 26);
    expect(groupHeading(start, start + D, 'day', undefined)).toMatch(/26/);
    expect(groupHeading(start, start + 7 * D, 'week', undefined)).toMatch(/26.*1|Oct.*Nov/);
    expect(groupHeading(start, start + 31 * D, 'month', undefined)).toMatch(/2026/);
    expect(groupHeading(start, start + H, 'hour', undefined)).toMatch(/–/);
  });

  it('keeps a rolling period whole when the editor writes it', () => {
    expect(fullPeriod({ type: 'x', period: { last: 24 } })).toEqual({ type: 'x', period: { last: 24, unit: 'day' } });
    expect(fullPeriod({ type: 'x', period: { calendar: 'week' } })).toEqual({
      type: 'x',
      period: { calendar: 'week' },
    });
    expect(fullPeriod({ type: 'x' })).toEqual({ type: 'x' });
  });
});

describe('column chart', () => {
  it('shows a meter as daily totals over the last 7 days with no setup', async () => {
    const card = await mount({ labels: true });
    const cols = qa(card, '.col');
    expect(cols.length).toBeGreaterThanOrEqual(7);
    expect(cols.length).toBeLessThanOrEqual(8);
    expect(cols.every((c) => c.classList.contains('cap-top'))).toBe(true);
    expect(qa(card, '.col-label').some((l) => l.textContent === '10.0')).toBe(true);
    // A label under every day, or every other one on a narrow card.
    expect(qa(card, '.x-axis .axis-label').length).toBeGreaterThanOrEqual(4);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Column chart of Energy');
    const area = q(card, '.plot-area')!;
    pointAt(area, 'pointermove', 0.5);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).toMatch(/^Energy 10\.0 kWh$/);
    expect(q(card, '.slot-hover')).not.toBeNull();
    expect(qa(card, '.hover-dot')).toHaveLength(0);
  });

  it('draws series side by side, coloured by band, with a target on each column', async () => {
    const card = await mount({
      entities: [{ entity: 'sensor.energy', target: 8 }, 'sensor.solar'],
      color_by: 'bands',
      severity: [
        { from: 0, color: 'green' },
        { from: 5, color: 'red' },
      ],
    });
    const a = qa(card, '.col[data-series="0"]');
    const b = qa(card, '.col[data-series="1"]');
    expect(a.length).toBe(b.length);
    expect(a[1].getAttribute('style')).toContain('--error-color');
    expect(b[1].getAttribute('style')).toContain('--success-color');
    expect(qa(card, '.target-mark').length).toBe(a.length);
  });

  it('stacks columns with a total, and to 100 %', async () => {
    const card = await mount({ stack: 'normal', labels: true, entities: ['sensor.energy', 'sensor.solar'] });
    expect(qa(card, '.col.cap-top').every((c) => c.getAttribute('data-series') === '1')).toBe(true);
    expect(qa(card, '.col-label').some((l) => l.textContent === '14.0')).toBe(true);
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.5);
    await card.updateComplete;
    expect(tooltipRows(card)).toEqual(['Energy 10.0 kWh', 'Solar 4.0 kWh', 'Total 14.0 kWh']);
    const pct = await mount({ stack: 'percent', entities: ['sensor.energy', 'sensor.solar'] });
    expect(qa(pct, '.y-axis .axis-label').at(-1)!.textContent).toBe('100');
    pointAt(q(pct, '.plot-area')!, 'pointermove', 0.5);
    await pct.updateComplete;
    expect(tooltipRows(pct)[0]).toBe('Energy 10.0 kWh · 71 %');
  });

  it('hangs negative columns below zero, and leaves a gap while unavailable', async () => {
    const card = await mount({ entities: ['sensor.grid'], period: { last: 24, unit: 'hour' }, labels: true });
    expect(qa(card, '.col.cap-bottom').length).toBeGreaterThan(0);
    expect(qa(card, '.col.down').length).toBeGreaterThan(0);
    expect(qa(card, '.col').length).toBeLessThan(24);
  });

  it('draws one column per reading when not grouped', async () => {
    const card = await mount({ entities: ['sensor.temp'], group_by: 'none', period: { last: 2, unit: 'day' } });
    expect(qa(card, '.col')).toHaveLength(3);
  });

  it('draws range columns from each group’s lowest to highest, from statistics', async () => {
    const stats = {
      'sensor.temp': [
        { start: now - 2 * D, mean: 18, min: 12, max: 24 },
        { start: now - D, mean: 20, min: 15, max: 26 },
      ],
    };
    const hass = chartHass(states, history, stats);
    const card = await mount({ entities: ['sensor.temp'], range: true, source: 'statistics', group_by: 'day' }, hass);
    expect(qa(card, '.col.cap-both').length).toBeGreaterThan(0);
    expect(qa(card, '.col-mark').length).toBe(qa(card, '.col.cap-both').length);
    const call = (hass.callWS as unknown as { mock: { calls: [{ types: string[] }][] } }).mock.calls[0][0];
    expect(call.types).toEqual(expect.arrayContaining(['mean', 'min', 'max']));
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.8);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).toMatch(/Temp \d+\.\d – \d+\.\d °C/);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'column', entities: ['sensor.energy'], ...extra } as CardConfig);
    expect(set({ group_by: 'year' })).toThrow(/group_by/);
    expect(set({ aggregate: 'median' })).toThrow(/aggregate/);
    expect(set({ range: 'yes' })).toThrow(/range/);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ stack: 'up' })).toThrow(/stack/);
    expect(set({ group_by: 'auto', aggregate: 'auto', rounded: false })).not.toThrow();
    expect(set({ group_by: 'none' })).not.toThrow();
  });
});

describe('column chart editor', () => {
  it('defaults to 7 days with automatic grouping and writes its own options', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'column', entities: ['sensor.energy'] } as CardConfig;
    const { form, change, events, entityFields } = await mountEditor(raw, chartHass(states, {}));
    expect(form().data).toMatchObject({
      period_last: 7,
      period_unit: 'day',
      group_by: 'auto',
      aggregate: 'auto',
      stack: 'none',
      range: false,
      column_labels: false,
      rounded: true,
      color_by: 'series',
    });
    change({ period_last: 24 });
    expect(events.at(-1)).toEqual({ ...raw, period: { last: 24, unit: 'day' } });
    change({ stack: 'percent', column_labels: true, rounded: false, range: true, group_by: 'none' });
    expect(events.at(-1)).toEqual({
      ...raw,
      stack: 'percent',
      labels: true,
      rounded: false,
      range: true,
      group_by: 'none',
    });
    const schema = JSON.stringify(form().schema);
    expect(schema).toContain('"aggregate"');
    expect(entityFields().fields.map((f) => f.name)).toEqual(['column_color']);
  });

  it('hides the combine choice when each reading is its own column', async () => {
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'column',
      group_by: 'none',
      entities: ['sensor.energy'],
    } as CardConfig;
    const { form } = await mountEditor(raw, chartHass(states, {}));
    expect(JSON.stringify(form().schema)).not.toContain('"aggregate"');
  });
});
