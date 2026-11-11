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
    style: 'scatter',
    entities: ['sensor.out', 'sensor.heat'],
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
const dotCount = (el: Element) => (el.getAttribute('d')!.match(/M/g) ?? []).length;

function point(el: Element, type: string, fx: number, fy: number, pointerType = 'mouse') {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 200, right: 1000, bottom: 200 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: fx * 1000, clientY: fy * 200 });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scatter chart', () => {
  it('plots the second entity against the first, one dot per time either changed', async () => {
    const card = await mount({});
    const dots = qa(card, 'path.dots');
    expect(dots).toHaveLength(1);
    // Paired at each change of either, leaving out the unavailable stretch and the carried edge.
    expect(dotCount(dots[0])).toBe(7);
    expect(dots[0].getAttribute('stroke')).toContain('--primary-color');
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Scatter chart of Outside, Heating');
    const header = qa(card, '.series-item').map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
    expect(header).toEqual(['Across Outside 12.0 °C', 'Heating 400.0 W']);
    expect(q(card, '.series-item .role')).not.toBeNull();
    // Bottom labels are values: numbers, not times.
    const bottom = qa(card, '.x-axis .axis-label').map((e) => e.textContent!.trim());
    expect(bottom.length).toBeGreaterThanOrEqual(2);
    expect(bottom.every((v) => /^-?\d+$/.test(v))).toBe(true);
  });

  it('draws each further entity as its own coloured series, with jitter that stays put', async () => {
    const card = await mount({
      entities: ['sensor.out', 'sensor.heat', { entity: 'sensor.flow', color: 'red' }],
      jitter: 6,
      dot_size: 9,
    } as Partial<CardConfig>);
    const dots = qa(card, 'path.dots');
    expect(dots).toHaveLength(2);
    expect(dots[1].getAttribute('stroke')).toContain('--error-color');
    expect((dots[0] as SVGElement).style.strokeWidth).toBe('9px');
    const before = dots.map((d) => d.getAttribute('d'));
    card.hass = { ...card.hass! };
    await card.updateComplete;
    expect(qa(card, 'path.dots').map((d) => d.getAttribute('d'))).toEqual(before);
    const plain = await mount({ entities: ['sensor.out', 'sensor.heat', 'sensor.flow'] } as Partial<CardConfig>);
    expect(qa(plain, 'path.dots')[0].getAttribute('d')).not.toBe(before[0]);
  });

  it('plots values against time as dots, with time labels', async () => {
    const card = await mount({ against: 'time', entities: ['sensor.out'] } as Partial<CardConfig>);
    const dots = qa(card, 'path.dots');
    expect(dots).toHaveLength(1);
    // The readings in range, not the gap and not the value carried to the right edge.
    expect(dotCount(dots[0])).toBe(4);
    expect(q(card, '.role')).toBeNull();
    expect(q(card, '.swatch')).not.toBeNull();
  });

  it('asks for a second entity, and copes with one that is missing or has no history', async () => {
    const one = await mount({ entities: ['sensor.out'] });
    expect(q(one, '.chart-message')!.textContent).toContain('Add a second entity');
    const missing = await mount({ entities: ['sensor.out', 'sensor.gone'] });
    expect(q(missing, '.chart-message')!.textContent).toBe('No readings in this period.');
    const empty = await mount({}, hassWith({}));
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('shows both readings and the time of the dot under the pointer', async () => {
    const card = await mount({ x_axis: false, y_axis: false } as Partial<CardConfig>);
    const area = q(card, '.plot-area')!;
    expect(area.classList.contains('hoverable')).toBe(true);
    // Highest outside temperature (right edge) has the lowest heating (bottom).
    const d = q(card, 'path.dots')!.getAttribute('d')!;
    const pts = [...d.matchAll(/M([\d.-]+),([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const [x, y] = pts.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
    point(area, 'pointermove', x / 1000, y / 200);
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Outside 12.0 °C', 'Heating 400.0 W']);
    expect(q(card, '.hover-dot')).not.toBeNull();
    point(area, 'pointerleave', 0, 0);
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
    const off = await mount({ tooltip: false } as Partial<CardConfig>);
    expect(q(off, '.plot-area')!.classList.contains('hoverable')).toBe(false);
  });

  it('keeps a fixed bottom range and the header over the chart', async () => {
    const card = await mount({ x_min: 0, x_max: 20, header: 'over', compact: true } as Partial<CardConfig>);
    const bottom = qa(card, '.x-axis .axis-label').map((e) => e.textContent!.trim());
    expect(bottom[0]).toBe('0');
    expect(bottom.at(-1)).toBe('20');
    expect(q(card, '.header-over')).not.toBeNull();
    expect(q(card, '.frame.compact')).not.toBeNull();
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'scatter', entities: ['sensor.out'], ...extra } as CardConfig);
    expect(set({ against: 'moon' })).toThrow(/against/);
    expect(set({ jitter: 99 })).toThrow(/jitter/);
  });
});

describe('scatter chart editor', () => {
  it('writes what goes along the bottom, dot size and jitter, and a colour per entity', async () => {
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
      style: 'scatter',
      entities: ['sensor.out', 'sensor.heat'],
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({ against: 'entity', dot_size: 6, jitter: 0, xy_x_axis: true, tooltip: true });
    const names = JSON.stringify(form.schema);
    expect(names).toContain('"x_min"');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), jitter: 4, dot_size: 8, x_min: -5, xy_x_axis: false } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, jitter: 4, dot_size: 8, x_min: -5, x_axis: false });
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), against: 'time' } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, against: 'time' });
    ed.setConfig({ ...raw, against: 'time' } as CardConfig);
    await ed.updateComplete;
    const timeForm = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(JSON.stringify(timeForm.schema)).not.toContain('"x_min"');
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name);
    expect(fields).toEqual(['dot_color']);
  });
});
