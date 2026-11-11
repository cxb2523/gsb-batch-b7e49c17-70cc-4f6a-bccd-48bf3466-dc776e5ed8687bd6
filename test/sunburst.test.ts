import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { buildTree, partition } from '../src/chart/hierarchy';
import { normalizeConfig } from '../src/config';
import { resolveEntities } from '../src/resolve';
import { levelStrength, paintSpans, sharedUnit, sunburstGeometry } from '../src/styles/sunburst';
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
    'sensor.ev': ['1.6', { friendly_name: 'EV', unit_of_measurement: 'kW' }],
    'sensor.oven': ['1', { friendly_name: 'Oven', unit_of_measurement: 'kW' }],
    'sensor.hob': ['0.8', { friendly_name: 'Hob', unit_of_measurement: 'kW' }],
    'sensor.desk': ['0.4', { friendly_name: 'Desk', unit_of_measurement: 'kW' }],
    'sensor.idle': ['0', { friendly_name: 'Idle', unit_of_measurement: 'kW' }],
    'sensor.off': ['unavailable', { friendly_name: 'Fridge', unit_of_measurement: 'kW' }],
  });
  Object.assign(h, {
    entities: {
      'sensor.oven': { entity_id: 'sensor.oven', area_id: 'kitchen' },
      'sensor.hob': { entity_id: 'sensor.hob', area_id: 'kitchen' },
      'sensor.desk': { entity_id: 'sensor.desk', area_id: 'office' },
    },
    areas: {
      kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground' },
      office: { area_id: 'office', name: 'Office', floor_id: 'first' },
    },
    floors: { ground: { name: 'Ground' }, first: { name: 'First' } },
  });
  return h;
}

const ENTITIES = ['sensor.ev', 'sensor.oven', 'sensor.hob', 'sensor.desk'];

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'sunburst', entities: ENTITIES, ...config } as CardConfig);
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
});

describe('sunburst maths', () => {
  const items = (entities: CardConfig['entities']) =>
    resolveEntities(normalizeConfig({ type: 'x', entities } as CardConfig), hass());

  it('fades deeper levels, never below 45 %', () => {
    expect([1, 2, 3, 4, 9].map(levelStrength)).toEqual([100, 80, 60, 45, 45]);
  });

  it('gives each top-level node a series colour that its children fade from', () => {
    const list = items(['sensor.ev', 'sensor.oven', { entity: 'sensor.hob', color: 'red' }]);
    const root = buildTree(list, [['Out'], ['In'], []], 'All');
    const painted = paintSpans(partition(root), 'group');
    const byName = (name: string) => [...painted.entries()].find(([n]) => n.name === name)![1];
    expect(byName('Out').fill).toBe('var(--primary-color, #2f6fe4)');
    expect(byName('Out').text).toBe('light');
    expect(byName('In').fill).toContain('--warning-color');
    expect(byName('EV').fill).toMatch(/color-mix\(in srgb, var\(--primary-color, #2f6fe4\) 80%/);
    expect(byName('EV').text).toBe('theme');
    // An entity at the top level keeps its own colour.
    expect(byName('Hob').fill).toContain('--error-color');
  });

  it('colours entities by band and groups neutral when asked', () => {
    const list = items(['sensor.ev', 'sensor.oven']);
    const root = buildTree(list, [['G'], ['G']], 'All');
    const painted = paintSpans(partition(root), 'bands');
    const fills = [...painted.entries()].map(([n, p]) => [n.name, p.fill]);
    expect(fills).toEqual([
      ['G', 'var(--cd-track)'],
      ['EV', 'var(--primary-color, #2f6fe4)'],
      ['Oven', 'var(--primary-color, #2f6fe4)'],
    ]);
  });

  it('sweeps a full turn or the top half, with rings sharing the radius', () => {
    const full = sunburstGeometry('full', 2);
    const half = sunburstGeometry('half', 3);
    expect([full.start, full.sweep]).toEqual([0, Math.PI * 2]);
    expect([half.start, half.sweep]).toEqual([-Math.PI / 2, Math.PI]);
    expect(full.radii(1)).toEqual([40, 76]);
    expect(full.radii(2)).toEqual([76, 112]);
    expect(sunburstGeometry('full', 0).radii(1)).toEqual([40, 112]);
    expect(half.viewBox.split(' ').map(Number)[3]).toBeLessThan(Number(full.viewBox.split(' ')[3]));
  });

  it('finds the unit the items with a value share', () => {
    expect(sharedUnit(items(['sensor.ev', 'sensor.off']))).toBe('kW');
    expect(sharedUnit(items(['sensor.ev', { entity: 'sensor.oven', unit: 'W' }]))).toBeUndefined();
  });
});

describe('sunburst chart', () => {
  it('draws a ring per level, the total in the middle and a legend of the top level', async () => {
    const card = await mount({ group_by: ['floor', 'area'] } as Partial<CardConfig>);
    const groups = qa(card, 'path.arc.group').map((p) => p.dataset.path);
    expect(groups).toEqual(['Ground', 'Ground/Kitchen', 'Other', 'Other/Other', 'First', 'First/Office']);
    const leaves = qa(card, 'path.arc.leaf');
    expect(leaves.map((p) => p.dataset.index)).toEqual(['1', '2', '0', '3']);
    expect(leaves[0].getAttribute('aria-label')).toBe('Oven, 1.0 kW');
    expect(leaves.every((p) => p.classList.contains('entity'))).toBe(true);
    expect(text(q(card, '.centre-value'))).toBe('3.8 kW');
    expect(q(card, 'svg.sunburst')!.getAttribute('aria-label')).toBe('Sunburst of Ground, Other, First');
    expect(qa(card, '.hierarchy-legend .legend-item').map(text)).toEqual([
      'Ground 1.8 kW',
      'Other 1.6 kW',
      'First 0.4 kW',
    ]);
    expect(q(card, 'path.arc.group title')!.textContent).toBe('Ground, 1.8 kW');
  });

  it('opens more-info from an arc', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const arc = qa(card, 'path.arc.leaf').find((p) => p.dataset.index === '3')!;
    arc.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    arc.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.desk']);
  });

  it('draws a half circle, and flat entities straight round the middle with tappable legend items', async () => {
    const card = await mount({ shape: 'half' } as Partial<CardConfig>);
    expect(q(card, '.sunburst-wrap.half')).not.toBeNull();
    expect(qa(card, 'path.arc.group')).toHaveLength(0);
    const legend = qa(card, '.hierarchy-legend .entity');
    expect(legend.map((l) => l.dataset.index)).toEqual(['0', '1', '2', '3']);
  });

  it('lists entities with no reading and says so when nothing has a value', async () => {
    const card = await mount({ entities: ['sensor.ev', 'sensor.off', 'sensor.gone', 'sensor.idle'] });
    expect(qa(card, '.hierarchy-missing .entity').map(text)).toEqual([
      'Fridge (Unavailable)',
      'sensor.gone (Entity not found)',
    ]);
    const empty = await mount({ entities: ['sensor.idle'] });
    expect(text(q(empty, '.hierarchy-message'))).toMatch(/Nothing to show/);
    expect(q(empty, '.hierarchy-legend')).toBeNull();
  });

  it('leaves totals out for mixed units or when values are hidden', async () => {
    const mixed = await mount({ entities: ['sensor.ev', { entity: 'sensor.oven', unit: 'W' }] } as Partial<CardConfig>);
    expect(q(mixed, '.centre-value')).toBeNull();
    expect(qa(mixed, '.legend-value')).toHaveLength(0);
    const quiet = await mount({ show: { value: false } } as Partial<CardConfig>);
    expect(q(quiet, '.centre-value')).toBeNull();
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'sunburst', entities: ['sensor.ev'], ...extra } as CardConfig);
    expect(set({ shape: 'square' })).toThrow(/shape/);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ group_by: ['room'] })).toThrow(/group_by/);
    const icicle = () =>
      card.setConfig({ type: 'x', style: 'icicle', entities: ['sensor.ev'], shape: 'square' } as CardConfig);
    expect(icicle).not.toThrow();
  });
});

describe('icicle chart', () => {
  it('draws a column per level with the total on the left and labels where they fit', async () => {
    const card = await mount({
      style: 'icicle',
      group_by: 'area',
      entities: [...ENTITIES, 'sensor.off'],
    } as Partial<CardConfig>);
    const cells = qa(card, '.icicle .cell');
    expect(cells[0].classList.contains('text-root')).toBe(true);
    expect(text(cells[0])).toBe('Total 3.8 kW');
    expect(cells[0].style.left).toBe('0%');
    const groups = qa(card, '.icicle .cell.group').map((c) => c.dataset.path);
    expect(groups).toEqual(['', 'Kitchen', 'Other', 'Office']);
    const leaves = qa(card, '.icicle .cell.leaf');
    expect(leaves.map((c) => c.dataset.index)).toEqual(['1', '2', '0', '3']);
    expect(leaves[0].style.left).toBe(`${(2 / 3) * 100}%`);
    expect(leaves[0].getAttribute('aria-label')).toBe('Oven, 1.0 kW');
    expect(text(leaves[0])).toBe('Oven 1.0 kW');
    expect(q(card, '.icicle')!.getAttribute('aria-label')).toBe('Icicle chart of Kitchen, Other, Office');
    expect(text(q(card, '.hierarchy-missing'))).toBe('No reading: Fridge (Unavailable)');
  });

  it('colours by band and hides names when asked', async () => {
    const card = await mount({
      style: 'icicle',
      color_by: 'bands',
      show: { name: false },
      severity: [
        { from: 0, color: 'green' },
        { from: 1, color: 'red' },
      ],
    } as Partial<CardConfig>);
    const leaves = qa(card, '.icicle .cell.leaf .cell-fill');
    expect(leaves[0].style.background).toContain('--error-color');
    expect(leaves.at(-1)!.style.background).toContain('--success-color');
    expect(qa(card, '.icicle .cell.leaf .cell-name')).toHaveLength(0);
    // The total keeps its name: without it the left column says nothing.
    expect(qa(card, '.icicle .text-root .cell-name')).toHaveLength(1);
    const empty = await mount({ style: 'icicle', entities: ['sensor.idle'] } as Partial<CardConfig>);
    expect(q(empty, '.hierarchy-message')).not.toBeNull();
  });
});

describe('sunburst and icicle editors', () => {
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
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form[data-section="chart"]') as Stub;
    return { ed, events, form };
  }

  it('writes the shape, colour and group levels for a sunburst', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'sunburst', entities: ['sensor.ev'] } as CardConfig;
    const { events, form, ed } = await editor(raw);
    expect(form.data).toEqual({ sunburst_shape: 'full', hierarchy_color_by: 'group', group_by: [], drill_down: true });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: { sunburst_shape: 'half', hierarchy_color_by: 'bands', group_by: ['floor', 'area'], drill_down: true },
        },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, shape: 'half', color_by: 'bands', group_by: ['floor', 'area'] });
    expect(ed.shadowRoot!.querySelector('.entity-options[data-section="entity_groups"]')).not.toBeNull();
  });

  it('writes the colour and group levels for an icicle, without a shape', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'icicle', entities: ['sensor.ev'] } as CardConfig;
    const { events, form } = await editor(raw);
    expect(form.data).toEqual({ hierarchy_color_by: 'group', group_by: [], drill_down: true });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { hierarchy_color_by: 'group', group_by: ['label'], drill_down: false } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, group_by: ['label'], drill_down: false });
  });
});
