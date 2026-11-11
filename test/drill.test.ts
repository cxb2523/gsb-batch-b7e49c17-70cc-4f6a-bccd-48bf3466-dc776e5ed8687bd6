import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { drillEnabled, drilledRoot, validateDrill } from '../src/chart/drill';
import { buildTree } from '../src/chart/hierarchy';
import { normalizeConfig } from '../src/config';
import { resolveEntities } from '../src/resolve';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

function hass(): HomeAssistant {
  return makeHass({
    'sensor.oven': ['1', { friendly_name: 'Oven', unit_of_measurement: 'kW' }],
    'sensor.hob': ['0.8', { friendly_name: 'Hob', unit_of_measurement: 'kW' }],
    'sensor.tv': ['0.5', { friendly_name: 'TV', unit_of_measurement: 'kW' }],
    'sensor.desk': ['0.4', { friendly_name: 'Desk', unit_of_measurement: 'kW' }],
    'sensor.ev': ['3', { friendly_name: 'EV', unit_of_measurement: 'kW' }],
  });
}

const ENTITIES = [
  { entity: 'sensor.oven', group: 'Ground / Kitchen' },
  { entity: 'sensor.hob', group: 'Ground / Kitchen' },
  { entity: 'sensor.tv', group: 'Ground / Lounge' },
  { entity: 'sensor.desk', group: 'First / Office' },
  { entity: 'sensor.ev', group: 'Outside' },
];

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', entities: ENTITIES, ...config } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector<HTMLElement>(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll<HTMLElement>(sel)];
const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

async function click(card: Card, sel: string) {
  q(card, sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  await card.updateComplete;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('drill path', () => {
  const tree = () => {
    const items = resolveEntities(normalizeConfig({ type: 'x', entities: ENTITIES } as CardConfig), hass());
    return buildTree(
      items,
      items.map((e) => String((e.config as { group?: string }).group).split(' / ')),
      'All',
    );
  };

  it('follows a path down, and stops at the deepest group that still exists', () => {
    const t = tree();
    expect(drilledRoot(t, []).node).toBe(t);
    const kitchen = drilledRoot(t, ['Ground', 'Kitchen']);
    expect(kitchen.node.name).toBe('Kitchen');
    expect(kitchen.path).toEqual(['Ground', 'Kitchen']);
    expect(drilledRoot(t, ['Ground', 'Attic'])).toMatchObject({ path: ['Ground'] });
    expect(drilledRoot(t, ['Nowhere', 'Kitchen'])).toMatchObject({ path: [] });
  });

  it('is on unless turned off, and checks the option', () => {
    expect(drillEnabled({ type: 'x' })).toBe(true);
    expect(drillEnabled({ type: 'x', drill_down: false })).toBe(false);
    expect(() => validateDrill({ type: 'x', drill_down: 'yes' } as unknown as CardConfig)).toThrow(/drill_down/);
    expect(() => validateDrill({ type: 'x', drill_down: true })).not.toThrow();
  });
});

describe('treemap drill-down', () => {
  it('shows a tapped group as the whole, keeps its colour, and goes back', async () => {
    const card = await mount({ style: 'treemap' });
    expect(q(card, '.drill-bar')).toBeNull();
    const ground = q(card, '.group[data-path="Ground"]')!;
    expect(ground.getAttribute('role')).toBe('button');
    expect(ground.getAttribute('aria-label')).toBe('Ground, 2.3 kW. Show what makes it up');
    // Ground is the second top-level group (EV is bigger), so its colour is the second one.
    expect(q(card, '.tile[data-index="0"]')!.style.background).toContain('--warning-color');
    await click(card, '.group[data-path="Ground"]');
    expect(qa(card, '.tile').map((t) => t.dataset.index)).toEqual(['0', '1', '2']);
    expect(q(card, '.tile[data-index="0"]')!.style.background).toContain('--warning-color');
    expect(qa(card, '.group-name').map((g) => g.textContent)).toEqual(['Kitchen', 'Lounge']);
    expect(text(q(card, '.drill-current'))).toBe('Ground 2.3 kW');
    expect(q(card, '.treemap-total')).toBeNull();
    const back = q(card, '.drill-back')!;
    expect(back.getAttribute('aria-label')).toBe('Back to All');
    await click(card, '.group[data-path="Ground/Kitchen"]');
    expect(qa(card, '.tile').map((t) => t.dataset.index)).toEqual(['0', '1']);
    expect(q(card, '.drill-back')!.getAttribute('aria-label')).toBe('Back to Ground');
    await click(card, '.drill-back');
    expect(text(q(card, '.drill-current'))).toBe('Ground 2.3 kW');
    await click(card, '.drill-back');
    expect(q(card, '.drill-bar')).toBeNull();
    expect(qa(card, '.tile')).toHaveLength(5);
  });

  it('drills with the keyboard, and keeps tile taps for the entity', async () => {
    const card = await mount({ style: 'treemap' });
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    q(card, '.group[data-path="First"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.drill-bar')).toBeNull();
    q(card, '.group[data-path="First"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await card.updateComplete;
    expect(text(q(card, '.drill-current'))).toBe('First 0.4 kW');
    const tile = q(card, '.tile[data-index="3"]')!;
    tile.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    tile.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.desk']);
    expect(text(q(card, '.drill-current'))).toBe('First 0.4 kW');
  });

  it('falls back to the top when the group it was in goes away', async () => {
    const card = await mount({ style: 'treemap' });
    await click(card, '.group[data-path="First"]');
    card.setConfig({ type: 'custom:chartdeck-card', style: 'treemap', entities: ENTITIES.slice(0, 3) } as CardConfig);
    await card.updateComplete;
    expect(q(card, '.drill-bar')).toBeNull();
    expect(qa(card, '.tile')).toHaveLength(3);
  });

  it('leaves groups plain when drilling is off', async () => {
    const card = await mount({ style: 'treemap', drill_down: false } as Partial<CardConfig>);
    const ground = q(card, '.group[data-path="Ground"]')!;
    expect(ground.getAttribute('role')).toBeNull();
    expect(ground.classList.contains('drillable')).toBe(false);
    await click(card, '.group[data-path="Ground"]');
    expect(q(card, '.drill-bar')).toBeNull();
  });
});

describe('sunburst and icicle drill-down', () => {
  it('drills into a ring segment or a legend item, keeping colours, and goes back', async () => {
    const card = await mount({ style: 'sunburst' });
    const before = q(card, 'path.leaf[data-index="0"]')!.getAttribute('fill');
    expect(q(card, 'path.group[data-path="Ground"]')!.getAttribute('aria-label')).toBe(
      'Ground, 2.3 kW. Show what makes it up',
    );
    await click(card, 'path.group[data-path="Ground"]');
    expect(qa(card, 'path.leaf').map((p) => p.dataset.index)).toEqual(['0', '1', '2']);
    expect(q(card, 'path.leaf[data-index="0"]')!.getAttribute('fill')).toBe(before);
    expect(text(q(card, '.centre-value'))).toBe('2.3 kW');
    expect(text(q(card, '.drill-current'))).toBe('Ground');
    expect(qa(card, '.hierarchy-legend .legend-item').map(text)).toEqual(['Kitchen 1.8 kW', 'Lounge 0.5 kW']);
    await click(card, '.hierarchy-legend .legend-item[data-path="Ground/Kitchen"]');
    expect(qa(card, 'path.leaf').map((p) => p.dataset.index)).toEqual(['0', '1']);
    await click(card, '.drill-back');
    await click(card, '.drill-back');
    expect(q(card, '.drill-bar')).toBeNull();
    expect(qa(card, 'path.leaf')).toHaveLength(5);
  });

  it('drills into an icicle cell, but not the total on the left', async () => {
    const card = await mount({ style: 'icicle' });
    expect(q(card, '.cell.text-root')!.getAttribute('role')).toBeNull();
    await click(card, '.cell.text-root');
    expect(q(card, '.drill-bar')).toBeNull();
    await click(card, '.cell.group[data-path="Ground"]');
    expect(text(q(card, '.cell.text-root'))).toBe('Ground 2.3 kW');
    expect(qa(card, '.cell.leaf').map((c) => c.dataset.index)).toEqual(['0', '1', '2']);
  });

  it('leaves arcs and cells plain when drilling is off', async () => {
    const card = await mount({ style: 'sunburst', drill_down: false } as Partial<CardConfig>);
    expect(q(card, 'path.group')!.getAttribute('role')).toBeNull();
    expect(q(card, '.hierarchy-legend .legend-item')!.getAttribute('role')).toBeNull();
    const icicle = await mount({ style: 'icicle', drill_down: false } as Partial<CardConfig>);
    expect(q(icicle, '.cell.group[data-path="Ground"]')!.getAttribute('role')).toBeNull();
  });

  it('checks the option', () => {
    const card = document.createElement('chartdeck-card') as Card;
    for (const style of ['treemap', 'sunburst', 'icicle']) {
      expect(() => card.setConfig({ type: 'x', style, drill_down: 'no' } as unknown as CardConfig)).toThrow(
        /drill_down/,
      );
    }
  });
});
