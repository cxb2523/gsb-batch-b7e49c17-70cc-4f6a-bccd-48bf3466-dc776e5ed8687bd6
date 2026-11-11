import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { STYLES } from '../src/styles';
import { stripOffsets, stripOptions } from '../src/styles/strip-plot';
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

describe('strip plot helpers', () => {
  it('reads its options', () => {
    expect(stripOptions({} as CardConfig)).toEqual({ jitter: 0.7, dot: 5, marker: 'median' });
    expect(stripOptions({ jitter: 0, dot_size: 8, marker: 'mean' } as CardConfig)).toEqual({
      jitter: 0,
      dot: 8,
      marker: 'mean',
    });
  });

  it('jitters each dot by its own time, inside the row, the same every time', () => {
    const times = Array.from({ length: 200 }, (_, i) => 1_700_000_000_000 + i * 60_000);
    const a = stripOffsets(times, 0, 0.7, 6, 60);
    expect(a).toEqual(stripOffsets(times, 0, 0.7, 6, 60));
    const room = 0.7 - 6 / 60;
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(room / 2 + 1e-9);
    expect(Math.max(...a)).toBeGreaterThan(room / 4);
    expect(Math.min(...a)).toBeLessThan(-room / 4);
    // A new reading doesn't move the old ones.
    expect(stripOffsets(times.slice(1), 0, 0.7, 6, 60)).toEqual(a.slice(1));
    // Other rows scatter differently; no spread puts every dot on the line.
    expect(stripOffsets(times, 1, 0.7, 6, 60)).not.toEqual(a);
    expect(stripOffsets(times, 0, 0, 6, 60).every((f) => f === 0)).toBe(true);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const H = 3_600_000;

function hassWith(history: Record<string, unknown>) {
  const hass = makeHass({
    'sensor.hall': ['20', { friendly_name: 'Hall', unit_of_measurement: '°C' }],
    'sensor.gone': ['unavailable', { friendly_name: 'Gone' }],
  });
  hass.config = { time_zone: 'UTC' } as HomeAssistant['config'];
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

// 18, 18.5 … 21.5 five times over: median and mean 19.75 (19.8 at one decimal).
const hall = Array.from({ length: 40 }, (_, i) => ({
  s: String(18 + (i % 8) / 2),
  lu: (now - 20 * H + i * 20 * 60_000) / 1000,
}));
const history = { 'sensor.hall': hall, 'sensor.gone': [{ s: 'unavailable', lu: (now - 20 * H) / 1000 }] };

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'strip_plot',
    entities: ['sensor.hall', 'sensor.gone'],
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
const dotCount = (el: Element) =>
  [...el.querySelectorAll('path.dots')].reduce((a, p) => a + p.getAttribute('d')!.split('M').length - 1, 0);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('strip plot chart', () => {
  it('shows a sensor that held one value all day as that value, not as no readings', async () => {
    // History of a sensor that hasn't changed for over a day: only the state it started the span with.
    const flat = { 'sensor.hall': [{ s: '21.4', lu: (now - 30 * H) / 1000 }], 'sensor.gone': [] };
    const card = await mount({ period: { last: 24, unit: 'hour' } } as Partial<CardConfig>, hassWith(flat));
    expect(qa(card, '.cat-label').map(text)).toEqual(['Hall No change: 21.4 °C', 'Gone No readings']);
    const strips = qa(card, 'g.strip');
    expect(strips).toHaveLength(1);
    // One dot, with no marker line over it (the value is its own median).
    expect(dotCount(strips[0])).toBe(1);
    expect(strips[0].querySelectorAll('.strip-marker')).toHaveLength(0);
    // The axis runs around the value, not 0 to 1.
    const ticks = qa(card, '.axis-label').map((e) => Number(text(e)));
    expect(Math.min(...ticks)).toBeLessThanOrEqual(21.4);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(21.4);
    expect(Math.min(...ticks)).toBeGreaterThan(15);
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 112, right: 300, bottom: 112 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
    await card.updateComplete;
    expect(qa(card, '.band-tooltip .tooltip-row').map(text)).toEqual(['Held all period 21.4 °C']);
  });

  it('draws a dot per reading in each entity row, with a line at the median', async () => {
    const card = await mount({});
    const strips = qa(card, 'g.strip');
    expect(strips).toHaveLength(1);
    expect(strips[0].getAttribute('data-index')).toBe('0');
    expect(dotCount(strips[0])).toBe(40);
    expect(strips[0].querySelectorAll('.strip-marker.median')).toHaveLength(1);
    expect(qa(card, '.cat-label').map(text)).toEqual(['Hall Median 19.8 °C', 'Gone No readings']);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Strip plot chart of Hall, Gone');
  });

  it('draws the same dots on every redraw', async () => {
    const a = await mount({});
    const b = await mount({});
    expect(q(a, 'path.dots')!.getAttribute('d')).toBe(q(b, 'path.dots')!.getAttribute('d'));
  });

  it('marks the mean, or nothing, and stands up', async () => {
    const mean = await mount({ marker: 'mean' } as Partial<CardConfig>);
    expect(q(mean, '.strip-marker.mean')).not.toBeNull();
    expect(text(q(mean, '.cat-label')!)).toBe('Hall Average 19.8 °C');
    const none = await mount({ marker: 'none', orientation: 'vertical' } as Partial<CardConfig>);
    expect(q(none, '.strip-marker')).toBeNull();
    expect(text(q(none, '.cat-label')!)).toBe('Hall 40 readings');
    expect(q(none, '.cat-plot.vertical')).not.toBeNull();
  });

  it('shows count, median, mean, middle half and range for the row under the pointer', async () => {
    const card = await mount({});
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 112, right: 300, bottom: 112 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
    await card.updateComplete;
    const rows = qa(card, '.band-tooltip .tooltip-row').map(text);
    expect(rows).toEqual([
      'Readings 40',
      'Median 19.8 °C',
      'Average 19.8 °C',
      'Middle half 18.8 °C – 20.8 °C',
      'Lowest – highest 18.0 °C – 21.5 °C',
    ]);
  });

  it('samples a long history evenly and says so', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      s: String(i % 50),
      lu: (now - 20 * H + i * 20_000) / 1000,
    }));
    const card = await mount({ entities: ['sensor.hall'] }, hassWith({ 'sensor.hall': many }));
    expect(dotCount(q(card, 'g.strip')!)).toBe(2000);
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 56, right: 300, bottom: 56 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
    await card.updateComplete;
    expect(qa(card, '.band-tooltip .tooltip-row').map(text).slice(0, 2)).toEqual([
      'Readings 2,500',
      'Dots shown 2,000',
    ]);
  });

  it('opens an entity from its strip', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const el = q(card, 'g.strip')!;
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.hall']);
  });

  it('says when there is nothing to draw', async () => {
    const card = await mount({}, hassWith({}));
    expect(q(card, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'strip_plot', entities: ['sensor.hall'], ...extra } as CardConfig);
    expect(set({ marker: 'mode' })).toThrow(/"marker" must be one of: median, mean, none/);
    expect(set({ jitter: 150 })).toThrow(/"jitter" must be a number from 0 to 100/);
    expect(set({ dot_size: 1 })).toThrow(/"dot_size" must be a number from 2 to 16/);
    expect(set({ value_min: 5, value_max: 1 })).toThrow(/value_min/);
    expect(set({ marker: 'mean', jitter: 0, dot_size: 3 })).not.toThrow();
  });

  it('has a thumbnail', () => {
    const style = STYLES.strip_plot;
    expect(style.layout).toBe('chart');
    if (style.layout === 'chart') expect(style.thumbnail().strings.join('')).toContain('<path');
  });
});

describe('strip plot editor', () => {
  it('writes the marker, spread and dot size', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'strip_plot', entities: ['sensor.hall'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({
      strip_marker: 'median',
      strip_jitter: 70,
      dot_size: 5,
      orientation: 'horizontal',
    });
    expect((form.computeLabel as (s: { name: string }) => string)({ name: 'strip_jitter' })).toBe(
      'Spread across the row',
    );
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), strip_marker: 'mean', strip_jitter: 40, dot_size: 3 } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, marker: 'mean', jitter: 40, dot_size: 3 });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect((list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual(['fill_color']);
  });
});
