import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { sparkDomain, sparkKind, sparkRaw } from '../src/styles/sparkline';
import type { ResolvedEntity } from '../src/resolve';
import type { CardConfig } from '../src/types';
import { H, ago, chartHass, mountCard, mountEditor, q, qa } from './helpers/chart';
import type { Card } from './helpers/chart';

const now = Date.now();
const sec = (ms: number) => ago(now, ms);

const states = {
  'sensor.temp': ['21', { friendly_name: 'Temp', unit_of_measurement: '°C' }],
  'sensor.power': ['-200', { friendly_name: 'Power', unit_of_measurement: 'W' }],
  'sensor.off': ['unavailable', { friendly_name: 'Off' }],
} as const;

const history = {
  'sensor.temp': [
    { s: '18', lu: sec(20 * H) },
    { s: '22', lu: sec(12 * H) },
    { s: 'unavailable', lu: sec(8 * H) },
    { s: '21', lu: sec(4 * H) },
  ],
  'sensor.power': [
    { s: '400', lu: sec(20 * H) },
    { s: '-600', lu: sec(10 * H) },
  ],
};

const mount = (config: Record<string, unknown>, hass = chartHass(states, history)) =>
  mountCard({ style: 'sparkline', entities: ['sensor.temp', 'sensor.power'], ...config } as Partial<CardConfig>, hass);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('sparkline maths', () => {
  it('takes the kind from the entity, then the card, then a line', () => {
    const e = (spark?: string) => ({ config: { entity: 'x', spark } }) as unknown as ResolvedEntity;
    const raw = { type: 'x', spark: 'area' } as CardConfig;
    expect(sparkKind(e('column'), raw)).toBe('column');
    expect(sparkKind(e(), raw)).toBe('area');
    expect(sparkKind(e(), { type: 'x' })).toBe('line');
  });

  it('groups column sparklines that are not grouped', () => {
    const raw = { type: 'x' } as CardConfig;
    expect(sparkRaw(raw, ['line'])).toBe(raw);
    expect(sparkRaw(raw, ['column'])).toMatchObject({ group_by: 'hour', aggregate: 'mean' });
    expect(sparkRaw({ ...raw, period: { last: 7, unit: 'day' } }, ['column']).group_by).toBe('day');
    expect(sparkRaw({ ...raw, period: { calendar: 'day' } }, ['column']).group_by).toBe('hour');
    expect(sparkRaw({ ...raw, group_by: 'week' }, ['column']).group_by).toBe('week');
    expect(sparkRaw({ ...raw, aggregate: 'max' }, ['column']).aggregate).toBe('max');
  });

  it('fits a sparkline to its own readings, with zero in for columns', () => {
    expect(sparkDomain([], false)).toBeUndefined();
    const [lo, hi] = sparkDomain([10, 20], false)!;
    expect(lo).toBeLessThan(10);
    expect(hi).toBeGreaterThan(20);
    expect(sparkDomain([10, 20], true)).toEqual([0, 20]);
    expect(sparkDomain([0], true)).toEqual([0, 1]);
  });
});

describe('sparklines', () => {
  it('draws a row per entity: name, a tiny line broken at gaps, and the value', async () => {
    const card = await mount({});
    const rows = qa(card, '.spark-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-index')).toBe('0');
    expect(rows[0].querySelector('.name')!.textContent).toBe('Temp');
    expect(rows[0].querySelector('.value')!.textContent).toBe('21.0 °C');
    expect(rows[0].querySelector('.spark-line')!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(rows[0].querySelector('svg')!.getAttribute('aria-label')).toBe('Trend of Temp');
    expect(q(card, '.axis-label')).toBeNull();
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
  });

  it('fills areas and draws columns, per card or per entity', async () => {
    const card = await mount({ spark: 'area', entities: ['sensor.temp', { entity: 'sensor.power', spark: 'column' }] });
    expect(qa(card, '.spark-fill')).toHaveLength(1);
    expect(qa(card, '.spark-columns rect').length).toBeGreaterThan(5);
    // The power column sparkline goes below zero.
    const rects = qa(card, '.spark-columns rect');
    expect(new Set(rects.map((r) => r.getAttribute('y'))).size).toBeGreaterThan(1);
  });

  it('puts the 1.0 thin bar under the name and value, with the target', async () => {
    const card = await mount({
      bar: true,
      min: 0,
      max: 40,
      target: 20,
      entities: [{ entity: 'sensor.temp', color: 'red' }],
    });
    const row = q(card, '.spark-row')!;
    expect(row.classList.contains('with-bar')).toBe(true);
    expect(row.querySelector('.spark-body .top .value')!.textContent).toBe('21.0 °C');
    expect(row.querySelector('.spark-track')!.getAttribute('style')).toContain('--end:0.525');
    expect(row.querySelector('.spark-target')).not.toBeNull();
    expect(row.querySelector('.spark-line')!.getAttribute('stroke')).toContain('--error-color');
  });

  it('keeps a row for unavailable and missing entities, and says when loading failed', async () => {
    const card = await mount({ entities: ['sensor.off', 'sensor.nope'] });
    const rows = qa(card, '.spark-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains('unavailable')).toBe(true);
    expect(rows[0].querySelector('.spark-line')).toBeNull();
    const failed = await mount({}, chartHass(states, history, {}, true));
    expect(q(failed, '.spark-message.error')!.textContent).toContain('boom');
  });

  it('opens more-info from a row', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const row = qa(card, '.spark-row')[1] as HTMLElement;
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.power']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'sparkline', entities: ['sensor.temp'], ...extra } as CardConfig);
    expect(set({ spark: 'pie' })).toThrow(/spark/);
    expect(set({ entities: [{ entity: 'sensor.temp', spark: 'pie' }] })).toThrow(/spark/);
    expect(set({ bar: 'yes' })).toThrow(/bar/);
    expect(set({ line_width: 40 })).toThrow(/line_width/);
    expect(set({ spark: 'column', bar: true, line_width: 2 })).not.toThrow();
  });
});

describe('sparkline editor', () => {
  it('edits the kind, shape, width and bar, and a kind and colour per entity', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'sparkline', entities: ['sensor.temp'] } as CardConfig;
    const { form, change, events, entityFields } = await mountEditor(raw, chartHass(states, {}));
    expect(form().data).toMatchObject({ spark: 'line', curve: 'smooth', line_width: 1.5, spark_bar: false });
    change({ spark: 'column', spark_bar: true });
    expect(events.at(-1)).toEqual({ ...raw, spark: 'column', bar: true });
    expect(entityFields().fields.map((f) => f.name)).toEqual(['spark', 'spark_color']);
  });
});
