import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  LABEL_H,
  averageOf,
  extremePoints,
  extremeTime,
  extremesOn,
  extremesOptions,
  labelWidth,
  placeLabels,
  seriesHasExtremes,
  validateExtremes,
} from '../src/chart/extremes';
import type { Point } from '../src/history/types';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of [
  'ha-form',
  'ha-expansion-panel',
  'ha-selector',
  'ha-entity-picker',
  'ha-icon-picker',
  'ha-icon-button',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

const H = 3_600_000;
const DAY = 24 * H;

describe('extreme points', () => {
  it('finds the lowest and highest readings, skipping gaps and the reading carried in', () => {
    const points: Point[] = [
      { t: 0, v: 1, carried: true },
      { t: 1, v: 5 },
      { t: 2, v: null },
      { t: 3, v: 2 },
      { t: 4, v: 9 },
      { t: 5, v: 9 },
    ];
    const { min, max } = extremePoints(points);
    expect(min).toEqual({ t: 3, v: 2 });
    // A tie goes to the earliest: the value carried on to the edge never wins.
    expect(max).toEqual({ t: 4, v: 9 });
  });

  it('has nothing to mark without readings', () => {
    expect(extremePoints([])).toEqual({ min: undefined, max: undefined });
    expect(extremePoints([{ t: 0, v: null }])).toEqual({ min: undefined, max: undefined });
  });
});

describe('average', () => {
  const points: Point[] = [
    { t: 0, v: 20 },
    { t: 10 * H, v: 30 },
    { t: 11 * H, v: null },
    { t: 12 * H, v: 20 },
    { t: 14 * H, v: 20 },
  ];

  it('weights each history reading by how long it held, leaving out unavailable stretches', () => {
    // 20 for 10 h, 30 for 1 h, unavailable for 1 h, 20 for 2 h.
    expect(averageOf(points, true)).toBeCloseTo((20 * 10 + 30 + 20 * 2) / 13);
  });

  it('stops at now, and counts the reading carried in from before the start', () => {
    expect(averageOf(points, true, 5 * H)).toBe(20);
    expect(
      averageOf(
        [
          { t: 0, v: 10, carried: true },
          { t: H, v: 20 },
          { t: 3 * H, v: 20 },
        ],
        true,
      ),
    ).toBeCloseTo((10 + 40) / 3);
  });

  it('takes a plain mean of groups and statistics, without the row carried in', () => {
    expect(averageOf(points, false)).toBe(22.5);
    expect(
      averageOf(
        [
          { t: 0, v: 100, carried: true },
          { t: 1, v: 4 },
          { t: 2, v: 6 },
        ],
        false,
      ),
    ).toBe(5);
  });

  it('falls back to the mean for a single reading, and to nothing without one', () => {
    expect(averageOf([{ t: 5, v: 7 }], true)).toBe(7);
    expect(averageOf([{ t: 5, v: null }], true)).toBeUndefined();
  });
});

describe('placing labels', () => {
  const W = 400;
  const Hpx = 160;

  it('puts the high above and the low below, centred on the dot', () => {
    const [high, low] = placeLabels(
      [
        { x: 0.5, y: 0.5, text: 'High 1', prefer: 'above', dot: true },
        { x: 0.3, y: 0.7, text: 'Low 1', prefer: 'below', dot: true },
      ],
      W,
      Hpx,
    );
    expect(high).toEqual({ side: 'above', align: 'center', tier: 0 });
    expect(low).toEqual({ side: 'below', align: 'center', tier: 0 });
  });

  it('flips a label that would leave the top or bottom, and holds it inside the sides', () => {
    const [top, bottom] = placeLabels(
      [
        { x: 0.01, y: 0.02, text: 'High 100 °C · 12:00', prefer: 'above' },
        { x: 0.99, y: 0.98, text: 'Low 1 °C · 03:00', prefer: 'below' },
      ],
      W,
      Hpx,
    );
    expect(top).toEqual({ side: 'below', align: 'start', tier: 0 });
    expect(bottom).toEqual({ side: 'above', align: 'end', tier: 0 });
  });

  it('moves a label off one already placed, a dot or an obstacle', () => {
    const near = placeLabels(
      [
        { x: 0.5, y: 0.5, text: 'High 20', prefer: 'above' },
        { x: 0.5, y: 0.52, text: 'High 21', prefer: 'above' },
      ],
      W,
      Hpx,
    );
    expect(near[1].side).toBe('below');
    const dotted = placeLabels(
      [
        { x: 0.5, y: 0.5, text: 'High 20', prefer: 'above', dot: true },
        { x: 0.5, y: 0.4, text: 'x', prefer: 'below', dot: true },
      ],
      W,
      Hpx,
    );
    // Above would cover the other dot at 0.4: below instead.
    expect(dotted[0].side).toBe('below');
    const blocked = placeLabels([{ x: 0.1, y: 0.5, text: 'High 20', prefer: 'above' }], W, Hpx, [
      { l: 0, r: 200, t: 0, b: 75 },
    ]);
    expect(blocked[0].side).toBe('below');
  });

  it('steps a label further out when both near spots are taken, and keeps a side that fits when nothing is clear', () => {
    const crowded = placeLabels(
      [
        { x: 0.5, y: 0.5, text: 'A', prefer: 'above' },
        { x: 0.5, y: 0.5, text: 'B', prefer: 'below' },
        { x: 0.5, y: 0.5, text: 'C', prefer: 'above' },
      ],
      W,
      Hpx,
    );
    expect(crowded[2]).toEqual({ side: 'above', align: 'center', tier: 1 });
    const tiny = placeLabels(
      [
        { x: 0.5, y: 0.5, text: 'A', prefer: 'above' },
        { x: 0.5, y: 0.5, text: 'B', prefer: 'above' },
      ],
      W,
      LABEL_H * 2 + 20,
    );
    expect(tiny[1].tier).toBe(0);
    expect(labelWidth('abc')).toBeGreaterThan(18);
  });
});

describe('extreme times', () => {
  const hass = makeHass({}, { locale: { language: 'en', number_format: 'language', time_format: '24' } });
  const t = Date.UTC(2026, 9, 27, 14, 10);

  it('shows a clock time within a day and the date beyond', () => {
    expect(extremeTime(t, { start: t - H, end: t + H }, hass)).toMatch(/\d{2}:10/);
    const long = extremeTime(t, { start: t - 3 * DAY, end: t }, hass);
    expect(long).toMatch(/Oct/);
    expect(long).toMatch(/:10/);
  });

  it('names a grouped point by its day or month', () => {
    const range = { start: t - 7 * DAY, end: t };
    const day = extremeTime(t, range, hass, { unit: 'day', aggregate: 'mean' });
    expect(day).toMatch(/Oct/);
    expect(day).not.toMatch(/:/);
    expect(extremeTime(t, range, hass, { unit: 'month', aggregate: 'mean' })).toMatch(/Oct 2026/);
    expect(extremeTime(t, range, hass, { unit: 'hour', aggregate: 'mean' })).toMatch(/:10/);
  });
});

describe('extremes options', () => {
  const cfg = (extra: Record<string, unknown>) => ({ type: 'x', entities: ['sensor.a'], ...extra }) as CardConfig;

  it('fills in defaults and says when any mark is on', () => {
    expect(extremesOptions(cfg({}))).toEqual({ min: false, max: false, average: 'none' });
    expect(extremesOn(extremesOptions(cfg({})))).toBe(false);
    expect(extremesOn(extremesOptions(cfg({ extremes: { average: 'figure' } })))).toBe(true);
    expect(seriesHasExtremes({ entity: 'a' })).toBe(true);
    expect(seriesHasExtremes({ entity: 'a', extremes: false })).toBe(false);
  });

  it('rejects bad values with readable errors', () => {
    expect(() => validateExtremes(cfg({ extremes: true }))).toThrow(/"extremes" must have/);
    expect(() => validateExtremes(cfg({ extremes: { min: 'yes' } }))).toThrow(/"extremes.min" must be true or false/);
    expect(() => validateExtremes(cfg({ extremes: { average: 'median' } }))).toThrow(
      /"extremes.average" must be one of: none, line, figure/,
    );
    expect(() => validateExtremes(cfg({ entities: [{ entity: 'sensor.a', extremes: 'no' }] }))).toThrow(
      /"extremes" of sensor.a/,
    );
    expect(() => validateExtremes(cfg({ extremes: { min: true, max: false, average: 'line' } }))).not.toThrow();
  });
});

/* ------------------------------------------------------------------ card ------------------------------------------------------------------ */

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

// The fixture is relative to the moment the file loads and the average is weighted by time up to the moment it renders, so seconds
// passing between the two move it. Pin the clock; only Date is faked, timers stay real.
const now = new Date(2026, 10, 7, 15, 0, 0).getTime();
const sec = (msAgo: number) => (now - msAgo) / 1000;
const history = {
  'sensor.in': [
    { s: '19', lu: sec(20 * H) },
    { s: '20', lu: sec(10 * H) },
    { s: 'unavailable', lu: sec(8 * H) },
    { s: '21', lu: sec(2 * H) },
  ],
  'sensor.out': [
    { s: '5', lu: sec(20 * H) },
    { s: '9', lu: sec(4 * H) },
  ],
};

function hassWith() {
  const hass = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    ...config,
  } as CardConfig);
  card.hass = hassWith();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const texts = (card: Card, sel: string) => qa(card, sel).map((e) => e.textContent!.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('line chart with extremes', () => {
  it('draws nothing extra by default', async () => {
    const card = await mount({});
    expect(qa(card, '.extremes-layer')).toHaveLength(0);
    expect(qa(card, '.average-line')).toHaveLength(0);
  });

  it('marks each series high and low with its value and time, and draws a labelled average line', async () => {
    const card = await mount({ extremes: { min: true, max: true, average: 'line' } } as Partial<CardConfig>);
    expect(qa(card, '.extreme-dot')).toHaveLength(4);
    const labels = texts(card, '.extreme-label');
    expect(labels.filter((l) => l.startsWith('High'))).toHaveLength(2);
    expect(labels.some((l) => /^High 21\.0 °C · .+/.test(l))).toBe(true);
    expect(labels.some((l) => /^Low 19\.0 °C · .+/.test(l))).toBe(true);
    expect(labels.some((l) => /^Low 5\.0 °C/.test(l))).toBe(true);
    // Inside: 19 for 10 h, 20 for 2 h, unavailable for 6 h, 21 for 2 h.
    expect(labels).toContain('Avg 19.4 °C');
    const lines = qa(card, '.average-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('stroke')).toContain('--primary-color');
    const dot = qa(card, '.extreme-dot')[0] as HTMLElement;
    expect(dot.getAttribute('style')).toMatch(/left:[\d.]+%;top:[\d.]+%/);
  });

  it('shows only the marks asked for, and skips a series switched off', async () => {
    const card = await mount({
      extremes: { max: true, average: 'figure' },
      entities: ['sensor.in', { entity: 'sensor.out', extremes: false }],
    } as Partial<CardConfig>);
    expect(texts(card, '.extreme-label')).toEqual([expect.stringMatching(/^High 21\.0 °C/)]);
    expect(qa(card, '.average-line')).toHaveLength(0);
    expect(texts(card, '.extreme-figure')).toEqual(['Avg 19.4 °C']);
    // More than one series on the card: each figure gets its colour swatch.
    expect(qa(card, '.extreme-figure .swatch')).toHaveLength(1);
  });

  it('averages grouped readings plainly and names their day', async () => {
    const card = await mount({
      entities: ['sensor.out'],
      group_by: 'hour',
      aggregate: 'max',
      extremes: { min: true, average: 'line' },
    } as Partial<CardConfig>);
    const labels = texts(card, '.extreme-label');
    expect(labels.some((l) => /^Low 5\.0 °C · /.test(l))).toBe(true);
    expect(labels.some((l) => l.startsWith('Avg '))).toBe(true);
  });

  it('keeps labels clear of a header laid over the plot', async () => {
    const card = await mount({ header: 'over', extremes: { max: true } } as Partial<CardConfig>);
    expect(qa(card, '.extreme-label')).toHaveLength(2);
  });

  it('rejects a bad extremes option', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({
        type: 'x',
        style: 'line',
        entities: ['sensor.in'],
        extremes: { average: 'mode' },
      } as CardConfig),
    ).toThrow(/extremes.average/);
  });
});

describe('extremes editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'], ...config } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events, raw };
  }

  it('sets the high, low and average marks in the Chart section', async () => {
    const { ed, events, raw } = await editor({});
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const names = JSON.stringify(form.schema);
    for (const n of ['extremes_max', 'extremes_min', 'extremes_average']) expect(names).toContain(n);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), extremes_max: true, extremes_average: 'line' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, extremes: { max: true, average: 'line' } });
  });

  it('removes the marks when they go back to off', async () => {
    const { ed, events, raw } = await editor({ extremes: { max: true } } as Partial<CardConfig>);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect((form.data as Record<string, unknown>).extremes_max).toBe(true);
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), extremes_max: false } } }),
    );
    const { extremes, ...rest } = raw as CardConfig & { extremes?: unknown };
    expect(extremes).toEqual({ max: true });
    expect(events.at(-1)).toEqual(rest);
  });

  it('offers each series its own switch only while the card marks something', async () => {
    const fieldNames = (ed: HTMLElement) =>
      (
        (ed.shadowRoot!.querySelector('cd-entities-editor') as Stub).chartFields as { fields: { name: string }[] }
      ).fields.map((f) => f.name);
    const off = await editor({});
    expect(fieldNames(off.ed)).not.toContain('extremes');
    const on = await editor({ extremes: { min: true } } as Partial<CardConfig>);
    expect(fieldNames(on.ed)).toEqual([
      'series_color',
      'curve',
      'line_width',
      'dash',
      'on_top',
      'dots',
      'extremes',
      'forecast_entity',
      'forecast_attribute',
      'forecast_value_key',
      'forecast_time_key',
      'forecast_type',
      'forecast_multiply',
    ]);
    const schema = (
      (on.ed.shadowRoot!.querySelector('cd-entities-editor') as Stub).chartFields as { schema: unknown[] }
    ).schema;
    expect(JSON.stringify(schema)).toContain('"name":"extremes"');
  });
});
