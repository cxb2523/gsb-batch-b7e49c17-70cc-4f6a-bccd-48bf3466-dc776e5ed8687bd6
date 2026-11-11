import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { boxStats, heldSamples, jitter, rowSamples, spread, weightedQuantile, MAX_OUTLIERS } from '../src/chart/box';
import { boxPlace, categoryTicks, pickBox } from '../src/styles/box-plot';
import type { Box } from '../src/styles/box-plot';
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

const eq = (vs: number[]) => vs.map((v) => ({ v, w: 1 }));

describe('box maths', () => {
  it('takes textbook quartiles from equal weights', () => {
    const s = eq([1, 2, 3, 4]);
    expect(weightedQuantile(s, 0.5)).toBe(2.5);
    expect(weightedQuantile(s, 0)).toBe(1);
    expect(weightedQuantile(s, 1)).toBe(4);
    expect(weightedQuantile(eq([7]), 0.25)).toBe(7);
  });

  it('weights history by how long each value held', () => {
    // 20 for 9 hours, a flicker to 30 for ten minutes in all, then 20 again.
    const H = 3_600_000;
    const pts = [
      { t: 0, v: 20 },
      { t: 9 * H, v: 30 },
      { t: 9 * H + 600_000, v: null },
      { t: 9.5 * H, v: 20 },
    ];
    const samples = heldSamples(pts, 0, 10 * H);
    expect(samples).toEqual([
      { v: 20, w: 9 * H },
      { v: 30, w: 600_000 },
      { v: 20, w: 0.5 * H },
    ]);
    const stats = boxStats(samples, 'tukey')!;
    expect(stats.median).toBe(20);
    expect(stats.count).toBe(3);
    // Only the part inside the window counts; nothing before the first reading.
    expect(heldSamples(pts, 8 * H, 9 * H)).toEqual([{ v: 20, w: H }]);
    expect(heldSamples(pts, 5, 5)).toEqual([]);
    expect(heldSamples([{ t: 10, v: 1 }], 0, 5)).toEqual([]);
  });

  it('counts each statistics row once and widens the range with their extremes', () => {
    const rows = [
      { t: 0, v: 5, min: 1, max: 6, carried: true },
      { t: 10, v: 10, min: 8, max: 12 },
      { t: 20, v: 12, min: null, max: 20 },
      { t: 30, v: null },
      { t: 40, v: 11 },
    ];
    const { samples, extremes } = rowSamples(rows, 0, 40);
    expect(samples).toEqual(eq([10, 12]));
    expect(extremes).toEqual([8, 20]);
    expect(rowSamples(rows, 50, 60)).toEqual({ samples: [], extremes: undefined });
    const range = boxStats(samples, 'range', extremes)!;
    expect([range.low, range.high, range.outliers]).toEqual([8, 20, []]);
  });

  it('draws Tukey whiskers to the last reading within 1.5 × the box, the rest outliers', () => {
    const stats = boxStats(eq([1, 2, 3, 4, 5, 6, 7, 8, 30, -20]), 'tukey')!;
    expect(stats.low).toBe(1);
    expect(stats.high).toBe(8);
    expect(stats.outliers).toEqual([-20, 30]);
    expect(stats.min).toBe(-20);
    expect(stats.max).toBe(30);
    expect(stats.mean).toBeCloseTo(4.6);
    expect(boxStats([], 'tukey')).toBeUndefined();
    expect(boxStats([{ v: 3, w: 0 }], 'range')).toBeUndefined();
  });

  it('keeps only the furthest outliers when there are very many', () => {
    const many = [...eq(Array.from({ length: 400 }, () => 0)), ...eq(Array.from({ length: 100 }, (_, i) => 100 + i))];
    const stats = boxStats(many, 'tukey')!;
    expect(stats.outliers).toHaveLength(MAX_OUTLIERS);
    expect(stats.outliers.at(-1)).toBe(199);
    expect(stats.outliers[0]).toBe(140);
  });

  it('thins readings evenly and jitters them the same way every time', () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
    expect(jitter(3)).toBe(jitter(3));
    for (let i = 0; i < 50; i++) {
      expect(jitter(i)).toBeGreaterThanOrEqual(-1);
      expect(jitter(i)).toBeLessThan(1);
    }
  });

  it('places boxes side by side and picks the one under the pointer', () => {
    expect(categoryTicks(10, 4)).toEqual([0, 3, 6, 9]);
    expect(categoryTicks(3, 0)).toEqual([0]);
    const a = boxPlace({ category: 1, slot: 0 }, 2, Infinity);
    const b = boxPlace({ category: 1, slot: 1 }, 2, Infinity);
    expect(a.centre).toBeLessThan(1);
    expect(b.centre).toBeGreaterThan(1);
    expect(boxPlace({ category: 0, slot: 0 }, 1, 0.1).half).toBe(0.1);
    const boxes = [
      { category: 0, slot: 0 },
      { category: 1, slot: 0 },
      { category: 1, slot: 1 },
    ] as Box[];
    // Two categories: the second spans 0.5–1 of the axis, its slots either side of 0.75.
    expect(pickBox(boxes, 2, 2, 0.7)).toBe(1);
    expect(pickBox(boxes, 2, 2, 0.8)).toBe(2);
    expect(pickBox(boxes, 2, 2, 0.26)).toBeUndefined();
    expect(pickBox(boxes, 2, 2, 0.51)).toBeUndefined();
    expect(pickBox(boxes, 2, 1, 0.2)).toBe(0);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

// The fixture is relative to now and the tooltip test groups by day, so a real clock moves
// midnight through the readings: early or late in the day the first box holds the 40 spike as
// an outlier. Pin the clock to mid-afternoon local time; only Date is faked, timers stay real.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 10, 7, 15, 0, 0));
const now = Date.now();
const H = 3_600_000;
const sec = (msAgo: number) => (now - msAgo) / 1000;

function hassWith(history: Record<string, unknown>, statistics: Record<string, unknown> = {}) {
  const hass = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });
  hass.callWS = vi.fn(async (msg: Record<string, unknown>) =>
    msg.type === 'recorder/statistics_during_period' ? statistics : history,
  ) as HomeAssistant['callWS'];
  return hass;
}

const history = {
  'sensor.in': [
    { s: '19', lu: sec(20 * H) },
    { s: '20', lu: sec(15 * H) },
    { s: '22', lu: sec(10 * H) },
    { s: '40', lu: sec(9 * H) },
    { s: '21', lu: sec(8.9 * H) },
    { s: '23', lu: sec(4 * H) },
  ],
  'sensor.out': [
    { s: '5', lu: sec(20 * H) },
    { s: '9', lu: sec(4 * H) },
  ],
  'sensor.off': [{ s: 'unavailable', lu: sec(20 * H) }],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'box',
    entities: ['sensor.in', 'sensor.out'],
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('box plot', () => {
  it('draws one upright box per entity, named along the bottom, with the outlier as a dot', async () => {
    const card = await mount({ entities: ['sensor.in', 'sensor.out', 'sensor.off', 'sensor.gone'] });
    expect(qa(card, 'g.box')).toHaveLength(2);
    expect(qa(card, '.x-axis .axis-label').map((e) => e.textContent!.trim())).toEqual([
      'Inside',
      'Outside',
      'Off',
      'sensor.gone',
    ]);
    // 40 °C held for six minutes is beyond the whisker.
    expect(qa(card, 'g.box')[0].querySelector('.outliers')).not.toBeNull();
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Box plot of Inside, Outside, Off, sensor.gone');
    expect(q(card, '.content.style-box')).not.toBeNull();
  });

  it('groups by day into side-by-side boxes, shows readings, and turns on its side', async () => {
    const card = await mount({
      group_by: 'day',
      period: { last: 2, unit: 'day' },
      readings: true,
    } as Partial<CardConfig>);
    const boxes = qa(card, 'g.box');
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(boxes.map((b) => b.getAttribute('data-series')))).toEqual(new Set(['0', '1']));
    expect(qa(card, '.readings').length).toBe(boxes.length);
    const side = await mount({ orientation: 'horizontal', whiskers: 'range' } as Partial<CardConfig>);
    expect(qa(side, '.y-axis .axis-label').map((e) => e.textContent!.trim())).toEqual(['Inside', 'Outside']);
    expect(qa(side, '.x-axis .axis-label').every((e) => /^-?[\d.,]+$/.test(e.textContent!.trim()))).toBe(true);
    expect(qa(side, '.outliers')).toHaveLength(0);
  });

  it('reads statistics rows in hours when grouped', async () => {
    const t0 = Math.floor((now - 30 * H) / H) * H;
    const rows = Array.from({ length: 30 }, (_, i) => ({
      start: t0 + i * H,
      end: t0 + (i + 1) * H,
      mean: 10 + (i % 5),
      min: 5,
      max: 20,
    }));
    const hass = hassWith({}, { 'sensor.in': rows });
    const card = await mount(
      { source: 'statistics', group_by: 'day', entities: ['sensor.in'] } as Partial<CardConfig>,
      hass,
    );
    const call = (hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.period).toBe('hour');
    expect(call.types).toEqual(['mean', 'min', 'max']);
    expect(qa(card, 'g.box').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the picked box in a tooltip', async () => {
    const card = await mount({ group_by: 'day', period: { last: 1, unit: 'day' } } as Partial<CardConfig>);
    const area = q(card, '.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 180 }) as DOMRect;
    // Find a spot with a box: the last day's first slot sits just left of its centre.
    const ticks = qa(card, '.x-axis .axis-label').length;
    let tip: Element | null = null;
    for (let x = 1; x < 400 && !tip; x += 4) {
      area.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: 50, pointerType: 'mouse' }));
      await card.updateComplete;
      tip = q(card, '.tooltip');
    }
    expect(ticks).toBeGreaterThan(0);
    expect(tip).not.toBeNull();
    const names = qa(card, '.tooltip-name').map((e) => e.textContent);
    expect(names).toEqual(['Highest', 'Upper quartile', 'Median', 'Lower quartile', 'Lowest', 'Average', 'Readings']);
    expect(q(card, '.pick-band')).not.toBeNull();
    area.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
  });

  it('shows a tooltip on its side, and none when turned off', async () => {
    const card = await mount({ orientation: 'horizontal' } as Partial<CardConfig>);
    const area = q(card, '.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 180 }) as DOMRect;
    area.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 40, pointerType: 'mouse' }));
    await card.updateComplete;
    expect(q(card, '.tooltip-time')!.textContent).toBe('Inside');
    expect(qa(card, '.tooltip-name')).toContainEqual(expect.objectContaining({ textContent: 'Outliers' }));
    const off = await mount({ tooltip: false } as Partial<CardConfig>);
    expect(q(off, '.plot-area.hoverable')).toBeNull();
  });

  it('says when there is nothing to draw', async () => {
    const empty = await mount({}, hassWith({}));
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'box', entities: ['sensor.in'], ...extra } as CardConfig);
    expect(set({ orientation: 'sideways' })).toThrow('"orientation" must be one of: vertical, horizontal');
    expect(set({ whiskers: 'long' })).toThrow('"whiskers" must be one of: tukey, range');
    expect(set({ readings: 'yes' })).toThrow('"readings" must be true or false');
    expect(set({ group_by: 'year' })).toThrow(/group_by/);
    expect(set({ orientation: 'horizontal', whiskers: 'range', readings: true })).not.toThrow();
  });
});

describe('box plot editor', () => {
  it('writes orientation, whiskers and readings, without a "combine with" choice', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'box', group_by: 'day', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const data = form.data as Record<string, unknown>;
    expect(data).toMatchObject({ orientation: 'vertical', whiskers: 'tukey', readings: false, group_by: 'day' });
    const names = JSON.stringify(form.schema);
    expect(names).toContain('"orientation"');
    expect(names).not.toContain('"aggregate"');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...data, orientation: 'horizontal', whiskers: 'range', readings: true } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, orientation: 'horizontal', whiskers: 'range', readings: true });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string; path: string[] }[] }).fields;
    expect(fields).toEqual([{ name: 'box_color', path: ['color'] }]);
  });
});
