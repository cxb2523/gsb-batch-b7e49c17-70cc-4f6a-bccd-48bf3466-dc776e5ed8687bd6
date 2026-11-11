import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  baseline,
  binSeries,
  insideOut,
  layersExtent,
  placeLabels,
  sampleBounds,
  stack,
  stackable,
  toShares,
  widest,
} from '../src/chart/stream';
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

describe('stream maths', () => {
  it('cuts the range into even bins up to now', () => {
    expect(sampleBounds({ start: 0, end: 100 }, 1000, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(sampleBounds({ start: 0, end: 100 }, 50, 2)).toEqual([0, 25, 50]);
    // Not begun yet: one bin, so nothing divides by zero.
    expect(sampleBounds({ start: 100, end: 200 }, 50, 3)).toHaveLength(4);
  });

  it('bins history by time-weighted mean, statistics by the mean of their rows', () => {
    const history = [
      { t: 0, v: 10 },
      { t: 90, v: 0 },
      { t: 100, v: null },
    ];
    expect(binSeries(history, [0, 100, 200], 'history', 200)).toEqual([9, null]);
    const rows = [
      { t: 0, v: 2 },
      { t: 50, v: 4 },
      { t: 100, v: 6 },
    ];
    expect(binSeries(rows, [0, 100, 200], 'statistics', 200)).toEqual([3, 6]);
  });

  it('stacks gaps and negative readings as nothing', () => {
    expect(stackable([1, null, -2, Number.NaN, 3])).toEqual([1, 0, 0, 0, 3]);
  });

  it('orders inside out: early peaks first, each to the lighter side', () => {
    const values = [
      [5, 1, 1],
      [1, 5, 1],
      [1, 1, 5],
      [9, 9, 9],
    ];
    // By peak: 0, 3 (a tie keeps the listed order), 1, 2; each goes to the lighter side.
    const order = insideOut(values);
    expect(order).toHaveLength(4);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(order).toEqual([2, 1, 0, 3]);
  });

  it('puts the baseline at zero, centred, or where the layers wiggle least', () => {
    const rows = [
      [1, 2],
      [3, 4],
    ];
    expect(baseline(rows, 'zero')).toEqual([0, 0]);
    expect(baseline(rows, 'share')).toEqual([0, 0]);
    expect(baseline(rows, 'centre')).toEqual([-2, -3]);
    // One flat layer: no wiggle to remove, and it is centred on zero.
    expect(baseline([[2, 2, 2]], 'wiggle')).toEqual([-1, -1, -1]);
    // A layer growing under a flat one: the baseline moves down so the flat one stays flatter.
    const g = baseline(
      [
        [0, 4],
        [2, 2],
      ],
      'wiggle',
    );
    expect(g[1]).toBeLessThan(g[0]);
    expect(baseline([], 'wiggle')).toEqual([]);
  });

  it('turns columns into shares, leaving empty columns empty', () => {
    expect(
      toShares([
        [1, 0],
        [3, 0],
      ]),
    ).toEqual([
      [25, 0],
      [75, 0],
    ]);
  });

  it('stacks layers in order, returned in series order', () => {
    const layers = stack(
      [
        [1, 1],
        [2, 2],
      ],
      [1, 0],
      'zero',
    );
    expect(layers[1]).toEqual({ lower: [0, 0], upper: [2, 2] });
    expect(layers[0]).toEqual({ lower: [2, 2], upper: [3, 3] });
    expect(layersExtent(layers)).toEqual([0, 3]);
    expect(layersExtent([])).toBeUndefined();
    const shares = stack([[1], [3]], [0, 1], 'share');
    expect(shares[1].upper).toEqual([100]);
    expect(widest({ lower: [0, 0, 1], upper: [1, 3, 2] })).toEqual({ at: 1, thickness: 3 });
  });

  it('places labels thickest first, inside the plot, never overlapping', () => {
    const placed = placeLabels(
      [
        { key: 0, x: 50, y: 50, width: 60, thickness: 20 },
        { key: 1, x: 60, y: 55, width: 60, thickness: 30 },
        { key: 2, x: 5, y: 10, width: 40, thickness: 20 },
        { key: 3, x: 50, y: 90, width: 500, thickness: 40 },
      ],
      200,
    );
    expect(placed.get(1)).toBe(30);
    expect(placed.has(0)).toBe(false);
    expect(placed.get(2)).toBe(2);
    expect(placed.has(3)).toBe(false);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;
const H = 3_600_000;

function hassWith(history: Record<string, { s: string; lu: number }[]>) {
  const hass = makeHass({
    'sensor.heat': ['1200', { friendly_name: 'Heat pump', unit_of_measurement: 'W' }],
    'sensor.ev': ['0', { friendly_name: 'EV', unit_of_measurement: 'W' }],
    'sensor.gone': ['unavailable', { friendly_name: 'Gone', unit_of_measurement: 'W' }],
  });
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

const history = {
  'sensor.heat': [
    { s: '1000', lu: sec(20 * H) },
    { s: '2000', lu: sec(10 * H) },
    { s: '1200', lu: sec(2 * H) },
  ],
  'sensor.ev': [
    { s: '7000', lu: sec(20 * H) },
    { s: '-50', lu: sec(12 * H) },
    { s: 'unavailable', lu: sec(8 * H) },
    { s: '0', lu: sec(6 * H) },
  ],
  'sensor.gone': [{ s: 'unavailable', lu: sec(20 * H) }],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'streamgraph',
    entities: ['sensor.heat', 'sensor.ev', 'sensor.gone'],
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

function point(el: Element, type: string, frac: number) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: frac * 1000 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('streamgraph', () => {
  it('draws one closed stream per entity with no value labels, an unavailable one flat', async () => {
    const card = await mount({});
    const streams = qa(card, 'path.stream');
    expect(streams).toHaveLength(3);
    for (const s of streams) expect(s.getAttribute('d')).toMatch(/^M.*Z$/);
    expect(streams.find((s) => s.getAttribute('data-index') === '0')!.getAttribute('fill')).toContain(
      '--primary-color',
    );
    expect(q(card, '.y-axis')).toBeNull();
    expect(q(card, '.x-axis')).not.toBeNull();
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Streamgraph chart of Heat pump, EV, Gone');
    expect(qa(card, '.series-item')).toHaveLength(3);
    // The heat pump is the thickest stream: it gets its name on it.
    expect(qa(card, '.stream-label').map((l) => l.textContent)[0]).toMatch(/^Heat pump [\d,.]+ W$/);
  });

  it('stacks shares of the total from 0 to 100, and from zero when asked', async () => {
    const card = await mount({ baseline: 'share', stream_order: 'listed', labels: false } as Partial<CardConfig>);
    const ticks = qa(card, '.y-axis .axis-label').map((l) => l.textContent);
    expect(ticks[0]).toBe('0');
    expect(ticks.at(-1)).toBe('100');
    expect(q(card, '.stream-label')).toBeNull();
    const zero = await mount({ baseline: 'zero', curve: 'step' } as Partial<CardConfig>);
    expect(qa(zero, '.y-axis .axis-label')[0].textContent).toBe('0');
    expect(q(zero, 'path.stream')!.getAttribute('d')).toMatch(/H/);
  });

  it('streams grouped readings one value per group', async () => {
    const card = await mount({ group_by: 'hour', baseline: 'centre' } as Partial<CardConfig>);
    expect(qa(card, 'path.stream')).toHaveLength(3);
  });

  it('lists every value, its share and the total on hover', async () => {
    const card = await mount({ baseline: 'share' } as Partial<CardConfig>);
    point(q(card, '.plot-area')!, 'pointermove', 0.3);
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.startsWith('EV'))).toMatch(/W · \d+ %$/);
    expect(rows.at(-1)).toMatch(/^Total /);
    point(q(card, '.plot-area')!, 'pointerleave', 0.1);
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
  });

  it('opens more-info from a stream', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const stream = q(card, 'path.stream[data-index="1"]')!;
    stream.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    stream.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.ev']);
  });

  it('says when there is nothing to draw', async () => {
    const card = await mount({}, hassWith({}));
    expect(q(card, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'streamgraph', entities: ['sensor.heat'], ...extra } as CardConfig);
    expect(set({ baseline: 'flat' })).toThrow(/"baseline" must be one of: wiggle, centre, share, zero/);
    expect(set({ stream_order: 'random' })).toThrow(/stream_order/);
    expect(set({ labels: 'yes' })).toThrow(/labels/);
    expect(set({ source: 'cloud' })).toThrow(/source/);
    expect(set({ baseline: 'share', stream_order: 'listed', labels: false })).not.toThrow();
  });
});

describe('streamgraph editor', () => {
  async function editor(config: Partial<CardConfig>) {
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
      style: 'streamgraph',
      entities: ['sensor.heat'],
      ...config,
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events, raw, form: ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub };
  }

  const names = (schema: unknown[]): string[] =>
    schema.flatMap((s) => {
      const item = s as { name: string; schema?: unknown[] };
      return item.schema ? names(item.schema) : [item.name];
    });

  it('writes the shape, order, edges and labels, and hides the value scale on a floating stream', async () => {
    const { ed, events, raw, form } = await editor({});
    expect(form.data).toMatchObject({
      baseline: 'wiggle',
      stream_order: 'inside_out',
      stream_curve: 'smooth',
      stream_labels: true,
    });
    expect(names(form.schema as unknown[])).not.toContain('y_axis');
    expect(names(form.schema as unknown[])).not.toContain('y_min');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...(form.data as object),
            baseline: 'share',
            stream_order: 'listed',
            stream_curve: 'straight',
            stream_labels: false,
          },
        },
      }),
    );
    expect(events.at(-1)).toEqual({
      ...raw,
      baseline: 'share',
      stream_order: 'listed',
      curve: 'straight',
      labels: false,
    });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect((list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual(['fill_color']);
  });

  it('shows value labels for a stack from zero', async () => {
    const { form } = await editor({ baseline: 'zero' } as Partial<CardConfig>);
    expect(names(form.schema as unknown[])).toContain('y_axis');
  });
});
