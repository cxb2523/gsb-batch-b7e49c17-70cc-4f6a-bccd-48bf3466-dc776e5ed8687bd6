import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { axisOptions, validateAxisOptions } from '../src/chart/axes';
import { logAxis, logScale, logTickText, positivePoints } from '../src/chart/log-scale';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of ['ha-form', 'ha-expansion-panel', 'ha-selector', 'ha-entity-picker', 'ha-icon-picker']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

describe('log axis maths', () => {
  it('labels each power of ten when a few decades are shown, with fainter steps between', () => {
    const a = logAxis([1, 1000], {}, 4);
    expect(a.domain).toEqual([1, 1000]);
    expect(a.ticks).toEqual([1, 10, 100, 1000]);
    expect(a.minor).toContain(2);
    expect(a.minor).toContain(900);
    expect(a.minor).toHaveLength(24);
  });

  it('moves loose ends out to the next labelled step', () => {
    expect(logAxis([12, 870], {}, 4)).toMatchObject({ domain: [10, 1000], ticks: [10, 100, 1000] });
  });

  it('labels 1, 2 and 5 within a decade, or every step for a narrow span', () => {
    expect(logAxis([0.5, 3], {}, 4)).toMatchObject({
      domain: [0.5, 5],
      ticks: [0.5, 1, 2, 5],
      tickDecimals: [1, 0, 0, 0],
    });
    const narrow = logAxis([18, 24], {}, 4);
    expect(narrow.ticks).toEqual([10, 20, 30]);
    expect(narrow.minor).toEqual([]);
  });

  it('skips powers of ten when there are more decades than labels, counting from the bottom', () => {
    const a = logAxis([0.003, 2e6], {}, 4);
    expect(a.domain).toEqual([0.001, 1e7]);
    expect(a.ticks).toEqual([0.001, 1, 1000, 1e6]);
    expect(a.minor).toEqual([0.01, 0.1, 10, 100, 10000, 100000, 1e7]);
    expect(a.decimals).toBe(3);
  });

  it('keeps fixed ends exactly', () => {
    expect(logAxis([3, 40], { min: 1 }, 4)).toMatchObject({ domain: [1, 100], ticks: [1, 10, 100] });
    expect(logAxis([3, 40], { max: 500 }, 4).domain).toEqual([1, 500]);
  });

  it('gives flat readings, readings past a fixed end, and no readings some room', () => {
    expect(logAxis([5, 5], {}, 4).domain).toEqual([1, 20]);
    expect(logAxis([5, 8], { min: 50 }, 4).domain).toEqual([50, 500]);
    expect(logAxis([500, 800], { max: 50 }, 4).domain).toEqual([5, 50]);
    expect(logAxis(undefined, {}, 4).domain).toEqual([1, 100]);
    // A caller that didn't drop zero: the bottom becomes three decades under the top.
    expect(logAxis([0, 1000], {}, 4).domain).toEqual([1, 1000]);
    expect(logAxis([-5, -1], {}, 4).domain).toEqual([0.1, 100]);
  });

  it('maps by logarithm and has no place for zero or below', () => {
    const y = logScale([1, 1000], [200, 0]);
    expect(y(1)).toBe(200);
    expect(y(1000)).toBe(0);
    expect(y(10)).toBeCloseTo(133.33, 1);
    expect(y(0)).toBeNaN();
    expect(y(-3)).toBeNaN();
    expect(logScale([5, 5], [200, 0])(5)).toBe(200);
  });

  it('turns readings at or below zero into gaps, min and max too', () => {
    const pts = positivePoints([
      { t: 1, v: 5 },
      { t: 2, v: 0 },
      { t: 3, v: -2, min: -4, max: 3 },
      { t: 4, v: null },
    ]);
    expect(pts).toEqual([
      { t: 1, v: 5 },
      { t: 2, v: null },
      { t: 3, v: null, min: null, max: 3 },
      { t: 4, v: null },
    ]);
  });

  it('writes small ticks with the decimals they need and big ones short', () => {
    const hass = makeHass({});
    expect(logTickText(0.01, 2, hass)).toBe('0.01');
    expect(logTickText(1000, 0, hass)).toBe('1,000');
    expect(logTickText(1e6, 0, hass)).toBe('1M');
    expect(logTickText(20000, 0, { ...hass, locale: { language: 'xx-nope' } } as HomeAssistant)).toBe('20K');
  });
});

describe('log scale option', () => {
  const base = { type: 'x', entities: [] } as unknown as CardConfig;
  const check = (extra: Record<string, unknown>) => () => validateAxisOptions({ ...base, ...extra } as CardConfig);

  it('defaults to linear and reads log', () => {
    expect(axisOptions(base).scale).toBe('linear');
    expect(axisOptions({ ...base, y_scale: 'log' } as CardConfig).scale).toBe('log');
  });

  it('explains a bad scale, and ends at or below zero on a log scale', () => {
    expect(check({ y_scale: 'logarithmic' })).toThrow('"y_scale" must be one of: linear, log');
    expect(check({ y_scale: 'log', y_min: 0 })).toThrow('"y_min" must be above 0 on a log scale');
    expect(check({ y_scale: 'log', y_max: -1 })).toThrow('"y_max" must be above 0 on a log scale');
    expect(check({ y_scale: 'log', y_min: 0.1, y_max: 1000 })).not.toThrow();
    expect(check({ y_min: 0 })).not.toThrow();
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const H = 3_600_000;
const sec = (msAgo: number) => (now - msAgo) / 1000;

async function mount(config: Partial<CardConfig>, history: Record<string, { s: string; lu: number }[]>) {
  const hass = makeHass({
    'sensor.lux': ['800', { friendly_name: 'Light', unit_of_measurement: 'lx' }],
    'sensor.net': ['0', { friendly_name: 'Traffic', unit_of_measurement: 'B/s' }],
  });
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.lux', 'sensor.net'],
    y_scale: 'log',
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('line chart on a log scale', () => {
  const history = {
    'sensor.lux': [
      { s: '2', lu: sec(20 * H) },
      { s: '40', lu: sec(12 * H) },
      { s: '0', lu: sec(10 * H) },
      { s: '30000', lu: sec(6 * H) },
      { s: '800', lu: sec(2 * H) },
    ],
    'sensor.net': [
      { s: '-5', lu: sec(20 * H) },
      { s: '0', lu: sec(4 * H) },
    ],
  };

  it('labels powers of ten, breaks the line at zero, and leaves the all-zero series undrawn', async () => {
    const card = await mount({ labels: true }, history);
    const labels = qa(card, '.y-axis .axis-label').map((e) => e.textContent!.trim());
    // Five decades is more than the labels fit: every other power of ten, the rest as faint lines.
    expect(labels).toEqual(['1', '100', '10K']);
    expect(qa(card, '.grid line.minor').length).toBeGreaterThan(0);
    const [lux, net] = qa(card, 'path.line');
    // Two runs: before the zero, and after it.
    expect(lux.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(net.getAttribute('d')).toBe('');
    const points = qa(card, '.point-label').map((e) => e.textContent);
    expect(points).toEqual(['2.0', '40.0', '30,000.0', '800.0']);
    expect(points).not.toContain('0.0');
  });

  it('puts band stops where the values are drawn', async () => {
    const card = await mount(
      {
        color_by: 'bands',
        y_min: 1,
        y_max: 100,
        severity: [
          { from: 0, color: 'blue' },
          { from: 10, color: 'red' },
        ],
      },
      history,
    );
    const offsets = qa(card, '#cd-bands-0 stop').map((s) => Number(s.getAttribute('offset')));
    expect(offsets).toEqual([0, 0.5, 0.5, 1]);
  });

  it('reads a zero out in the tooltip without a dot for it', async () => {
    const card = await mount({}, history);
    const area = card.shadowRoot!.querySelector('.plot-area')!;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160 }) as DOMRect;
    // 10 h ago: the light read 0 then, and the traffic's nearest reading is its 0 from 4 h ago.
    const ev = new MouseEvent('pointermove', { bubbles: true, clientX: (14 / 24) * 1000 });
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
    area.dispatchEvent(ev);
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Light 0.0 lx', 'Traffic 0.0 B/s']);
    expect(qa(card, '.hover-dot')).toHaveLength(0);
  });

  it('breaks the line at zero in each small chart too', async () => {
    const card = await mount({ multiples: true }, history);
    const lines = qa(card, 'path.line');
    // The light's line in two runs; the traffic never goes above zero, so its chart says it has nothing.
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(lines[0].getAttribute('d')).not.toContain('NaN');
    expect(qa(card, '.panel .chart-message')).toHaveLength(1);
  });

  it('says so when nothing is above zero', async () => {
    const card = await mount({ entities: ['sensor.net'] }, history);
    expect(card.shadowRoot!.querySelector('.chart-message')!.textContent).toContain('Nothing above zero');
  });

  it('turns down a log scale with a bottom at zero', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({ type: 'x', style: 'line', entities: ['sensor.lux'], y_scale: 'log', y_min: 0 } as CardConfig),
    ).toThrow('"y_min" must be above 0 on a log scale');
  });
});

describe('log scale in the editor', () => {
  it('offers the value scale in the Chart section and writes y_scale', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.lux'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect((form.data as Record<string, unknown>).y_scale).toBe('linear');
    const field = JSON.stringify(form.schema);
    expect(field).toContain('"name":"y_scale"');
    expect(field).toContain('Logarithmic (powers of ten)');
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), y_scale: 'log' } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, y_scale: 'log' });
  });
});
