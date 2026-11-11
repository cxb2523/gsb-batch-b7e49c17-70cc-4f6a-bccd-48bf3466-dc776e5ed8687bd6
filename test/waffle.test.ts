import { afterEach, describe, expect, it, vi } from 'vitest';
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
await import('../src/chartdeck-card');
await import('../src/editor/chartdeck-card-editor');
const { waffle, cellAt, waffleCounts } = await import('../src/styles/waffle');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const hass = () =>
  makeHass({
    'sensor.solar': ['13.3', { friendly_name: 'Solar', unit_of_measurement: 'kWh' }],
    'sensor.grid': ['7.5', { friendly_name: 'Grid', unit_of_measurement: 'kWh' }],
    'sensor.store': ['82', { friendly_name: 'Storage', unit_of_measurement: '%' }],
    'sensor.tank': ['450', { friendly_name: 'Tank', unit_of_measurement: 'L' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
    'sensor.neg': ['-4', { friendly_name: 'Export', unit_of_measurement: 'kWh' }],
  });

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'waffle',
    entities: ['sensor.solar', 'sensor.grid'],
    ...config,
  } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card.shadowRoot!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const filled = (g: Element) => g.querySelectorAll('rect.cell.filled').length;

describe('waffle maths', () => {
  it('fills from the bottom row up, left to right', () => {
    expect(cellAt(0)).toEqual({ col: 0, row: 9 });
    expect(cellAt(9)).toEqual({ col: 9, row: 9 });
    expect(cellAt(10)).toEqual({ col: 0, row: 8 });
    expect(cellAt(99)).toEqual({ col: 9, row: 0 });
  });
});

describe('waffle', () => {
  it('splits one waffle between the entities, squares adding up to 100', async () => {
    const root = await mount({});
    const groups = root.querySelectorAll('svg.waffle g.entity');
    expect([...groups].map((g) => g.getAttribute('data-index'))).toEqual(['0', '1']);
    expect(filled(groups[0])).toBe(64);
    expect(filled(groups[1])).toBe(36);
    expect(root.querySelectorAll('svg.waffle rect')).toHaveLength(100);
    expect(root.querySelector('svg.waffle')!.getAttribute('aria-label')).toBe('Waffle of Solar, Grid');
    expect([...root.querySelectorAll('.part-share')].map((s) => s.textContent)).toEqual(['64 %', '36 %']);
  });

  it('leads with the first share in large type, unless asked not to', async () => {
    const root = await mount({});
    expect(root.querySelector('.waffle-big')!.textContent).toBe('64 %');
    expect(root.querySelector('.waffle-caption')!.textContent).toBe('Solar');
    expect((await mount({ headline: false })).querySelector('.waffle-headline')).toBeNull();
  });

  it("fills a lone entity's waffle to its position between min and max", async () => {
    const root = await mount({ entities: ['sensor.store'] });
    expect(filled(root.querySelector('svg.waffle g.entity')!)).toBe(82);
    expect(root.querySelector('.waffle-big')!.textContent).toBe('82 %');
    // The headline says it already.
    expect(root.querySelector('.part-share')).toBeNull();
    const ranged = await mount({ entities: [{ entity: 'sensor.tank', max: 600 }] });
    expect(filled(ranged.querySelector('svg.waffle g.entity')!)).toBe(75);
  });

  it('counts with largest remainders and leaves out what has nothing to draw', () => {
    const e = (value: number | null, position = 0) =>
      ({ available: value !== null, value, position }) as unknown as Parameters<typeof waffleCounts>[0][0];
    expect(waffleCounts([e(1), e(1), e(1)])).toEqual([34, 33, 33]);
    expect(waffleCounts([e(5), e(-2), e(null)])).toEqual([100, 0, 0]);
    expect(waffleCounts([e(null)])).toEqual([0]);
    expect(waffleCounts([e(3, 0.456)])).toEqual([46]);
  });

  it('keeps unavailable, missing and negative entities in the legend only', async () => {
    const root = await mount({ entities: ['sensor.solar', 'sensor.off', 'sensor.gone', 'sensor.neg'] });
    expect(root.querySelectorAll('svg.waffle g.entity')).toHaveLength(1);
    const rows = root.querySelectorAll('.part-row');
    expect(rows).toHaveLength(4);
    expect(rows[1].classList.contains('unavailable')).toBe(true);
    expect(rows[2].textContent).toContain('Entity not found');
    expect(rows[3].querySelector('.part-share')).toBeNull();
  });

  it('draws an empty grid when nothing is available', async () => {
    const root = await mount({ entities: ['sensor.off'] });
    expect(root.querySelectorAll('rect.cell.filled')).toHaveLength(0);
    expect(root.querySelectorAll('rect.cell')).toHaveLength(100);
    expect(root.querySelector('.waffle-headline')).toBeNull();
  });

  it('draws one small waffle per entity side by side', async () => {
    const root = await mount({
      waffles: 'each',
      entities: ['sensor.store', { entity: 'sensor.tank', max: 600 }, 'sensor.off'],
    });
    const items = root.querySelectorAll('.entity.waffle-item');
    expect([...items].map((i) => i.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(items[0].getAttribute('tabindex')).toBe('0');
    expect(filled(items[0])).toBe(82);
    expect(items[0].querySelector('svg')!.getAttribute('aria-label')).toBe('Storage, 82 %');
    expect(items[0].querySelector('.waffle-value')!.textContent).toBe('82 %');
    // A 0-100 % sensor's value would repeat the percentage, so it isn't shown twice.
    expect(items[0].querySelector('.waffle-raw')).toBeNull();
    expect(items[1].querySelector('.waffle-raw')!.textContent).toBe('450.0 L');
    expect(items[2].classList.contains('unavailable')).toBe(true);
    expect(items[2].querySelector('.waffle-value')!.textContent).toBe('Unavailable');
  });

  it('shows the value instead of a percentage when asked', async () => {
    const root = await mount({ waffles: 'each', show_percent: false, entities: ['sensor.tank'] });
    expect(root.querySelector('.waffle-value')!.textContent).toBe('450.0 L');
    expect((await mount({ show_percent: false })).querySelector('.part-share')).toBeNull();
  });

  it('colours by series or by band', async () => {
    const fill = (root: ShadowRoot, i: number) =>
      root.querySelectorAll('svg.waffle g.entity')[i].querySelector('rect')!.getAttribute('style');
    const series = await mount({});
    expect(fill(series, 0)).toContain('--primary-color');
    expect(fill(series, 1)).toContain('--warning-color');
    const bands = await mount({ color_by: 'bands', severity: [{ from: 0, color: 'red' }] });
    expect(fill(bands, 1)).toContain('--error-color');
  });

  it('opens more-info when a group of squares or a waffle is tapped', async () => {
    const root = await mount({});
    const fired = vi.fn();
    root.addEventListener('hass-action', fired);
    const group = root.querySelector('svg.waffle g.entity[data-index="1"]')!;
    group.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    group.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect((fired.mock.calls[0][0] as CustomEvent).detail.config.entity).toBe('sensor.grid');
  });

  it('checks its options', () => {
    const v = (o: Record<string, unknown>) => () => waffle.validate!({ type: 'x', ...o } as CardConfig);
    expect(v({ waffles: 'each', color_by: 'bands', headline: false, show_percent: true })).not.toThrow();
    expect(v({ waffles: 'many' })).toThrow('"waffles" must be one of: one, each');
    expect(v({ color_by: 'shades' })).toThrow('"color_by" must be one of: series, bands');
    expect(v({ headline: 'no' })).toThrow(/headline/);
  });

  it('has a thumbnail', () => {
    expect(waffle.thumbnail().values.length).toBeGreaterThan(0);
  });
});

describe('waffle editor', () => {
  it('shows its options in the Chart section and writes them back', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'waffle', entities: ['sensor.a'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(
      ed.shadowRoot!.querySelector('.style[data-style="waffle"]')!.closest('.styles')!.getAttribute('data-group'),
    ).toBe('totals');
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as HTMLElement & {
      schema: { name: string; schema?: { name: string }[] }[];
      data: Record<string, unknown>;
    };
    const names = form.schema.flatMap((f) => (f.schema ? f.schema.map((s) => s.name) : [f.name]));
    expect(names).toEqual(['waffles', 'color_by', 'headline', 'show_percent']);
    expect(form.data).toEqual({ waffles: 'one', color_by: 'series', headline: true, show_percent: true });
    const changed = vi.fn();
    ed.addEventListener('config-changed', changed);
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, waffles: 'each' } } }));
    expect((changed.mock.calls[0][0] as CustomEvent).detail.config.waffles).toBe('each');
  });
});
