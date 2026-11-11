import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  autoSide,
  edge,
  labelOptions,
  labelWidth,
  pickPoints,
  placeLabels,
  sliceAnchor,
  validateLabelOptions,
} from '../src/chart/data-labels';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

const pts = (...vs: (number | null)[]) => vs.map((v, t) => ({ t, v }));

describe('label options', () => {
  it('reads and checks them', () => {
    const check = (extra: Record<string, unknown>) => () => validateLabelOptions({ type: 'x', ...extra } as CardConfig);
    expect(
      check({ labels: true, labels_show: 'minmax', labels_position: 'below', labels_overlap: true }),
    ).not.toThrow();
    expect(check({ labels: 'yes' })).toThrow('"labels" must be true or false');
    expect(check({ labels_show: 'some' })).toThrow('"labels_show" must be one of: all, last, minmax, ends');
    expect(check({ labels_position: 'left' })).toThrow('"labels_position" must be one of: auto, above, below, center');
    expect(check({ labels_overlap: 1 })).toThrow('"labels_overlap" must be true or false');
    expect(labelOptions({ type: 'x' } as CardConfig)).toBeUndefined();
    expect(labelOptions({ type: 'x', labels: true } as CardConfig)).toEqual({
      show: 'all',
      position: 'auto',
      hideOverlap: true,
    });
    expect(labelOptions({ type: 'x', labels: true, labels_overlap: true } as CardConfig)!.hideOverlap).toBe(false);
  });
});

describe('choosing and placing labels', () => {
  it('picks the readings to label, most important first, never a gap', () => {
    const p = pts(3, null, 9, 1, 5, null);
    expect(pickPoints(p, 'last')).toEqual([4]);
    expect(pickPoints(p, 'ends')).toEqual([4, 0]);
    expect(pickPoints(p, 'minmax')).toEqual([2, 3]);
    expect(pickPoints(p, 'all')).toEqual([4, 2, 3, 0]);
    expect(pickPoints(pts(null), 'all')).toEqual([]);
  });

  it('puts a peak label above and a dip label below', () => {
    const p = pts(1, 5, 2, null, 4);
    expect(autoSide(p, 1)).toBe('above');
    expect(autoSide(p, 2)).toBe('below');
    expect(autoSide(p, 4)).toBe('above');
    expect(autoSide(pts(7), 0)).toBe('above');
  });

  it('places labels where they fit, tries the other side, and hides the rest', () => {
    const at = (x: number, y: number, sides: ('above' | 'below' | 'center' | 'auto')[] = ['above', 'below']) => ({
      x,
      y,
      width: 30,
      sides,
    });
    const placed = placeLabels(
      [at(50, 50), at(60, 50), at(70, 50), at(50, 5, ['above']), at(200, 50, ['auto'])],
      100,
      true,
    );
    expect(placed.map((p) => p?.side)).toEqual(['above', 'below', undefined, undefined, 'above']);
    expect(placed[0]!.box).toEqual([35, 30, 65, 44]);
    expect(placeLabels([at(50, 50, ['center'])], 100, true)[0]!.box).toEqual([35, 43, 65, 57]);
    // Allowed to overlap, each takes its first side.
    expect(placeLabels([at(50, 50), at(50, 50), at(50, 2)], 100, false).map((p) => p?.side)).toEqual([
      'above',
      'above',
      'above',
    ]);
  });

  it('sizes labels, keeps them inside the plot, and anchors slice labels', () => {
    expect(labelWidth('21.5')).toBe(30);
    expect(edge(5, 30, 300)).toBe('start');
    expect(edge(295, 30, 300)).toBe('end');
    expect(edge(150, 30, 300)).toBe('');
    const [x, y] = sliceAnchor(0, Math.PI / 2, 0.4);
    expect(x).toBeCloseTo(0.5 + 0.4 * Math.SQRT1_2);
    expect(y).toBeCloseTo(0.5 - 0.4 * Math.SQRT1_2);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass(rows = 6) {
  const h = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  h.callWS = vi.fn(async () => ({
    'sensor.in': Array.from({ length: rows }, (_, i) => ({
      s: String(20 + (i % 3)),
      lu: sec((22 - (i * 20) / rows) * H),
    })),
    'sensor.out': [
      { s: '5', lu: sec(20 * H) },
      { s: '2', lu: sec(10 * H) },
      { s: '9', lu: sec(4 * H) },
    ],
  })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>, rows?: number) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    ...extra,
  } as CardConfig);
  card.hass = hass(rows);
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const labels = (card: Card) =>
  [...card.shadowRoot!.querySelectorAll('.point-label')].map((e) => ({ text: e.textContent, cls: e.className }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('data labels on the line chart', () => {
  it('labels the readings it is asked to, not the carried edges', async () => {
    const all = await mount({ labels: true });
    const texts = labels(all).map((l) => l.text);
    expect(texts).toContain('5.0');
    expect(texts).toContain('2.0');
    expect(texts.filter((t) => t === '9.0')).toHaveLength(1);
    const minmax = await mount({ labels: true, labels_show: 'minmax' });
    expect(labels(minmax).map((l) => l.text)).toEqual(expect.arrayContaining(['20.0', '22.0', '2.0', '9.0']));
    expect(labels(minmax)).toHaveLength(4);
    const last = await mount({ labels: true, labels_show: 'last' });
    expect(labels(last).map((l) => l.text)).toEqual(expect.arrayContaining(['22.0', '9.0']));
    expect(labels(last)).toHaveLength(2);
    const off = await mount({});
    expect(labels(off)).toHaveLength(0);
  });

  it('puts dips below, and honours a fixed position', async () => {
    const auto = await mount({ labels: true, labels_show: 'minmax', y_min: -20 });
    expect(labels(auto).find((l) => l.text === '2.0')!.cls).toContain('below');
    const center = await mount({ labels: true, labels_position: 'center' });
    expect(labels(center).every((l) => l.cls.includes('center'))).toBe(true);
  });

  it('hides labels that would overlap, unless told to let them', async () => {
    const crowded = await mount({ labels: true, entities: ['sensor.in'] }, 60);
    const hidden = labels(crowded).length;
    expect(hidden).toBeGreaterThan(3);
    expect(hidden).toBeLessThan(60);
    const overlap = await mount({ labels: true, labels_overlap: true, entities: ['sensor.in'] }, 30);
    expect(labels(overlap)).toHaveLength(30);
    // Allowed to overlap, a series too crowded to read gets none.
    const tooMany = await mount({ labels: true, labels_overlap: true, entities: ['sensor.in'] }, 60);
    expect(labels(tooMany)).toHaveLength(0);
  });
});

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

describe('data labels in the editor', () => {
  it('shows the label choices once labels are on, and writes them', async () => {
    await import('../src/editor/chartdeck-card-editor');
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = () => ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(JSON.stringify(form().schema)).not.toContain('labels_show');
    ed.setConfig({ ...raw, labels: true });
    await ed.updateComplete;
    expect(JSON.stringify(form().schema)).toContain('labels_show');
    form().dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form().data as object), labels_show: 'minmax', labels_overlap: true } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, labels: true, labels_show: 'minmax', labels_overlap: true });
  });
});
