import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { buildTree } from '../src/chart/hierarchy';
import { normalizeConfig } from '../src/config';
import { resolveEntities } from '../src/resolve';
import { sharedUnit, treemapLayout } from '../src/styles/treemap';
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

function hass(): HomeAssistant {
  const h = makeHass({
    'sensor.ev': ['3.6', { friendly_name: 'EV charger', unit_of_measurement: 'kW' }],
    'sensor.oven': ['1.2', { friendly_name: 'Oven', unit_of_measurement: 'kW' }],
    'sensor.kettle': ['0.6', { friendly_name: 'Kettle', unit_of_measurement: 'kW' }],
    'sensor.tv': ['0.5', { friendly_name: 'TV', unit_of_measurement: 'kW' }],
    'sensor.idle': ['0', { friendly_name: 'Idle', unit_of_measurement: 'kW' }],
    'sensor.off': ['unavailable', { friendly_name: 'Fridge', unit_of_measurement: 'kW' }],
  });
  Object.assign(h, {
    entities: {
      'sensor.ev': { entity_id: 'sensor.ev', area_id: 'garage' },
      'sensor.oven': { entity_id: 'sensor.oven', area_id: 'kitchen' },
      'sensor.kettle': { entity_id: 'sensor.kettle', area_id: 'kitchen' },
    },
    areas: { garage: { area_id: 'garage', name: 'Garage' }, kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
  });
  return h;
}

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'treemap',
    entities: ['sensor.ev', 'sensor.oven', 'sensor.kettle', 'sensor.tv'],
    ...config,
  } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll<HTMLElement>(sel)];
const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('treemap layout', () => {
  const items = (entities: CardConfig['entities']) =>
    resolveEntities(normalizeConfig({ type: 'x', entities } as CardConfig), hass());

  it('sizes groups by their totals and gives groups with room a name strip', () => {
    const list = items(['sensor.ev', 'sensor.oven', 'sensor.kettle', 'sensor.idle']);
    const root = buildTree(list, [['Garage'], ['Kitchen'], ['Kitchen'], ['Kitchen']], '');
    const { groups, leaves } = treemapLayout(root, 400, 240);
    expect(groups.map((g) => [g.node.name, g.series, g.head])).toEqual([
      ['Garage', 0, true],
      ['Kitchen', 1, true],
    ]);
    // The idle entity has nothing to show, so it gets no tile.
    expect(leaves.map((l) => [l.node.name, l.series, l.rank])).toEqual([
      ['EV charger', 0, 0],
      ['Oven', 1, 0],
      ['Kettle', 1, 1],
    ]);
    const area = (r: { w: number; h: number }) => r.w * r.h;
    expect(area(groups[0].rect) / area(groups[1].rect)).toBeCloseTo(2, 0);
    // A leaf sits inside its group, below the name strip.
    expect(leaves[1].rect.y).toBeGreaterThan(groups[1].rect.y + 18);
  });

  it('lays flat entities straight into the box, one colour each', () => {
    const list = items(['sensor.ev', 'sensor.oven']);
    const { groups, leaves } = treemapLayout(buildTree(list, [[], []], ''), 300, 100);
    expect(groups).toEqual([]);
    expect(leaves.map((l) => l.series)).toEqual([0, 1]);
  });

  it('skips the name strip on a group too small for it', () => {
    const list = items(['sensor.ev', 'sensor.tv']);
    const { groups } = treemapLayout(buildTree(list, [['A'], ['B']], ''), 300, 30);
    expect(groups.every((g) => !g.head)).toBe(true);
  });

  it('finds the unit the items with a value share', () => {
    expect(sharedUnit(items(['sensor.ev', 'sensor.off']))).toBe('kW');
    expect(sharedUnit(items(['sensor.ev', { entity: 'sensor.tv', unit: 'W' }]))).toBeUndefined();
  });
});

describe('treemap chart', () => {
  it('draws one tile per entity with a value, a total, and opens more-info from a tile', async () => {
    const card = await mount({});
    const tiles = qa(card, '.treemap .tile.entity');
    expect(tiles.map((t) => t.dataset.index)).toEqual(['0', '1', '2', '3']);
    expect(tiles[0].style.background).toContain('--primary-color');
    expect(tiles[1].style.background).toContain('--warning-color');
    expect(tiles[0].getAttribute('aria-label')).toBe('EV charger, 3.6 kW');
    expect(text(q(card, '.treemap-total'))).toBe('5.9 kW in all');
    expect(q(card, '.treemap')!.getAttribute('role')).toBe('img');
    expect(q(card, '.treemap')!.getAttribute('aria-label')).toBe('Treemap of EV charger, Oven, Kettle, TV');
    expect(q(card, '.group')).toBeNull();
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    tiles[2].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    tiles[2].dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.kettle']);
  });

  it('groups by area from the registries, with an own group winning and the rest in Other', async () => {
    const card = await mount({
      group_by: 'area',
      entities: ['sensor.ev', 'sensor.oven', 'sensor.kettle', 'sensor.tv', { entity: 'sensor.idle', group: 'Den' }],
    } as Partial<CardConfig>);
    const names = qa(card, '.group-name').map((g) => g.textContent);
    expect(names).toEqual(['Garage', 'Kitchen', 'Other']);
    expect(qa(card, '.group-total').map((g) => g.textContent)).toContain('1.8 kW');
    // Kitchen's second tile is a fainter shade of the group's colour.
    const kettle = qa(card, '.tile').find((t) => t.dataset.index === '2')!;
    expect(kettle.style.background).toContain('color-mix');
  });

  it('nests two levels from an own group with a slash', async () => {
    const card = await mount({
      entities: [
        { entity: 'sensor.oven', group: 'Ground / Kitchen' },
        { entity: 'sensor.kettle', group: 'Ground / Kitchen' },
        { entity: 'sensor.ev', group: 'Outside' },
      ],
    } as Partial<CardConfig>);
    expect(qa(card, '.group-name').map((g) => g.textContent)).toEqual(['Outside', 'Ground', 'Kitchen']);
  });

  it('colours by band, and lists entities with no reading under the map', async () => {
    const card = await mount({
      color_by: 'bands',
      severity: [
        { from: 0, color: 'green' },
        { from: 1, color: 'red' },
      ],
      entities: ['sensor.ev', 'sensor.tv', 'sensor.off', 'sensor.gone'],
    } as Partial<CardConfig>);
    const tiles = qa(card, '.tile');
    expect(tiles[0].style.background).toContain('--error-color');
    expect(tiles[1].style.background).toContain('--success-color');
    const missing = qa(card, '.treemap-missing .entity');
    expect(missing.map((m) => [m.dataset.index, text(m)])).toEqual([
      ['2', 'Fridge (Unavailable)'],
      ['3', 'sensor.gone (Entity not found)'],
    ]);
  });

  it('says so when nothing has a value, and leaves out the total for mixed units', async () => {
    const empty = await mount({ entities: ['sensor.idle', 'sensor.off'] });
    expect(text(q(empty, '.treemap-message'))).toMatch(/Nothing to show/);
    const mixed = await mount({ entities: ['sensor.ev', { entity: 'sensor.tv', unit: 'W' }] } as Partial<CardConfig>);
    expect(q(mixed, '.treemap-total')).toBeNull();
    const quiet = await mount({ show: { value: false, name: false } } as Partial<CardConfig>);
    expect(q(quiet, '.treemap-total')).toBeNull();
    expect(q(quiet, '.tile-name')).toBeNull();
    expect(q(quiet, '.tile-value')).toBeNull();
  });

  it('lays out again for the measured width, and stops watching when it leaves', async () => {
    let callback: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const card = await mount({});
    const map = q(card, '.treemap') as HTMLElement;
    Object.defineProperty(map, 'clientWidth', { value: 800, configurable: true });
    const layout = () =>
      qa(card, '.tile')
        .map((t) => t.getAttribute('style'))
        .join('|');
    const before = layout();
    callback();
    await card.updateComplete;
    expect(layout()).not.toBe(before);
    card.remove();
    expect(disconnect).toHaveBeenCalled();
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'treemap', entities: ['sensor.ev'], ...extra } as CardConfig);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ group_by: 'room' })).toThrow(/group_by/);
    expect(set({ entities: [{ entity: 'sensor.ev', group: 4 }] })).toThrow(/group/);
  });
});

describe('treemap editor', () => {
  async function editor(raw: CardConfig) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = hass();
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }

  it('writes the colour and the group levels', async () => {
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'treemap',
      group_by: 'area',
      entities: ['sensor.ev'],
    } as CardConfig;
    const { ed, events } = await editor(raw);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form[data-section="chart"]') as Stub;
    expect(form.data).toEqual({ treemap_color_by: 'group', group_by: ['area'], drill_down: true });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { treemap_color_by: 'bands', group_by: ['area', 'floor'], drill_down: false } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, color_by: 'bands', group_by: ['area', 'floor'], drill_down: false });
  });

  it('sets and clears each listed entity’s own group', async () => {
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'treemap',
      entities: ['sensor.ev', { entity: 'sensor.oven', group: 'Kitchen' }],
    } as CardConfig;
    const { ed, events } = await editor(raw);
    const list = ed.shadowRoot!.querySelector('.entity-options[data-section="entity_groups"] ha-form') as Stub & {
      computeLabel(s: { name: string }): string;
    };
    expect(list.data).toEqual({ e0: undefined, e1: 'Kitchen' });
    expect(list.computeLabel({ name: 'e0' })).toBe('EV charger');
    list.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { e0: 'Garage', e1: '' } } }));
    expect(events.at(-1)!.entities).toEqual([{ entity: 'sensor.ev', group: 'Garage' }, 'sensor.oven']);
  });

  it('asks for an entity before offering groups', async () => {
    const { ed } = await editor({ type: 'custom:chartdeck-card', style: 'treemap' } as CardConfig);
    expect(ed.shadowRoot!.querySelector('.entity-options')!.textContent).toMatch(/Add an entity above first/);
  });
});
