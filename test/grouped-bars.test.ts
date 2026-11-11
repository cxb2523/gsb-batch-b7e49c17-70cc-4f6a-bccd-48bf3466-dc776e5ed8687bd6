import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import type { CardConfig, HomeAssistant } from '../src/types';
import { layoutBars, rowHeight } from '../src/styles/grouped-bars';
import type { BarInput } from '../src/styles/grouped-bars';
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

const input = (index: number, group: string, series: string, value: number | null): BarInput => ({
  index,
  group,
  series,
  value,
});

describe('bar layout', () => {
  it('groups entities into rows, side by side, from zero', () => {
    const layout = layoutBars(
      [input(0, 'K', 'Today', 4), input(1, 'K', 'Yesterday', 3), input(2, 'L', 'Today', -2)],
      'grouped',
    );
    expect(layout.rows.map((r) => r.key)).toEqual(['K', 'L']);
    expect(layout.series).toEqual(['Today', 'Yesterday']);
    expect(layout.rows[0].segments.map((s) => [s.from, s.to, s.slot])).toEqual([
      [0, 4, 0],
      [0, 3, 1],
    ]);
    expect(layout.rows[0].total).toBe(7);
    expect(layout.domain).toEqual([-2, 4]);
  });

  it('stacks positives right and negatives left of zero', () => {
    const layout = layoutBars(
      [input(0, 'A', 'x', 3), input(1, 'A', 'y', -1), input(2, 'A', 'z', 2), input(3, 'A', 'w', -4)],
      'stacked',
    );
    expect(layout.rows[0].segments.map((s) => [s.from, s.to])).toEqual([
      [0, 3],
      [0, -1],
      [3, 5],
      [-1, -5],
    ]);
    expect(layout.domain).toEqual([-5, 5]);
    expect(layout.rows[0].total).toBe(0);
  });

  it('stacks to 100 % of the absolute total', () => {
    const layout = layoutBars([input(0, 'A', 'x', 3), input(1, 'A', 'y', 1), input(2, 'B', 'x', 0)], 'percent');
    expect(layout.rows[0].segments.map((s) => [s.from, s.to])).toEqual([
      [0, 0.75],
      [0.75, 1],
    ]);
    expect(layout.rows[1].segments[0].to).toBe(0);
    expect(layout.domain).toEqual([0, 1]);
    const mixed = layoutBars([input(0, 'A', 'x', 3), input(1, 'A', 'y', -1)], 'percent');
    expect(mixed.domain).toEqual([-0.25, 0.75]);
  });

  it('leaves a missing value out, and sorts rows by total with empty rows last', () => {
    const inputs = [input(0, 'A', '', 1), input(1, 'B', '', null), input(2, 'C', '', 5), input(3, 'A', '', 1)];
    expect(layoutBars(inputs, 'stacked', 'descending').rows.map((r) => r.key)).toEqual(['C', 'A', 'B']);
    expect(layoutBars(inputs, 'stacked', 'ascending').rows.map((r) => r.key)).toEqual(['A', 'C', 'B']);
    const layout = layoutBars(inputs, 'grouped');
    expect(layout.rows[1].total).toBeNull();
    expect(layout.rows[1].segments[0].to).toBe(0);
    expect(layoutBars([input(0, 'A', '', null)], 'grouped').domain).toEqual([0, 1]);
  });

  it('sizes grouped rows by their bars', () => {
    const layout = layoutBars([input(0, 'A', 'x', 1), input(1, 'A', 'y', 1), input(2, 'B', 'x', 1)], 'grouped');
    expect(rowHeight(layout.rows[0], 'grouped')).toBeGreaterThan(rowHeight(layout.rows[1], 'grouped'));
    expect(rowHeight(layout.rows[0], 'stacked')).toBe(rowHeight(layout.rows[1], 'stacked'));
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

function hass(values: Record<string, string> = {}) {
  return makeHass({
    'sensor.k_today': [values.k_today ?? '4', { friendly_name: 'Kitchen today', unit_of_measurement: 'kWh' }],
    'sensor.k_yday': ['3', { friendly_name: 'Kitchen yesterday', unit_of_measurement: 'kWh' }],
    'sensor.l_today': [values.l_today ?? '2', { friendly_name: 'Lounge today', unit_of_measurement: 'kWh' }],
    'sensor.l_yday': ['unavailable', { friendly_name: 'Lounge yesterday', unit_of_measurement: 'kWh' }],
    'sensor.grid': ['-500', { friendly_name: 'Grid', unit_of_measurement: 'W' }],
  });
}

const ENTITIES = [
  { entity: 'sensor.k_today', group: 'Kitchen', series: 'Today' },
  { entity: 'sensor.k_yday', group: 'Kitchen', series: 'Yesterday' },
  { entity: 'sensor.l_today', group: 'Lounge', series: 'Today' },
  { entity: 'sensor.l_yday', group: 'Lounge', series: 'Yesterday', color: 'red' },
  { entity: 'sensor.missing', group: 'Hall', series: 'Today' },
];

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'grouped_bars',
    decimals: 0,
    entities: ENTITIES,
    ...config,
  } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const rowNames = (card: Card) => qa(card, '.row-name').map((e) => e.textContent!.trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('grouped bars', () => {
  it('draws a row per group with one tappable bar per entity, values and a series legend', async () => {
    const card = await mount({});
    expect(rowNames(card)).toEqual(['Kitchen', 'Lounge', 'Hall']);
    const bars = qa(card, '.bar-seg.entity');
    expect(bars.map((b) => b.dataset.index)).toEqual(['0', '1', '2', '3', '4']);
    expect(bars[0].getAttribute('style')).toContain('--primary-color');
    expect(bars[1].getAttribute('style')).toContain('--warning-color');
    expect(bars[3].getAttribute('style')).toContain('--error-color');
    expect(bars[3].classList.contains('unavailable')).toBe(true);
    expect(bars[0].getAttribute('aria-label')).toBe('Kitchen today, 4 kWh');
    const values = qa(card, '.bar-value').map((e) => e.textContent!.trim());
    expect(values).toEqual(['4 kWh', '3 kWh', '2 kWh', 'Unavailable', 'Entity not found']);
    expect(qa(card, '.bar-legend-item').map((e) => e.textContent!.trim())).toEqual(['Today', 'Yesterday']);
    expect(q(card, '.bars')!.getAttribute('role')).toBe('img');
    expect(q(card, '.bars')!.getAttribute('aria-label')).toMatch(/^Bar chart of Kitchen today/);
  });

  it('stacks, totals each row, and re-orders rows by total, keeping each row element', async () => {
    const card = await mount({ mode: 'stacked', sort: 'descending' });
    expect(rowNames(card)).toEqual(['Kitchen', 'Lounge', 'Hall']);
    expect(qa(card, '.bar-value.total').map((e) => e.textContent!.trim())).toEqual([
      '7 kWh',
      '2 kWh',
      'Entity not found',
    ]);
    const kitchen = qa(card, '.bar-row')[0];
    const before = kitchen.style.transform;
    card.hass = hass({ k_today: '0', l_today: '9' });
    await card.updateComplete;
    expect(rowNames(card)).toEqual(['Lounge', 'Kitchen', 'Hall']);
    // The same element moved down rather than another row being redrawn into it.
    expect(qa(card, '.bar-row').indexOf(kitchen)).toBe(1);
    expect(kitchen.style.transform).not.toBe(before);
  });

  it('labels shares in percent mode', async () => {
    const card = await mount({ mode: 'percent' });
    const labels = qa(card, '.seg-text').map((e) => e.textContent!.trim());
    expect(labels).toEqual(['57 %', '43 %', '100 %']);
    expect(qa(card, '.bar-value')).toHaveLength(0);
  });

  it('draws negatives left of zero, and rows without a group under the entity name', async () => {
    const card = await mount({ entities: ['sensor.grid', 'sensor.k_today'], show: { legend: true } });
    expect(rowNames(card)).toEqual(['Grid', 'Kitchen today']);
    const [grid, kitchen] = qa(card, '.bar-seg');
    expect(grid.classList.contains('negative')).toBe(true);
    expect(kitchen.classList.contains('negative')).toBe(false);
    expect(q(card, '.bar-legend')).toBeNull();
  });

  it('colours by band, hides names, values and legend when asked', async () => {
    const card = await mount({
      color_by: 'bands',
      show: { name: false, value: false },
      severity: [
        { from: 0, color: 'green' },
        { from: 3.5, color: 'red' },
      ],
    } as Partial<CardConfig>);
    const bars = qa(card, '.bar-seg');
    expect(bars[0].getAttribute('style')).toContain('--error-color');
    expect(bars[1].getAttribute('style')).toContain('--success-color');
    expect(qa(card, '.row-name')).toHaveLength(0);
    expect(qa(card, '.bar-value')).toHaveLength(0);
    expect(q(card, '.bar-legend')).toBeNull();
    const off = await mount({ show: { legend: false } });
    expect(q(off, '.bar-legend')).toBeNull();
  });

  it('runs an entity action from a bar', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const bar = qa(card, '.bar-seg')[2];
    bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    bar.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.l_today']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'grouped_bars', entities: ['sensor.a'], ...extra } as CardConfig);
    expect(set({ mode: 'sideways' })).toThrow(/"mode" must be one of: grouped, stacked, percent/);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ entities: [{ entity: 'sensor.a', group: ['x'] }] })).toThrow(/Entity 1: "group" must be text/);
    expect(set({ entities: ['sensor.a', { entity: 'sensor.b', series: 2 }] })).not.toThrow();
  });
});

describe('grouped bars editor', () => {
  async function editor(raw: CardConfig) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }

  it('writes mode and colour from the Chart section', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'grouped_bars', entities: ['sensor.a'] } as CardConfig;
    const { ed, events } = await editor(raw);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({ mode: 'grouped', bars_color_by: 'series' });
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { mode: 'percent', bars_color_by: 'bands' } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, mode: 'percent', color_by: 'bands' });
  });

  it("shows row, series and colour in each entity's options, only for this style", async () => {
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'grouped_bars',
      entities: [{ entity: 'sensor.a', group: 'Kitchen' }],
    } as CardConfig;
    const { ed, events } = await editor(raw);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as HTMLElement & {
      updateComplete: Promise<boolean>;
      chartFields?: unknown;
    };
    expect(list.chartFields).toBeDefined();
    (list.shadowRoot!.querySelector('.expand') as HTMLElement).click();
    await list.updateComplete;
    const form = list.shadowRoot!.querySelector('ha-form[data-section="entity-chart"]') as Stub;
    expect(form.data).toEqual({ bar_group: 'Kitchen' });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { bar_group: 'Kitchen', bar_series: 'Today', bar_color: 'green' } },
      }),
    );
    expect(events.at(-1)!.entities).toEqual([
      { entity: 'sensor.a', group: 'Kitchen', series: 'Today', color: 'green' },
    ]);

    document.body.innerHTML = '';
    const bar = await editor({ type: 'custom:chartdeck-card', style: 'bar', entities: ['sensor.a'] } as CardConfig);
    const plain = bar.ed.shadowRoot!.querySelector('cd-entities-editor') as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    (plain.shadowRoot!.querySelector('.expand') as HTMLElement).click();
    await plain.updateComplete;
    expect(plain.shadowRoot!.querySelector('ha-form[data-section="entity-chart"]')).toBeNull();
    expect(plain.shadowRoot!.querySelector('ha-form[data-section="entity-text"]')).not.toBeNull();
  });
});
