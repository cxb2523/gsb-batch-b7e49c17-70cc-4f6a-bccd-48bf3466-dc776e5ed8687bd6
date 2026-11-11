import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { shapePath, violinOptions } from '../src/styles/violin';
import { categoryGeometry } from '../src/chart/category-plot';
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
  'ha-switch',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const H = 3_600_000;

/** A reading every 20 minutes for two days: bedroom around 19, nursery around 21. */
function rows(base: number) {
  const out: { s: string; lu: number }[] = [];
  for (let i = 0; i < 144; i++) {
    const t = now - 48 * H + i * 20 * 60_000;
    out.push({ s: String(base + Math.round(Math.sin(i / 5) * 15) / 10), lu: t / 1000 });
  }
  return out;
}

function hassWith(history: Record<string, unknown>) {
  const hass = makeHass({
    'sensor.bedroom': ['19', { friendly_name: 'Bedroom', unit_of_measurement: '°C' }],
    'sensor.nursery': ['21', { friendly_name: 'Nursery', unit_of_measurement: '°C' }],
    'sensor.gone': ['unavailable', { friendly_name: 'Gone' }],
  });
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

const history = {
  'sensor.bedroom': rows(19),
  'sensor.nursery': rows(21),
  'sensor.gone': [{ s: 'unavailable', lu: (now - 40 * H) / 1000 }],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'violin',
    period: { last: 2, unit: 'day' },
    entities: ['sensor.bedroom', 'sensor.nursery', 'sensor.gone'],
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('violin options and shapes', () => {
  it('defaults to a violin with a box, readings on for a raincloud', () => {
    expect(violinOptions({} as CardConfig)).toEqual({
      shape: 'violin',
      box: true,
      readings: false,
      bandwidth: undefined,
      split: 'none',
    });
    expect(violinOptions({ shape: 'raincloud' } as CardConfig).readings).toBe(true);
    expect(violinOptions({ shape: 'raincloud', readings: false, bandwidth: 0.5 } as CardConfig)).toMatchObject({
      readings: false,
      bandwidth: 0.5,
    });
  });

  it('outlines a whole violin, or a half for a raincloud', () => {
    const host = document.createElement('div');
    const g = categoryGeometry({ host, requestUpdate: () => undefined, raw: {} as CardConfig }, 1, { domain: [0, 10] });
    const curve = [
      { x: 0, d: 0 },
      { x: 5, d: 1 },
      { x: 10, d: 0 },
    ];
    expect(shapePath(curve, g, 0, false, 0, 0.4)).toBe('M0,50L500,10L1000,50L1000,50L500,90L0,50Z');
    expect(shapePath(curve, g, 0, true, 0, 0.4)).toBe('M0,50L500,10L1000,50L1000,50L500,50L0,50Z');
    expect(shapePath([], g, 0, false)).toBe('');
  });
});

describe('violin chart', () => {
  it('draws a violin and box per entity, named with its median, the unavailable one empty', async () => {
    const card = await mount({});
    expect(qa(card, 'path.shape')).toHaveLength(2);
    expect(qa(card, '.box rect.iqr')).toHaveLength(2);
    expect(q(card, 'path.dots')).toBeNull();
    const labels = qa(card, '.cat-label').map(text);
    expect(labels[0]).toMatch(/^Bedroom median 1\d\.\d °C$/);
    expect(labels[2]).toBe('Gone No readings');
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Violin chart of Bedroom, Nursery, Gone');
    expect(qa(card, '.cat-axis .axis-label').length).toBeGreaterThan(1);
    expect(qa(card, '.grid line').length).toBeGreaterThan(1);
  });

  it('scatters the readings, or makes a raincloud of half violins, boxes and readings', async () => {
    const withDots = await mount({ readings: true, box: false } as Partial<CardConfig>);
    expect(qa(withDots, 'path.dots')).toHaveLength(2);
    expect(q(withDots, '.box')).toBeNull();
    const rain = await mount({ shape: 'raincloud' } as Partial<CardConfig>);
    expect(qa(rain, 'path.dots')).toHaveLength(2);
    expect(qa(rain, '.box')).toHaveLength(2);
    expect(q(rain, 'svg.plot')!.getAttribute('aria-label')).toBe('Raincloud chart of Bedroom, Nursery, Gone');
  });

  it('stands up, without value labels or lines when asked', async () => {
    const card = await mount({ orientation: 'vertical', value_axis: false, value_grid: false } as Partial<CardConfig>);
    expect(q(card, '.cat-plot.vertical')).not.toBeNull();
    expect(q(card, '.cat-axis')).toBeNull();
    expect(q(card, '.grid')).toBeNull();
    expect(q(card, 'svg.plot')!.getAttribute('viewBox')).toBe('0 0 300 1000');
    const labelled = await mount({ orientation: 'vertical', value_min: 0, value_max: 40 } as Partial<CardConfig>);
    const ticks = qa(labelled, '.cat-axis .axis-label').map(text);
    expect(ticks[0]).toBe('0');
    expect(ticks.at(-1)).toBe('40');
    expect(q(labelled, '.cat-sizer')!.textContent).toHaveLength(2);
  });

  it('draws one shape per entity and day', async () => {
    const card = await mount({ split_by: 'day', entities: ['sensor.bedroom'] } as Partial<CardConfig>);
    // Two days back from now touches three calendar days.
    expect(qa(card, 'path.shape')).toHaveLength(3);
    const two = await mount({ split_by: 'day', entities: ['sensor.bedroom', 'sensor.nursery'] } as Partial<CardConfig>);
    expect(qa(two, '.cat-name').map(text)[1]).toMatch(/· Nursery$/);
  });

  it('works from grouped readings and a fixed bandwidth', async () => {
    const card = await mount({ group_by: 'hour', bandwidth: 0.5 } as Partial<CardConfig>);
    expect(qa(card, 'path.shape')).toHaveLength(2);
  });

  it('shows the median, middle half, range and count for the band under the pointer', async () => {
    const card = await mount({});
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 192, right: 300, bottom: 192 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 10 }));
    await card.updateComplete;
    expect(text(q(card, '.band-tooltip .tooltip-time')!)).toBe('Bedroom');
    const rows = qa(card, '.band-tooltip .tooltip-row').map(text);
    expect(rows.map((r) => r.split(' ')[0])).toEqual(['Median', 'Middle', 'Lowest', 'Readings']);
    expect(rows[3]).toMatch(/Readings 14\d/);
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 180 }));
    await card.updateComplete;
    // Over the unavailable entity: nothing to show.
    expect(q(card, '.band-tooltip')).toBeNull();
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 100 }));
    await card.updateComplete;
    expect(q(card, '.band-tooltip')!.getAttribute('style')).toBe('top:66.67%;right:0');
    area.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.band-tooltip')).toBeNull();
  });

  it('puts the box above a band in the bottom half', async () => {
    const card = await mount({ entities: ['sensor.gone', 'sensor.bedroom'] } as Partial<CardConfig>);
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 128, right: 300, bottom: 128 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 100 }));
    await card.updateComplete;
    expect(q(card, '.band-tooltip')!.getAttribute('style')).toMatch(/^top:auto;bottom:50%/);
  });

  it('opens an entity from its name', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const label = qa(card, '.cat-label')[1];
    label.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    label.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.nursery']);
  });

  it('says when there is nothing to draw', async () => {
    const card = await mount({}, hassWith({}));
    expect(q(card, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'violin', entities: ['sensor.bedroom'], ...extra } as CardConfig);
    expect(set({ shape: 'cello' })).toThrow(/"shape" must be one of: violin, raincloud/);
    expect(set({ split_by: 'year' })).toThrow(/split_by/);
    expect(set({ box: 'yes' })).toThrow(/box/);
    expect(set({ readings: 1 })).toThrow(/readings/);
    expect(set({ bandwidth: 0 })).toThrow(/"bandwidth" must be a number above 0/);
    expect(set({ compact: 'yes' })).toThrow(/compact/);
    expect(set({ orientation: 'diagonal' })).toThrow(/orientation/);
    expect(set({ shape: 'raincloud', split_by: 'week', bandwidth: 0.2, orientation: 'vertical' })).not.toThrow();
  });
});

describe('violin editor', () => {
  it('writes the shape, direction, box, readings, split, smoothing and value axis', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'violin', entities: ['sensor.bedroom'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({
      shape: 'violin',
      orientation: 'horizontal',
      box: true,
      readings: false,
      split_by: 'none',
      value_axis: true,
      value_grid: true,
      tooltip: true,
      compact: false,
    });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...(form.data as object),
            shape: 'raincloud',
            orientation: 'vertical',
            split_by: 'day',
            bandwidth: 0.3,
            value_min: 10,
            value_grid: false,
          },
        },
      }),
    );
    const next = events.at(-1)!;
    expect(next).toEqual({
      ...raw,
      shape: 'raincloud',
      orientation: 'vertical',
      split_by: 'day',
      bandwidth: 0.3,
      value_min: 10,
      value_grid: false,
    });
    // A raincloud shows its readings unless told not to.
    ed.setConfig(next);
    await ed.updateComplete;
    const rain = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect((rain.data as { readings: boolean }).readings).toBe(true);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect((list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual(['fill_color']);
  });
});
