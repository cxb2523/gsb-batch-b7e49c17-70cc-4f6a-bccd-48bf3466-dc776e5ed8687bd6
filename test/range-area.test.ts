import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { groupHistory, groupStatistics, statisticsQueryFor } from '../src/history/group';
import { bandPath, bandRuns, rangeRaw } from '../src/styles/range-area';
import type { CardConfig } from '../src/types';
import { H, ago, chartHass, mountCard, mountEditor, pointAt, q, qa, tooltipRows } from './helpers/chart';
import type { Card } from './helpers/chart';

const now = Date.now();

const states = {
  'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
} as const;

/** Hourly statistics for the last day: mean 10 + i/4, spread ±3; a gap three hours long. */
const hourly = Array.from({ length: 24 }, (_, i) => {
  const gap = i >= 10 && i < 13;
  const mean = 10 + i / 4;
  return { start: now - (24 - i) * H, mean: gap ? null : mean, min: gap ? null : mean - 3, max: gap ? null : mean + 3 };
});

const history = {
  'sensor.in': [
    { s: '18', lu: ago(now, 40 * H) },
    { s: '22', lu: ago(now, 30 * H) },
    { s: '20', lu: ago(now, 20 * H) },
  ],
};

const mount = (config: Record<string, unknown>, hass = chartHass(states, history, { 'sensor.out': hourly })) =>
  mountCard({ style: 'range_area', entities: ['sensor.out'], ...config } as Partial<CardConfig>, hass);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('range area maths', () => {
  it('reads statistics unless told otherwise, and groups history so it has a spread', () => {
    const raw = { type: 'x' } as CardConfig;
    expect(rangeRaw(raw).source).toBe('statistics');
    expect(rangeRaw(raw).group_by).toBeUndefined();
    expect(rangeRaw({ ...raw, source: 'history' }).group_by).toBe('hour');
    expect(rangeRaw({ ...raw, source: 'history', period: { last: 7, unit: 'day' } }).group_by).toBe('day');
    expect(rangeRaw({ ...raw, source: 'history', period: { calendar: 'day' } }).group_by).toBe('hour');
    expect(rangeRaw({ ...raw, source: 'history', group_by: 'week' }).group_by).toBe('week');
  });

  it('splits at gaps and closes the band back along the lows', () => {
    const runs = bandRuns([
      { t: 0, v: 5, min: 2, max: 8 },
      { t: 1, v: 6 },
      { t: 2, v: null },
      { t: 3, v: 4, min: 1, max: 9 },
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0][1]).toEqual({ t: 1, v: 6, lo: 6, hi: 6 });
    const highs: [number, number][] = [
      [0, 10],
      [10, 20],
    ];
    const lows: [number, number][] = [
      [0, 50],
      [10, 60],
    ];
    expect(bandPath(highs, lows, 'straight')).toBe('M0,10L10,20L10,60L0,50Z');
    expect(bandPath(highs, lows, 'step')).toBe('M0,10L10,10L10,20L10,60L10,50L0,50Z');
    expect(bandPath([[0, 1]], [[0, 2]], 'smooth')).toBe('');
  });

  it('keeps each group’s spread when asked', () => {
    const pts = [
      { t: 0, v: 5 },
      { t: 10, v: 9 },
    ];
    expect(groupHistory(pts, [0, 20], 'mean', 20, true)[0]).toMatchObject({ min: 5, max: 9 });
    const rows = [{ t: 0, v: 5, min: 1, max: 7 }];
    expect(groupStatistics(rows, [0, 20], 'mean', Infinity, true)[0]).toMatchObject({ min: 1, max: 7 });
    const zone = { timeZone: 'UTC', firstDay: 1 };
    expect(statisticsQueryFor({ unit: 'day', aggregate: 'max' }, zone, 'UTC', true).types).toEqual(['max', 'min']);
  });
});

describe('range area chart', () => {
  it('shades lowest to highest from statistics, broken at a gap, with the average through it', async () => {
    const hass = chartHass(states, history, { 'sensor.out': hourly });
    const card = await mount({}, hass);
    const band = q(card, 'path.band')!;
    expect(band.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(band.getAttribute('d')).toMatch(/Z$/);
    expect(q(card, 'path.line')).not.toBeNull();
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Range area chart of Outside');
    const msg = (hass.callWS as unknown as { mock: { calls: [{ type: string; types: string[] }][] } }).mock.calls[0][0];
    expect(msg.type).toBe('recorder/statistics_during_period');
    expect(msg.types).toEqual(expect.arrayContaining(['min', 'max']));
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.25);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).toMatch(/^Outside \d+\.\d – \d+\.\d °C · \d+\.\d$/);
    expect(qa(card, '.hover-dot')).toHaveLength(1);
  });

  it('can leave the average out', async () => {
    const card = await mount({ mean: false, curve: 'step' });
    expect(q(card, 'path.line')).toBeNull();
    pointAt(q(card, '.plot-area')!, 'pointermove', 0.25);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).not.toContain('·');
    expect(qa(card, '.hover-dot')).toHaveLength(0);
  });

  it('groups history to get a spread, and says when there is nothing', async () => {
    const card = await mount({ source: 'history', entities: ['sensor.in'], period: { last: 2, unit: 'day' } });
    expect(q(card, 'path.band')!.getAttribute('d')).toMatch(/Z/);
    const empty = await mount({ entities: ['sensor.missing'] }, chartHass(states, {}, {}));
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'range_area', entities: ['sensor.out'], ...extra } as CardConfig);
    expect(set({ mean: 'yes' })).toThrow(/mean/);
    expect(set({ source: 'cloud' })).toThrow(/source/);
    expect(set({ mean: false, group_by: 'day' })).not.toThrow();
  });
});

describe('range area editor', () => {
  it('defaults to statistics and edits the average line', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'range_area', entities: ['sensor.out'] } as CardConfig;
    const { ed, form, change, events, entityFields } = await mountEditor(raw, chartHass(states, {}));
    expect(form().data).toMatchObject({ source: 'statistics', mean: true, curve: 'smooth' });
    change({ mean: false, source: 'history', group_by: 'day' });
    expect(events.at(-1)).toEqual({ ...raw, mean: false, source: 'history', group_by: 'day' });
    await ed.updateComplete;
    change({ source: 'statistics' });
    expect(events.at(-1)).not.toHaveProperty('source');
    expect(entityFields().fields.map((f) => f.name)).toEqual(['range_color', 'curve', 'dash']);
  });
});
