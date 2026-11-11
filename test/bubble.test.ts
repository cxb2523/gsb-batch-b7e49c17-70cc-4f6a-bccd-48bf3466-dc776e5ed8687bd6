import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
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
const sec = (msAgo: number) => (now - msAgo) / 1000;
const H = 3_600_000;

const history = {
  'sensor.out': [
    { s: '2', lu: sec(20 * H) },
    { s: '5', lu: sec(14 * H) },
    { s: '9', lu: sec(8 * H) },
    { s: 'unavailable', lu: sec(5 * H) },
    { s: '12', lu: sec(3 * H) },
  ],
  'sensor.heat': [
    { s: '3000', lu: sec(19 * H) },
    { s: '2200', lu: sec(13 * H) },
    { s: '900', lu: sec(7 * H) },
    { s: '400', lu: sec(2 * H) },
  ],
  'sensor.flow': [
    { s: '40', lu: sec(18 * H) },
    { s: '45', lu: sec(6 * H) },
  ],
};

function hassWith(data: Record<string, { s: string; lu: number }[]> = history) {
  const hass = makeHass({
    'sensor.out': ['12', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
    'sensor.heat': ['400', { friendly_name: 'Heating', unit_of_measurement: 'W' }],
    'sensor.flow': ['45', { friendly_name: 'Flow', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => data) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, hass = hassWith()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'bubble',
    entities: ['sensor.out', 'sensor.heat', 'sensor.flow'],
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

function point(el: Element, type: string, fx: number, fy: number, pointerType = 'mouse') {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 200, right: 1000, bottom: 200 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: fx * 1000, clientY: fy * 200 });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bubble chart', () => {
  it('sizes each paired dot by the third entity, largest drawn first, with a size legend', async () => {
    const card = await mount({});
    const bubbles = qa(card, 'path.bubble');
    // Every time any of the three changed once all three had a value, less the unavailable stretch.
    expect(bubbles).toHaveLength(8);
    const widths = bubbles.map((b) => parseFloat((b as SVGElement).style.strokeWidth));
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(Math.max(...widths)).toBe(32);
    expect(Math.min(...widths)).toBe(6);
    expect(bubbles[0].getAttribute('stroke')).toContain('--primary-color');
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Bubble chart of Outside, Heating, Flow');
    const roles = qa(card, '.series-item .role').map((e) => e.textContent!.trim());
    expect(roles).toEqual(['Across', 'Size']);
    const legend = q(card, '.size-legend')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(legend).toBe('Flow 40.0 °C 45.0 °C');
    expect(qa(card, '.size-dot')).toHaveLength(2);
  });

  it('uses the y entity colour and the card sizes, and shows all three readings on hover', async () => {
    const card = await mount({
      min_size: 4,
      max_size: 20,
      x_axis: false,
      y_axis: false,
      entities: ['sensor.out', { entity: 'sensor.heat', color: 'green' }, 'sensor.flow'],
    } as Partial<CardConfig>);
    const bubbles = qa(card, 'path.bubble');
    expect(bubbles[0].getAttribute('stroke')).toContain('--success-color');
    const widths = bubbles.map((b) => parseFloat((b as SVGElement).style.strokeWidth));
    expect(Math.max(...widths)).toBe(20);
    expect(Math.min(...widths)).toBe(4);
    const [x, y] = bubbles[0]
      .getAttribute('d')!
      .match(/M([\d.-]+),([\d.-]+)/)!
      .slice(1)
      .map(Number);
    point(q(card, '.plot-area')!, 'pointermove', x / 1000, y / 200);
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe('Flow 45.0 °C');
  });

  it('asks for three entities, and shows one size when every size reading is the same', async () => {
    const two = await mount({ entities: ['sensor.out', 'sensor.heat'] });
    expect(q(two, '.chart-message')!.textContent).toContain('Add three entities');
    const flat = await mount({}, hassWith({ ...history, 'sensor.flow': [{ s: '40', lu: sec(30 * H) }] }));
    expect(qa(flat, '.size-dot')).toHaveLength(1);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'bubble', entities: ['sensor.out'], ...extra } as CardConfig);
    expect(set({ min_size: 40, max_size: 10 })).toThrow(/min_size/);
    expect(set({ max_size: 0 })).toThrow(/max_size/);
  });
});

describe('bubble chart editor', () => {
  it('writes the bubble sizes and jitter', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'bubble',
      entities: ['sensor.out', 'sensor.heat', 'sensor.flow'],
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({ min_size: 6, max_size: 32, jitter: 0 });
    expect(form.data).not.toHaveProperty('against');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), min_size: 3, max_size: 40, jitter: 2 } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, min_size: 3, max_size: 40, jitter: 2 });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name);
    expect(fields).toEqual(['dot_color']);
  });
});
