import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  DEFAULT_LINE_WIDTH,
  dotSize,
  dotsPath,
  drawOrder,
  seriesStyle,
  validateSeriesStyle,
} from '../src/chart/series-style';
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

const card = (extra: Record<string, unknown> = {}) => ({ type: 'x', entities: [], ...extra }) as CardConfig;

describe('series style maths', () => {
  it('takes the entity setting, else the card, else the default', () => {
    expect(seriesStyle({}, card())).toEqual({ width: DEFAULT_LINE_WIDTH, dots: false, onTop: false });
    expect(seriesStyle({}, card({ line_width: 4, dots: true }))).toEqual({ width: 4, dots: true, onTop: false });
    expect(seriesStyle({ line_width: 1, dots: false, on_top: true }, card({ line_width: 4, dots: true }))).toEqual({
      width: 1,
      dots: false,
      onTop: true,
    });
  });

  it('draws marked series last, keeping list order otherwise', () => {
    const s = ['a', 'b', 'c', 'd'];
    expect(drawOrder(s, (x) => x === 'b' || x === 'a')).toEqual(['c', 'd', 'a', 'b']);
    expect(drawOrder(s, () => false)).toEqual(s);
  });

  it('makes round dots from zero-length segments, a bit wider than the line', () => {
    expect(
      dotsPath([
        [1, 2],
        [3.456, 4],
      ]),
    ).toBe('M1,2h0M3.46,4h0');
    expect(dotSize(2.5)).toBe(6);
  });

  it('explains bad settings', () => {
    expect(() => validateSeriesStyle(card({ line_width: 0 }))).toThrow('"line_width" must be a number from 0.5 to 12');
    expect(() => validateSeriesStyle(card({ dots: 'yes' }))).toThrow('"dots" must be true or false');
    const bad = (e: Record<string, unknown>) => () =>
      validateSeriesStyle(card({ entities: ['sensor.a', { entity: 'sensor.b', ...e }] }));
    expect(bad({ line_width: 'thick' })).toThrow('"line_width" of sensor.b must be a number');
    expect(bad({ dots: 1 })).toThrow('"dots" of sensor.b');
    expect(bad({ on_top: 'yes' })).toThrow('"on_top" of sensor.b must be true or false');
    expect(bad({ line_width: 3, dots: true, on_top: true })).not.toThrow();
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass() {
  const h = makeHass({ 'sensor.in': '21', 'sensor.out': '9' });
  h.callWS = vi.fn(async () => ({
    'sensor.in': [
      { s: '19', lu: sec(20 * H) },
      { s: '20', lu: sec(10 * H) },
      { s: '21', lu: sec(2 * H) },
    ],
    'sensor.out': [
      { s: '5', lu: sec(20 * H) },
      { s: '9', lu: sec(4 * H) },
    ],
  })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>) {
  const el = document.createElement('chartdeck-card') as Card;
  el.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    ...extra,
  } as CardConfig);
  el.hass = hass();
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}
const qa = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('series style on the line chart', () => {
  it('draws the marked series on top, at its own width, with dots where asked', async () => {
    const el = await mount({
      dots: true,
      line_width: 4,
      entities: [
        { entity: 'sensor.in', on_top: true, line_width: 1.5 },
        { entity: 'sensor.out', dots: false },
      ],
    });
    const groups = qa(el, 'g.series').map((g) => g.getAttribute('data-series'));
    expect(groups).toEqual(['1', '0']);
    const [out, inside] = qa(el, 'path.line') as SVGElement[];
    expect(inside.getAttribute('style')).toBe('stroke-width:1.5px');
    expect(out.getAttribute('style')).toBe('stroke-width:4px');
    const dots = qa(el, 'path.dots');
    expect(dots).toHaveLength(1);
    // Three readings; the carried value at the right edge gets no dot.
    expect(dots[0].getAttribute('d')!.match(/h0/g)).toHaveLength(3);
    expect(dots[0].getAttribute('style')).toBe('stroke-width:5px');
    // The header keeps the listed order.
    expect(qa(el, '.series-item').map((e) => e.getAttribute('data-index'))).toEqual(['0', '1']);
  });

  it('has no dots by default, and none on a crowded series', async () => {
    expect(qa(await mount({}), 'path.dots')).toHaveLength(0);
    const el = document.createElement('chartdeck-card') as Card;
    el.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], dots: true } as CardConfig);
    const h = hass();
    h.callWS = vi.fn(async () => ({
      'sensor.in': Array.from({ length: 300 }, (_, i) => ({ s: String(i % 7), lu: sec((300 - i) * 60_000) })),
    })) as HomeAssistant['callWS'];
    el.hass = h;
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(qa(el, 'path.line')).toHaveLength(1);
    expect(qa(el, 'path.dots')).toHaveLength(0);
  });

  it('rejects a bad width', () => {
    const el = document.createElement('chartdeck-card') as Card;
    expect(() =>
      el.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], line_width: 40 } as CardConfig),
    ).toThrow(/line_width/);
  });
});

describe('series style in the editor', () => {
  type Ed = HTMLElement & { setConfig(c: CardConfig): void; hass?: unknown; updateComplete: Promise<boolean> };

  async function editor(raw: CardConfig) {
    const ed = document.createElement('chartdeck-card-editor') as Ed;
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }

  it('sets the card width and dots in the Chart section', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig;
    const { ed, events } = await editor(raw);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({ line_width: 2.5, dots: false });
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), line_width: 4, dots: true } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, line_width: 4, dots: true });
  });

  it("sets each series' width, dots and order, the dots switch following the card", async () => {
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'line',
      dots: true,
      entities: [{ entity: 'sensor.in' }],
    } as CardConfig;
    const { ed, events } = await editor(raw);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub & { updateComplete: Promise<boolean> };
    const dots = (list.chartFields as { fields: { name: string; default?: unknown }[] }).fields.find(
      (f) => f.name === 'dots',
    );
    expect(dots?.default).toBe(true);
    (list.shadowRoot!.querySelector('.expand') as HTMLElement).click();
    await list.updateComplete;
    const form = list.shadowRoot!.querySelector('ha-form[data-section="entity-chart"]') as Stub;
    expect(form.data).toEqual({ dash: false, on_top: false, dots: true });
    const names = JSON.stringify(form.schema);
    for (const n of ['line_width', 'dots', 'on_top']) expect(names).toContain(`"${n}"`);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), line_width: 1, dots: false, on_top: true } },
      }),
    );
    expect(events.at(-1)!.entities).toEqual([{ entity: 'sensor.in', line_width: 1, dots: false, on_top: true }]);
  });
});
