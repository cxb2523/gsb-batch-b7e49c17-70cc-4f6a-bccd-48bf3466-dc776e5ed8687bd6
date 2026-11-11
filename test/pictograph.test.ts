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
const { pictograph, iconScale, iconFills, groups, MAX_ICONS } = await import('../src/styles/pictograph');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const hass = () =>
  makeHass({
    'sensor.chores': ['7', { friendly_name: 'Chores' }],
    'sensor.water': ['5.5', { friendly_name: 'Water' }],
    'sensor.battery': ['64', { friendly_name: 'Battery', unit_of_measurement: '%' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'pictograph',
    entities: [
      { entity: 'sensor.chores', max: 10, icon: 'mdi:check-circle', decimals: 0 },
      { entity: 'sensor.water', max: 8, decimals: 1 },
    ],
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

const fillsOf = (row: Element) =>
  [...row.querySelectorAll('.unit')].map((u) => (u as HTMLElement).style.getPropertyValue('--fill'));

describe('icon maths', () => {
  it('gives one icon per unit for small ranges, else ten, else what is asked', () => {
    expect(iconScale(0, 10)).toEqual({ count: 10, per: 1 });
    expect(iconScale(0, 5.5)).toEqual({ count: 6, per: 1 });
    expect(iconScale(0, 100)).toEqual({ count: 10, per: 10 });
    expect(iconScale(0, 100, 25)).toEqual({ count: 4, per: 25 });
    expect(iconScale(0, 10, 0)).toEqual({ count: 10, per: 1 });
    expect(iconScale(5, 5)).toEqual({ count: 0, per: 1 });
  });

  it('stretches the scale rather than draw more than the most icons', () => {
    expect(iconScale(0, 1000, 1)).toEqual({ count: MAX_ICONS, per: 10 });
  });

  it('fills icons up to the value, part-filling the last one', () => {
    const scale = { count: 4, per: 1 };
    expect(iconFills(2.5, 0, scale, true)).toEqual([1, 1, 0.5, 0]);
    expect(iconFills(2.5, 0, scale, false)).toEqual([1, 1, 0, 0]);
    expect(iconFills(9, 0, scale, true)).toEqual([1, 1, 1, 1]);
    expect(iconFills(-3, 0, scale, true)).toEqual([0, 0, 0, 0]);
    expect(iconFills(15, 10, { count: 2, per: 5 }, true)).toEqual([1, 0]);
  });

  it('splits icons into clusters', () => {
    expect(groups(12, 5)).toEqual([
      [0, 5],
      [5, 10],
      [10, 12],
    ]);
    expect(groups(4, 0)).toEqual([[0, 4]]);
    expect(groups(0, 5)).toEqual([]);
  });
});

describe('pictograph', () => {
  it('draws a tappable row of icons per entity, filled up to its value', async () => {
    const root = await mount({});
    const rows = root.querySelectorAll('.entity.picto-row');
    expect([...rows].map((r) => r.getAttribute('data-index'))).toEqual(['0', '1']);
    expect(rows[0].getAttribute('tabindex')).toBe('0');
    expect(rows[0].getAttribute('aria-label')).toBe('Chores, 7');
    expect(fillsOf(rows[0])).toEqual([...Array(7).fill('100.0%'), '0.0%', '0.0%', '0.0%']);
    expect(rows[0].querySelector('.picto-value')!.textContent).toMatch(/^\s*7\s*\/ 10\s*$/);
    expect(root.querySelector('.pictograph')!.getAttribute('aria-label')).toBe('Pictograph of Chores, Water');
    expect(rows[1].querySelector('.picto-icons[role="img"]')!.getAttribute('aria-label')).toBe('Water, 5.5');
  });

  it('part-fills an icon for a fraction, unless asked not to', async () => {
    const root = await mount({});
    expect(fillsOf(root.querySelectorAll('.picto-row')[1])[5]).toBe('50.0%');
    const whole = await mount({ partial: false });
    expect(fillsOf(whole.querySelectorAll('.picto-row')[1])[5]).toBe('0.0%');
  });

  it('clusters icons in fives by default, or as asked', async () => {
    const root = await mount({});
    const first = root.querySelector('.picto-row')!;
    expect([...first.querySelectorAll('.picto-group')].map((g) => g.querySelectorAll('.unit').length)).toEqual([5, 5]);
    const threes = await mount({ group_size: 3 });
    expect(threes.querySelector('.picto-row')!.querySelectorAll('.picto-group')).toHaveLength(4);
    const none = await mount({ group_size: 0 });
    expect(none.querySelector('.picto-row')!.querySelectorAll('.picto-group')).toHaveLength(1);
  });

  it("uses the entity's icon, else the chosen icon", async () => {
    const root = await mount({ unit_icon: 'mdi:water' });
    const icon = (row: number) =>
      (
        root.querySelectorAll('.picto-row')[row].querySelector('.unit-full ha-state-icon') as HTMLElement & {
          icon?: string;
        }
      ).icon;
    expect(icon(0)).toBe('mdi:check-circle');
    expect(icon(1)).toBe('mdi:water');
  });

  it('honours what each icon stands for', async () => {
    const root = await mount({ entities: ['sensor.battery'], per_icon: 20 });
    const row = root.querySelector('.picto-row')!;
    expect(row.querySelectorAll('.unit')).toHaveLength(5);
    expect(fillsOf(row).slice(2, 4)).toEqual(['100.0%', '20.0%']);
    expect(row.querySelector('.picto-value')!.textContent).toMatch(/^\s*64\s*\/ 100 %\s*$/);
  });

  it('colours by series or by band', async () => {
    const series = await mount({});
    const color = (root: ShadowRoot, row: number) =>
      (root.querySelectorAll('.picto-row')[row].querySelector('.unit-full') as HTMLElement).getAttribute('style');
    expect(color(series, 0)).toContain('--primary-color');
    expect(color(series, 1)).toContain('--warning-color');
    const bands = await mount({ color_by: 'bands', severity: [{ from: 0, color: 'red' }] });
    expect(color(bands, 1)).toContain('--error-color');
  });

  it('draws empty icons for unavailable and missing entities', async () => {
    const root = await mount({ entities: ['sensor.off', 'sensor.gone'] });
    const rows = root.querySelectorAll('.picto-row');
    expect(rows[0].classList.contains('unavailable')).toBe(true);
    expect(fillsOf(rows[0]).every((f) => f === '0.0%')).toBe(true);
    expect(rows[1].textContent).toContain('Entity not found');
    expect((rows[1].querySelector('.unit-full ha-state-icon') as HTMLElement & { icon?: string }).icon).toBe(
      'mdi:checkbox-blank-circle',
    );
  });

  it('hides the name and value when the card does', async () => {
    const root = await mount({ show: { name: false, value: false } });
    expect(root.querySelector('.picto-name')).toBeNull();
    expect(root.querySelector('.picto-value')).toBeNull();
  });

  it('opens more-info when a row is tapped', async () => {
    const root = await mount({});
    const fired = vi.fn();
    root.addEventListener('hass-action', fired);
    const row = root.querySelector('.picto-row[data-index="1"]')!;
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect((fired.mock.calls[0][0] as CustomEvent).detail.config.entity).toBe('sensor.water');
  });

  it('checks its options', () => {
    const v = (o: Record<string, unknown>) => () => pictograph.validate!({ type: 'x', ...o } as CardConfig);
    expect(v({ per_icon: 0.5, group_size: 4, partial: false, unit_icon: 'mdi:x', color_by: 'bands' })).not.toThrow();
    expect(v({ per_icon: 0 })).toThrow('"per_icon" must be a number more than 0');
    expect(v({ per_icon: 'two' })).toThrow(/per_icon/);
    expect(v({ group_size: 60 })).toThrow('"group_size" must be a number from 0 to 50');
    expect(v({ group_size: 2.5 })).toThrow('"group_size" must be a whole number');
    expect(v({ color_by: 'shades' })).toThrow('"color_by" must be one of: series, bands');
    expect(v({ partial: 'yes' })).toThrow(/partial/);
    expect(v({ unit_icon: 5 })).toThrow(/unit_icon/);
  });

  it('has a thumbnail', () => {
    expect(pictograph.thumbnail().values.length).toBeGreaterThan(0);
  });
});

describe('pictograph editor', () => {
  it('shows its options in the Chart section and writes them back', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'pictograph', entities: ['sensor.a'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(
      ed.shadowRoot!.querySelector('.style[data-style="pictograph"]')!.closest('.styles')!.getAttribute('data-group'),
    ).toBe('totals');
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as HTMLElement & {
      schema: { name: string; schema?: { name: string }[] }[];
      data: Record<string, unknown>;
    };
    const names = form.schema.flatMap((f) => (f.schema ? f.schema.map((s) => s.name) : [f.name]));
    expect(names).toEqual(['unit_icon', 'per_icon', 'group_size', 'color_by', 'partial']);
    expect(form.data).toEqual({ group_size: 5, color_by: 'series', partial: true });
    const changed = vi.fn();
    ed.addEventListener('config-changed', changed);
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...form.data, unit_icon: 'mdi:account' } } }),
    );
    expect((changed.mock.calls[0][0] as CustomEvent).detail.config.unit_icon).toBe('mdi:account');
  });
});
