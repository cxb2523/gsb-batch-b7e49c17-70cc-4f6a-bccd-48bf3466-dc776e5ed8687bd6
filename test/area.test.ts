import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { align, stackExtent, stackValues, totals, validateStack, valueAt } from '../src/chart/stack';
import { areaPath, edgePath, stepCorners, zeroFloor } from '../src/styles/area';
import type { CardConfig } from '../src/types';
import { H, ago, chartHass, mountCard, mountEditor, pointAt, q, qa, tooltipRows } from './helpers/chart';
import type { Card } from './helpers/chart';

const now = Date.now();
const sec = (ms: number) => ago(now, ms);

const states = {
  'sensor.solar': ['300', { friendly_name: 'Solar', unit_of_measurement: 'W' }],
  'sensor.grid': ['-200', { friendly_name: 'Grid', unit_of_measurement: 'W' }],
  'sensor.battery': ['100', { friendly_name: 'Battery', unit_of_measurement: 'W' }],
} as const;

const history = {
  'sensor.solar': [
    { s: '0', lu: sec(20 * H) },
    { s: '500', lu: sec(12 * H) },
    { s: 'unavailable', lu: sec(8 * H) },
    { s: '300', lu: sec(4 * H) },
  ],
  'sensor.grid': [
    { s: '400', lu: sec(20 * H) },
    { s: '-600', lu: sec(10 * H) },
    { s: '-200', lu: sec(2 * H) },
  ],
  'sensor.battery': [
    { s: '100', lu: sec(18 * H) },
    { s: '200', lu: sec(6 * H) },
  ],
};

const mount = (config: Record<string, unknown>, hass = chartHass(states, history)) =>
  mountCard({ style: 'area', entities: ['sensor.solar', 'sensor.grid'], ...config } as Partial<CardConfig>, hass);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('stack maths', () => {
  const pts = (...xs: [number, number | null][]) => xs.map(([t, v]) => ({ t, v }));

  it('reads a series at any time as its last reading, null before it starts and in a gap', () => {
    const p = pts([10, 1], [20, null], [30, 3]);
    expect([5, 10, 15, 20, 25, 30, 99].map((t) => valueAt(p, t))).toEqual([null, 1, 1, null, null, 3, 3]);
  });

  it('aligns series on every reading time', () => {
    const a = align([pts([0, 1], [20, 2]), pts([10, 5])]);
    expect(a.times).toEqual([0, 10, 20]);
    expect(a.values).toEqual([
      [1, 1, 2],
      [null, 5, 5],
    ]);
  });

  it('piles positives up from zero and negatives down, in listed order', () => {
    const layers = stackValues(
      [
        [1, 2, null],
        [3, -1, 4],
        [-2, -3, 1],
      ],
      'normal',
    );
    expect(layers).toEqual([
      [[0, 1], [0, 2], null],
      [
        [1, 4],
        [0, -1],
        [0, 4],
      ],
      [
        [0, -2],
        [-1, -4],
        [4, 5],
      ],
    ]);
    expect(stackExtent(layers)).toEqual([-4, 5]);
    expect(
      totals([
        [1, null],
        [2, null],
      ]),
    ).toEqual([3, null]);
  });

  it('scales each moment to 100 % for a percent stack, leaving an all-zero moment at zero', () => {
    const layers = stackValues(
      [
        [1, 0],
        [3, 0],
      ],
      'percent',
    );
    expect(layers).toEqual([
      [
        [0, 25],
        [0, 0],
      ],
      [
        [25, 100],
        [0, 0],
      ],
    ]);
    expect(stackValues([], 'normal')).toEqual([]);
  });

  it('checks the stack option', () => {
    expect(() => validateStack({ stack: 'sideways' })).toThrow('"stack" must be one of: none, normal, percent');
    expect(() => validateStack({ stack: 'percent' })).not.toThrow();
  });
});

describe('area shapes', () => {
  it('stands an area on zero when its readings reach down near it, never over a set end', () => {
    const raw = { type: 'x' } as CardConfig;
    expect(zeroFloor([0, 3000], raw).y_min).toBe(0);
    expect(zeroFloor([18, 22], raw).y_min).toBeUndefined();
    expect(zeroFloor([-300, -10], raw).y_max).toBe(0);
    expect(zeroFloor([0, 3000], { ...raw, y_min: -5 }).y_min).toBe(-5);
    expect(zeroFloor(undefined, raw)).toBe(raw);
  });

  it('draws steps as corners, and closes a fill back along its base', () => {
    expect(
      stepCorners([
        [0, 0],
        [10, 5],
        [20, 2],
      ]),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [20, 5],
      [20, 2],
    ]);
    const top: [number, number][] = [
      [0, 10],
      [10, 20],
    ];
    const base: [number, number][] = [
      [0, 50],
      [10, 50],
    ];
    expect(areaPath(top, base, 'straight')).toBe('M0,10L10,20L10,50L0,50Z');
    expect(areaPath(top, base, 'step')).toBe('M0,10L10,10L10,20L10,50L10,50L0,50Z');
    expect(areaPath([[0, 1]], [[0, 2]], 'smooth')).toBe('');
    expect(edgePath(top, 'step')).toBe('M0,10L10,10L10,20');
  });
});

describe('area chart', () => {
  it('fills each series down to zero with a gradient, broken at the unavailable stretch', async () => {
    const card = await mount({});
    const fills = qa(card, 'path.fill');
    expect(fills).toHaveLength(2);
    expect(fills[0].getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(fills[0].getAttribute('fill')).toBe('url(#cd-area-0)');
    expect(qa(card, 'linearGradient')).toHaveLength(2);
    expect(qa(card, 'path.line')).toHaveLength(2);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Area chart of Solar, Grid');
    // Readings either side of zero: the axis spans both.
    const values = qa(card, '.y-axis .axis-label').map((e) => Number(e.textContent!.replace(/,/g, '')));
    expect(Math.min(...values)).toBeLessThan(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
  });

  it('colours the part below zero with negative_color, line and fill', async () => {
    const card = await mount({ entities: ['sensor.solar', { entity: 'sensor.grid', negative_color: 'green' }] });
    const grid = q(card, 'g.series[data-series="1"] path.line')!;
    expect(grid.getAttribute('stroke')).toBe('url(#cd-area-line-1)');
    const stops = qa(card, '#cd-area-1 stop').map((s) => s.getAttribute('stop-color'));
    expect(stops.slice(2).every((c) => c!.includes('--success-color'))).toBe(true);
    expect(q(card, '#cd-area-line-0')).toBeNull();
  });

  it('stacks series so the top edge is the total, with the total in the tooltip', async () => {
    const card = await mount({ stack: 'normal', entities: ['sensor.solar', 'sensor.battery'] });
    expect(qa(card, 'path.fill')).toHaveLength(2);
    // Upper layer drawn first, so the lower one's outline sits over it.
    expect(qa(card, 'g.series').map((g) => g.getAttribute('data-series'))).toEqual(['1', '0']);
    expect(Number(qa(card, '.y-axis .axis-label')[0].textContent)).toBe(0);
    const area = q(card, '.plot-area')!;
    // 11 h ago snaps to 12 h ago: solar 500, battery 100.
    pointAt(area, 'pointermove', 1 - 11 / 24);
    await card.updateComplete;
    expect(tooltipRows(card)).toEqual(['Solar 500.0 W', 'Battery 100.0 W', 'Total 600.0 W']);
    expect(qa(card, '.hover-dot')).toHaveLength(2);
  });

  it('stacks to 100 % with each share in the tooltip', async () => {
    const card = await mount({ stack: 'percent', curve: 'step', entities: ['sensor.solar', 'sensor.battery'] });
    const labels = qa(card, '.y-axis .axis-label').map((e) => e.textContent);
    expect(labels[0]).toBe('0');
    expect(labels.at(-1)).toBe('100');
    pointAt(q(card, '.plot-area')!, 'pointermove', 1 - 11 / 24);
    await card.updateComplete;
    expect(tooltipRows(card)).toEqual(['Solar 500.0 W · 83 %', 'Battery 100.0 W · 17 %', 'Total 600.0 W']);
    // In solar's gap it has no value and no dot.
    pointAt(q(card, '.plot-area')!, 'pointermove', 1 - 7 / 24);
    await card.updateComplete;
    expect(tooltipRows(card)[0]).toBe('Solar —');
    expect(qa(card, '.hover-dot')).toHaveLength(1);
  });

  it('draws dots at readings, and copes with unavailable and missing entities', async () => {
    const card = await mount({ dots: true });
    expect(qa(card, 'path.dots').length).toBe(2);
    const hass = chartHass(
      { ...states, 'sensor.off': ['unavailable', { friendly_name: 'Off' }] },
      { 'sensor.off': [{ s: 'unavailable', lu: sec(5 * H) }] },
    );
    const empty = await mountCard(
      { style: 'area', entities: ['sensor.off', 'sensor.nothing'] } as Partial<CardConfig>,
      hass,
    );
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'area', entities: ['sensor.solar'], ...extra } as CardConfig);
    expect(set({ stack: 'up' })).toThrow(/stack/);
    expect(set({ entities: [{ entity: 'sensor.solar', negative_color: 3 }] })).toThrow(/negative_color/);
    expect(set({ curve: 'wiggly' })).toThrow(/curve/);
    expect(set({ stack: 'normal', entities: [{ entity: 'sensor.solar', negative_color: 'red' }] })).not.toThrow();
  });
});

describe('area chart editor', () => {
  it('edits shape, stacking and outline in the Chart section, and a colour below zero per entity', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'area', entities: ['sensor.solar'] } as CardConfig;
    const { form, change, events, entityFields } = await mountEditor(raw, chartHass(states, {}));
    expect(form().data).toMatchObject({ curve: 'smooth', stack: 'none', line_width: 2, dots: false, tooltip: true });
    change({ stack: 'percent', curve: 'straight', line_width: 3 });
    expect(events.at(-1)).toEqual({ ...raw, stack: 'percent', curve: 'straight', line_width: 3 });
    const names = entityFields().fields.map((f) => f.name);
    expect(names).toEqual(['series_color', 'curve', 'line_width', 'dash', 'on_top', 'dots', 'negative_color']);
    expect(JSON.stringify(entityFields().schema)).toContain('negative_color');
  });
});
