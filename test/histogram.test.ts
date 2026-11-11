import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { binEdges, binIndex, binTotals, formatDuration, pointWeights } from '../src/chart/histogram';
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
  'ha-switch',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

const H = 3_600_000;

describe('bin edges', () => {
  it('picks a round width for about the target number of bins, on its multiples', () => {
    expect(binEdges(17.3, 26.8, {}, 10)).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
    expect(binEdges(0.12, 0.47, {}, 4)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('honours a set width, a set count, and fixed ends', () => {
    expect(binEdges(17.3, 19.1, { width: 0.5 })).toEqual([17, 17.5, 18, 18.5, 19, 19.5]);
    expect(binEdges(10, 20, { bins: 4 })).toEqual([10, 12.5, 15, 17.5, 20]);
    expect(binEdges(10, 20, { bins: 2, min: 0, max: 30 })).toEqual([0, 15, 30]);
    expect(binEdges(3, 40, { width: 10, min: 0, max: 25 })).toEqual([0, 10, 20, 25]);
    // A width too narrow for the span is widened to keep the bin count sane.
    expect(binEdges(0, 1000, { width: 0.001 }).length).toBeLessThanOrEqual(101);
  });

  it('gives flat readings one bin around their value', () => {
    expect(binEdges(20, 20, {})).toEqual([20, 22]);
    expect(binEdges(5, 5, { bins: 3 }).map((e) => e.toFixed(3))).toEqual(['4.500', '4.833', '5.167', '5.500']);
    expect(binEdges(0, 0, {})).toEqual([0, 0.1]);
  });

  it('finds the bin for a value, with the top edge in the last bin', () => {
    const edges = [0, 10, 20, 30];
    expect(binIndex(0, edges)).toBe(0);
    expect(binIndex(9.99, edges)).toBe(0);
    expect(binIndex(10, edges)).toBe(1);
    expect(binIndex(30, edges)).toBe(2);
    expect(binIndex(-1, edges)).toBe(-1);
    expect(binIndex(31, edges)).toBe(-1);
    expect(binIndex(1, [0])).toBe(-1);
  });
});

describe('weights', () => {
  // 20 for 10 h, a burst of ten 30s in one minute, then back to 20 for the rest of the day.
  const burst: Point[] = [
    { t: 0, v: 20 },
    ...Array.from({ length: 10 }, (_, i) => ({ t: 10 * H + i * 6000, v: 30 })),
    { t: 10 * H + 60_000, v: 20 },
    { t: 24 * H, v: 20 },
  ];

  it('counts time held, so a burst of changes does not outweigh a steady day', () => {
    const w = pointWeights(burst, { mode: 'time', until: 24 * H, statistics: false });
    const totals = binTotals(burst, w, [15, 25, 35]);
    expect(totals[0]).toBe(24 * H - 60_000);
    expect(totals[1]).toBe(60_000);
    // Counting rows instead says the 30s won: ten of them against two (the right-edge copy is not a reading).
    const rows = binTotals(
      burst,
      pointWeights(burst, { mode: 'readings', until: 24 * H, statistics: false }),
      [15, 25, 35],
    );
    expect(rows).toEqual([2, 10]);
  });

  it('stops the last value at now, and skips gaps and the value carried in', () => {
    const pts: Point[] = [
      { t: 0, v: 5, carried: true },
      { t: H, v: null },
      { t: 2 * H, v: 7 },
    ];
    expect(pointWeights(pts, { mode: 'time', until: 3 * H, statistics: false })).toEqual([H, 0, H]);
    expect(pointWeights(pts, { mode: 'readings', until: 3 * H, statistics: false })).toEqual([0, 0, 1]);
    expect(pointWeights([], { mode: 'time', until: 0, statistics: false })).toEqual([]);
  });

  it('weighs statistics rows as one period each, and grouped points by their group', () => {
    const rows: Point[] = [
      { t: 0, v: 1 },
      { t: H, v: 2 },
      { t: 5 * H, v: 3 },
      { t: 6 * H, v: null },
    ];
    expect(pointWeights(rows, { mode: 'time', until: 9 * H, statistics: true })).toEqual([H, H, H, 0]);
    expect(pointWeights(rows, { mode: 'readings', until: 9 * H, statistics: true })).toEqual([1, 1, 1, 0]);
    expect(pointWeights([{ t: 0, v: 1 }], { mode: 'time', until: H, statistics: true })).toEqual([H]);
    const groups: Point[] = [
      { t: 0, end: 24 * H, v: 1 },
      { t: 24 * H, end: 48 * H, v: 2 },
      { t: 48 * H, end: 72 * H, v: null },
    ];
    expect(pointWeights(groups, { mode: 'time', until: 30 * H, statistics: false })).toEqual([24 * H, 6 * H, 0]);
    expect(pointWeights(groups, { mode: 'readings', until: 30 * H, statistics: false })).toEqual([1, 1, 0]);
  });

  it('writes durations in a few words', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(20_000)).toBe('< 1 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration(2 * H)).toBe('2 h');
    expect(formatDuration(3 * H + 20 * 60_000)).toBe('3 h 20 min');
    expect(formatDuration(52 * H)).toBe('2 d 4 h');
    expect(formatDuration(48 * H)).toBe('2 d');
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;

const history = {
  'sensor.in': [
    { s: '19', lu: sec(20 * H) },
    { s: '21', lu: sec(14 * H) },
    { s: 'unavailable', lu: sec(8 * H) },
    { s: '22.5', lu: sec(2 * H) },
  ],
  'sensor.out': [
    { s: '5', lu: sec(20 * H) },
    { s: '9', lu: sec(4 * H) },
  ],
};

function hassWith(data: Record<string, { s: string; lu: number }[]>) {
  const hass = makeHass({
    'sensor.in': ['22.5', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => data) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, data = history) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'histogram',
    entities: ['sensor.in'],
    ...config,
  } as CardConfig);
  card.hass = hassWith(data);
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);

afterEach(() => {
  document.body.innerHTML = '';
});

function hover(card: Card, fx: number, type = 'mouse') {
  const area = q(card, '.plot-area') as HTMLElement;
  area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 180 }) as DOMRect;
  const ev = new MouseEvent('pointermove', { clientX: fx * 400, clientY: 50, bubbles: true });
  Object.defineProperty(ev, 'pointerType', { value: type });
  area.dispatchEvent(ev);
}

describe('histogram chart', () => {
  it('draws one bar per range, sized by share of time, with value labels along the bottom', async () => {
    const card = await mount({ bin_width: 1 });
    const bars = qa(card, 'rect.bin');
    // 19 for 6 h, 21 for 6 h, 22.5 for 2 h: three bins with time in them.
    expect(bars).toHaveLength(3);
    const heights = bars.map((b) => Number(b.getAttribute('height')));
    expect(heights[0]).toBeCloseTo(heights[1]);
    expect(heights[0]).toBeGreaterThan(heights[2] * 2.5);
    expect(qa(card, '.y-axis .axis-label').some((l) => l.textContent!.includes('%'))).toBe(true);
    expect(qa(card, '.x-axis .axis-label').map((l) => l.textContent)).toContain('20');
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Histogram chart of Inside');
    expect(bars[0].getAttribute('fill')).toContain('--primary-color');
  });

  it('counts readings instead, as hours, and colours bins by band', async () => {
    const readings = await mount({ count: 'readings', show_as: 'total', bin_width: 1 } as Partial<CardConfig>);
    expect(qa(readings, 'rect.bin')).toHaveLength(3);
    const hours = await mount({
      show_as: 'total',
      bins: 2,
      color_by: 'bands',
      severity: [
        { from: 0, color: 'blue' },
        { from: 21, color: 'red' },
      ],
    } as Partial<CardConfig>);
    expect(qa(hours, '.y-axis .axis-label').some((l) => / h$/.test(l.textContent!))).toBe(true);
    const fills = qa(hours, 'rect.bin').map((b) => b.getAttribute('fill'));
    expect(fills[0]).toContain('--info-color');
    expect(fills[1]).toContain('--error-color');
  });

  it('puts two entities side by side, or over each other', async () => {
    const side = await mount({ entities: ['sensor.in', 'sensor.out'], bin_width: 5 } as Partial<CardConfig>);
    const groups = qa(side, 'g.series');
    expect(groups).toHaveLength(2);
    const [a] = qa(side, 'g.series[data-series="0"] rect.bin');
    const [b] = qa(side, 'g.series[data-series="1"] rect.bin');
    expect(Number(a.getAttribute('width'))).toBeLessThan(200);
    expect(b.getAttribute('fill')).toContain('--warning-color');
    const over = await mount({
      entities: ['sensor.in', 'sensor.out'],
      bars: 'overlap',
      bin_width: 5,
    } as Partial<CardConfig>);
    expect(q(over, 'g.overlap')).not.toBeNull();
    expect(qa(over, 'rect.bin')[0].getAttribute('stroke')).not.toBe('none');
  });

  it('leaves out readings outside a fixed range', async () => {
    const card = await mount({ x_min: 20, x_max: 25, bin_width: 1 } as Partial<CardConfig>);
    expect(qa(card, 'rect.bin')).toHaveLength(2);
    expect(qa(card, '.x-axis .axis-label')[0].textContent).toBe('20');
  });

  it('shows the time and share in a bin on hover', async () => {
    const card = await mount({ entities: ['sensor.in', 'sensor.out'], bin_width: 5 } as Partial<CardConfig>);
    // Bins 5–10, 10–15, 15–20, 20–25: the first quarter is 5–10.
    hover(card, 0.1);
    await card.updateComplete;
    expect(q(card, '.tooltip-time')!.textContent).toBe('5 – 10 °C');
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toBe('Inside 0% · 0 min');
    expect(rows[1]).toMatch(/^Outside 100% · 20 h/);
    expect(q(card, '.pick-band')).not.toBeNull();
    const area = q(card, '.plot-area') as HTMLElement;
    area.dispatchEvent(Object.assign(new MouseEvent('pointerleave', { bubbles: true }), {}));
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
    const counted = await mount({ count: 'readings', bin_width: 5 } as Partial<CardConfig>);
    hover(counted, 0.9);
    await counted.updateComplete;
    expect(q(counted, '.tooltip-row')!.textContent).toMatch(/67% · 2 readings\s*$/);
    const many = await mount({ count: 'readings', bins: 1 } as Partial<CardConfig>);
    hover(many, 0.5);
    await many.updateComplete;
    expect(q(many, '.tooltip-row')!.textContent).toMatch(/3 readings\s*$/);
    const off = await mount({ tooltip: false } as Partial<CardConfig>);
    expect(q(off, '.plot-area.hoverable')).toBeNull();
  });

  it('says when there is nothing to draw, and copes with an unavailable or missing entity', async () => {
    const empty = await mount({}, {});
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
    const card = await mount({ entities: ['sensor.in', 'sensor.missing'], header: 'over' } as Partial<CardConfig>);
    expect(qa(card, 'g.series')).toHaveLength(2);
    expect(qa(card, 'g.series[data-series="1"] rect')).toHaveLength(0);
    expect(q(card, '.header-over')).not.toBeNull();
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'histogram', entities: ['sensor.in'], ...extra } as CardConfig);
    expect(set({ count: 'rows' })).toThrow('"count" must be one of: time, readings');
    expect(set({ show_as: 'pie' })).toThrow(/show_as/);
    expect(set({ bars: 'stacked' })).toThrow(/bars/);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ bins: 0 })).toThrow(/bins/);
    expect(set({ bins: 2.5 })).toThrow(/bins/);
    expect(set({ bin_width: -1 })).toThrow(/bin_width/);
    expect(set({ x_min: 5, x_max: 1 })).toThrow(/x_min/);
    expect(set({ bins: 10, bin_width: 0.5, count: 'readings' })).not.toThrow();
  });
});

describe('histogram editor', () => {
  it('shows the Chart section and writes bins, counting and layout', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'histogram', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({
      count: 'time',
      show_as: 'percent',
      bars: 'side',
      color_by: 'series',
      hist_x_axis: true,
      y_axis: true,
    });
    const names = JSON.stringify(form.schema);
    for (const n of ['bins', 'bin_width', 'x_min', 'x_max', 'hist_x_axis', 'period_calendar', 'compact']) {
      expect(names).toContain(`"${n}"`);
    }
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...(form.data as object),
            bins: 12,
            count: 'readings',
            bars: 'overlap',
            x_min: 10,
            hist_x_axis: false,
          },
        },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, bins: 12, count: 'readings', bars: 'overlap', x_min: 10, x_axis: false });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string; path: string[] }[] }).fields;
    expect(fields).toEqual([{ name: 'bar_color', path: ['color'] }]);
  });
});
