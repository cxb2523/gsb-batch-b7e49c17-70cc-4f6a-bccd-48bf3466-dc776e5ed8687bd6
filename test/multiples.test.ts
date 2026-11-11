import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { multiplesColumns, multiplesOptions, panelWidth, validateMultiples } from '../src/chart/multiples';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

describe('small multiples options', () => {
  it('reads and checks them', () => {
    const check = (extra: Record<string, unknown>) => () => validateMultiples({ type: 'x', ...extra } as CardConfig);
    expect(check({ multiples: true, multiples_scale: 'independent', multiples_columns: 3 })).not.toThrow();
    expect(check({ multiples: 'yes' })).toThrow('"multiples" must be true or false');
    expect(check({ multiples_scale: 'own' })).toThrow('"multiples_scale" must be one of: auto, shared, independent');
    expect(check({ multiples_columns: 0 })).toThrow('"multiples_columns" must be a whole number from 1 to 6');
    expect(check({ multiples_columns: 2.5 })).toThrow('"multiples_columns" must be a whole number from 1 to 6');
    expect(multiplesOptions({ type: 'x' } as CardConfig)).toBeUndefined();
    expect(multiplesOptions({ type: 'x', multiples: true } as CardConfig)).toEqual({
      scale: 'auto',
      columns: undefined,
    });
  });

  it('fits columns to the card, never more than there are charts', () => {
    expect(multiplesColumns(4, 488)).toBe(3);
    expect(multiplesColumns(2, 488)).toBe(2);
    expect(multiplesColumns(4, 288)).toBe(1);
    expect(multiplesColumns(5, 488, 4)).toBe(4);
    // A set count drops to fewer on a narrow card.
    expect(multiplesColumns(5, 288, 4)).toBe(2);
    expect(multiplesColumns(0, 488)).toBe(1);
    expect(panelWidth(488, 3)).toBeCloseTo(154.67, 2);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass() {
  const h = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
    'sensor.off': 'unavailable',
  });
  h.callWS = vi.fn(async () => ({
    'sensor.in': [
      { s: '19', lu: sec(20 * H) },
      { s: '23', lu: sec(12 * H) },
      { s: '21', lu: sec(2 * H) },
    ],
    'sensor.out': [
      { s: '50', lu: sec(20 * H) },
      { s: '90', lu: sec(4 * H) },
    ],
    'sensor.off': [{ s: 'unavailable', lu: sec(20 * H) }],
  })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out', 'sensor.off'],
    multiples: true,
    ...extra,
  } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel) as HTMLElement | null;
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const yLabels = (panel: Element) => [...panel.querySelectorAll('.y-axis .axis-label')].map((e) => e.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('small multiples on the line chart', () => {
  it('draws one titled chart per entity, on one value scale', async () => {
    const card = await mount({ period: { last: 24, unit: 'hour', navigate: true } });
    const panels = qa(card, '.panel');
    expect(panels).toHaveLength(3);
    expect(qa(card, '.series-header')).toHaveLength(0);
    expect(q(card, '.period-nav')).not.toBeNull();
    expect(qa(card, '.panel-title').map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Inside 21.0 °C',
      'Outside 9.0 °C',
      'sensor.off Unavailable',
    ]);
    expect(qa(card, '.panel-title')[1].dataset.index).toBe('1');
    expect(panels[0].querySelectorAll('path.line')).toHaveLength(1);
    expect(panels[0].querySelector('path.line')!.getAttribute('stroke')).toContain('--primary-color');
    expect(panels[1].querySelector('path.line')!.getAttribute('stroke')).toContain('--warning-color');
    expect(yLabels(panels[0])).toEqual(yLabels(panels[1]));
    expect(panels[2].querySelector('.chart-message')!.textContent).toBe('No readings in this period.');
    expect(q(card, '.multiples')!.getAttribute('style')).toMatch(/repeat\(2,/);
  });

  it('gives each chart its own scale when asked, and a set number of columns', async () => {
    const card = await mount({ multiples_scale: 'independent', multiples_columns: 1 });
    const [a, b] = qa(card, '.panel');
    expect(yLabels(a)).not.toEqual(yLabels(b));
    expect(q(card, '.multiples')!.getAttribute('style')).toMatch(/repeat\(1,/);
  });

  it('shows every chart its reading at the pointer, in its title', async () => {
    const card = await mount({});
    const area = q(card, '.panel .plot-area')!;
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 100, right: 1000, bottom: 100 }) as DOMRect;
    const ev = new MouseEvent('pointermove', { bubbles: true, clientX: 500 });
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
    area.dispatchEvent(ev);
    await card.updateComplete;
    expect(qa(card, '.crosshair')).toHaveLength(2);
    expect(qa(card, '.panel-title .series-value').map((e) => e.textContent)).toEqual(['23.0 °C', '50.0 °C', '—']);
  });

  it('keeps band gradients apart between charts, and can hide the titles', async () => {
    const card = await mount({
      color_by: 'bands',
      severity: [
        { from: 0, color: 'blue' },
        { from: 20, color: 'red' },
      ],
      show: { name: false, value: false },
    });
    const ids = qa(card, 'linearGradient').map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(qa(card, 'path.line')[1].getAttribute('stroke')).toBe('url(#cd-bands-1-1)');
    expect(qa(card, '.panel-title')).toHaveLength(0);
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

describe('small multiples in the editor', () => {
  it('shows scale and columns once switched on, and writes them', async () => {
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
    expect(JSON.stringify(form().schema)).not.toContain('multiples_scale');
    ed.setConfig({ ...raw, multiples: true });
    await ed.updateComplete;
    expect(JSON.stringify(form().schema)).toContain('multiples_scale');
    form().dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form().data as object), multiples_scale: 'independent', multiples_columns: 2 } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, multiples: true, multiples_scale: 'independent', multiples_columns: 2 });
  });
});

describe('small multiples scale', () => {
  it('shares one scale only when the units match, unless told', async () => {
    const { MULTIPLES_SCALES, multiplesOptions } = await import('../src/chart/multiples');
    expect(MULTIPLES_SCALES[0]).toBe('auto');
    expect(multiplesOptions({ type: 'x', multiples: true } as never).scale).toBe('auto');
  });
});
