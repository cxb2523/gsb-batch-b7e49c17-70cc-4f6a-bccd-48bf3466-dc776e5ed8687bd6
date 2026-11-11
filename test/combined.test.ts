import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { axisSides, combinedRaw, seriesAggregate, seriesType } from '../src/styles/combined';
import type { ResolvedEntity } from '../src/resolve';
import type { CardConfig } from '../src/types';
import { H, ago, chartHass, mountCard, mountEditor, pointAt, q, qa, tooltipRows } from './helpers/chart';
import type { Card } from './helpers/chart';

const now = Date.now();
const sec = (ms: number) => ago(now, ms);
const D = 24 * H;

const states = {
  'sensor.energy': ['1000', { friendly_name: 'Energy', unit_of_measurement: 'kWh', state_class: 'total_increasing' }],
  'sensor.temp': ['20', { friendly_name: 'Temp', unit_of_measurement: '°C', state_class: 'measurement' }],
  'sensor.power': ['300', { friendly_name: 'Power', unit_of_measurement: 'W' }],
} as const;

const history = {
  'sensor.energy': Array.from({ length: 11 }, (_, i) => ({ s: String(1000 + 10 * i), lu: sec((10 - i) * D + H) })),
  'sensor.temp': [
    { s: '15', lu: sec(8 * D) },
    { s: '25', lu: sec(3 * D) },
    { s: '18', lu: sec(5 * H) },
  ],
  'sensor.power': [
    { s: '400', lu: sec(20 * H) },
    { s: '-600', lu: sec(10 * H) },
    { s: 'unavailable', lu: sec(5 * H) },
  ],
};

const mount = (config: Record<string, unknown>) =>
  mountCard({ style: 'combined', ...config } as Partial<CardConfig>, chartHass(states, history));

const entity = (unit: string, extra: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) =>
  ({ unit, config: { entity: 'sensor.x', ...extra }, stateObj: { attributes: attrs } }) as unknown as ResolvedEntity;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('combined chart maths', () => {
  it('puts a second unit on the right axis, unless told', () => {
    expect(axisSides([entity('kWh'), entity('°C'), entity('kWh')])).toEqual(['left', 'right', 'left']);
    expect(axisSides([entity('kWh'), entity('°C', { y_axis: 'left' })])).toEqual(['left', 'left']);
    expect(axisSides([entity('kWh', { y_axis: 'right' })])).toEqual(['left']);
    expect(seriesType(entity('W'))).toBe('line');
    expect(seriesType(entity('W', { type: 'area' }))).toBe('area');
  });

  it('groups to fit only when there are columns, and combines each series its own way', () => {
    const raw = { type: 'x', period: { last: 7, unit: 'day' } } as CardConfig;
    const col = entity('kWh', { type: 'column' }, { state_class: 'total_increasing' });
    expect(combinedRaw(raw, [col]).group_by).toBe('day');
    expect(combinedRaw(raw, [entity('W')]).group_by).toBeUndefined();
    expect(combinedRaw({ ...raw, group_by: 'none' }, [col]).group_by).toBeUndefined();
    expect(combinedRaw({ ...raw, group_by: 'hour', aggregate: 'auto' }, [col])).toMatchObject({ group_by: 'hour' });
    expect(combinedRaw({ ...raw, aggregate: 'auto' }, [col])).not.toHaveProperty('aggregate');
    expect(seriesAggregate(col, raw)).toBe('change');
    expect(seriesAggregate(entity('°C'), raw)).toBe('mean');
    expect(seriesAggregate(entity('°C'), { ...raw, aggregate: 'max' })).toBe('max');
    expect(seriesAggregate(entity('°C', { aggregate: 'min' }), { ...raw, aggregate: 'max' })).toBe('min');
  });
});

describe('combined chart', () => {
  it('draws daily energy columns with the average temperature as a line on a second axis', async () => {
    const card = await mount({
      period: { last: 7, unit: 'day' },
      entities: [{ entity: 'sensor.energy', type: 'column' }, 'sensor.temp'],
    });
    expect(qa(card, '.col').length).toBeGreaterThanOrEqual(7);
    expect(qa(card, '.lines-over path.line')).toHaveLength(1);
    expect(q(card, '.plot-wrap')!.classList.contains('has-right')).toBe(true);
    expect(qa(card, '.y-axis.right .axis-label').length).toBeGreaterThan(1);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Combined chart of Energy, Temp');
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.5);
    await card.updateComplete;
    const rows = tooltipRows(card);
    expect(rows[0]).toBe('Energy 10.0 kWh');
    expect(rows[1]).toMatch(/^Temp \d+\.\d °C$/);
    // A dot on the line only.
    expect(qa(card, '.hover-dot')).toHaveLength(1);
  });

  it('draws an area with a line, and all three together', async () => {
    const two = await mount({
      entities: [
        { entity: 'sensor.power', type: 'area' },
        { entity: 'sensor.temp', y_axis: 'left' },
      ],
    });
    expect(qa(two, 'path.fill')).toHaveLength(1);
    expect(qa(two, '.lines-over path.line')).toHaveLength(1);
    expect(q(two, '.plot-wrap')!.classList.contains('has-right')).toBe(false);
    const three = await mount({
      period: { last: 2, unit: 'day' },
      axis_labels: 'inside',
      entities: [
        { entity: 'sensor.power', type: 'area' },
        { entity: 'sensor.energy', type: 'column', y_axis: 'right' },
        'sensor.temp',
      ],
    });
    expect(qa(three, 'path.fill')).toHaveLength(1);
    expect(qa(three, '.col').length).toBeGreaterThan(0);
    expect(qa(three, '.lines-over path.line')).toHaveLength(1);
    expect(q(three, '.plot-area .y-axis.right')).not.toBeNull();
  });

  it('draws one column per reading when not grouped', async () => {
    const card = await mount({
      group_by: 'none',
      entities: [{ entity: 'sensor.power', type: 'column' }, 'sensor.temp'],
    });
    expect(qa(card, '.col')).toHaveLength(2);
    pointAt(q(card, '.plot-area')!, 'pointermove', 1 - 15 / 24);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).toBe('Power 400.0 W');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'combined', entities: ['sensor.temp'], ...extra } as CardConfig);
    expect(set({ entities: [{ entity: 'sensor.temp', type: 'pie' }] })).toThrow(/type/);
    expect(set({ entities: [{ entity: 'sensor.temp', y_axis: 'middle' }] })).toThrow(/y_axis/);
    expect(set({ entities: [{ entity: 'sensor.temp', aggregate: 'median' }] })).toThrow(/aggregate/);
    expect(set({ group_by: 'year' })).toThrow(/group_by/);
    expect(set({ aggregate: 'median' })).toThrow(/aggregate/);
    expect(set({ rounded: 'no' })).toThrow(/rounded/);
    expect(
      set({
        group_by: 'auto',
        aggregate: 'auto',
        entities: [{ entity: 'sensor.temp', type: 'area', y_axis: 'right' }],
      }),
    ).not.toThrow();
  });
});

describe('combined chart editor', () => {
  it('edits the chart, and each entity’s type, axis and combining', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'combined', entities: ['sensor.temp'] } as CardConfig;
    const { form, change, events, entityFields } = await mountEditor(raw, chartHass(states, {}));
    expect(form().data).toMatchObject({ group_by: 'auto', aggregate: 'auto', curve: 'smooth', rounded: true });
    change({ group_by: 'none', rounded: false });
    expect(events.at(-1)).toEqual({ ...raw, group_by: 'none', rounded: false });
    expect(entityFields().fields.map((f) => f.name)).toEqual([
      'series_type',
      'series_axis',
      'series_color',
      'series_aggregate',
      'curve',
      'line_width',
      'dash',
      'negative_color',
    ]);
  });
});
