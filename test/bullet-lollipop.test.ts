import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { rangeFill, rangeSegments, targetText } from '../src/chart/marks';
import { STYLES } from '../src/styles/index';
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

function hass() {
  return makeHass({
    'sensor.elec': ['14.2', { friendly_name: 'Electricity', unit_of_measurement: 'kWh' }],
    'sensor.gas': ['22.5', { friendly_name: 'Gas', unit_of_measurement: 'kWh' }],
    'sensor.budget': ['20', { friendly_name: 'Budget' }],
    'sensor.grid': ['-500', { friendly_name: 'Grid', unit_of_measurement: 'W' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });
}

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel) as HTMLElement | null;
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bullet and lollipop maths', () => {
  const bands = [
    { from: -Infinity, color: 'red' },
    { from: 10, color: 'amber' },
    { from: 25, color: 'green' },
  ];

  it('cuts colour bands to the entity limits', () => {
    expect(rangeSegments({ bands, min: 0, max: 50 })).toEqual([
      { from: 0, to: 0.2, color: 'red', level: 0 },
      { from: 0.2, to: 0.5, color: 'amber', level: 1 },
      { from: 0.5, to: 1, color: 'green', level: 2 },
    ]);
    // Bands below min drop out and the first one left starts at the edge.
    expect(rangeSegments({ bands, min: 30, max: 50 })).toEqual([{ from: 0, to: 1, color: 'green', level: 0 }]);
    expect(rangeSegments({ bands: [{ from: -Infinity, color: 'primary' }], min: 0, max: 100 })).toHaveLength(1);
  });

  it('shades ranges darker band by band, or tints them with the band colour', () => {
    const segs = rangeSegments({ bands, min: 0, max: 50 });
    expect(rangeFill(segs[0], 3, 'shades')).toContain(' 6%');
    expect(rangeFill(segs[2], 3, 'shades')).toContain(' 18%');
    expect(rangeFill(segs[0], 1, 'shades')).toContain(' 8%');
    expect(rangeFill(segs[1], 3, 'colours')).toContain('var(--warning-color');
  });

  it('writes the target with the unit, or nothing without one', () => {
    const h = hass();
    expect(targetText({ target: 18, decimals: 1, unit: 'kWh' } as never, h)).toBe('target 18.0 kWh');
    expect(targetText({ target: null } as never, h)).toBeUndefined();
  });
});

describe('bullet chart', () => {
  it('draws one row per entity with ranges, bar, target and value', async () => {
    const card = await mount({
      style: 'bullet',
      max: 30,
      severity: [
        { from: 0, color: 'green' },
        { from: 15, color: 'amber' },
        { from: 22, color: 'red' },
      ],
      entities: [
        { entity: 'sensor.elec', target: 18 },
        { entity: 'sensor.gas', target: 'sensor.budget' },
        'sensor.off',
        'sensor.missing',
      ],
    });
    const rows = qa(card, '.bullet-row.entity');
    expect(rows.map((r) => r.dataset.index)).toEqual(['0', '1', '2', '3']);
    expect(q(card, '.bullets')!.getAttribute('aria-label')).toBe(
      'Bullet chart of Electricity, Gas, Off, sensor.missing',
    );
    expect(rows[0].querySelectorAll('.range')).toHaveLength(3);
    expect(rows[0].querySelector('.fill')).not.toBeNull();
    expect(rows[0].style.getPropertyValue('--end')).toBe(String(14.2 / 30));
    expect(rows[0].style.getPropertyValue('--target')).toBe('0.6');
    expect(rows[0].querySelector('.sub')!.textContent).toBe('target 18.0 kWh');
    expect(rows[1].querySelector('.sub')!.textContent).toBe('target 20.0 kWh');
    expect(rows[1].querySelector('.value')!.textContent).toBe('22.5 kWh');
    expect(rows[1].style.getPropertyValue('--c-start')).toContain('--error-color');
    // Unavailable and missing: the track, no bar or target, the status in place of the value.
    expect(rows[2].classList.contains('unavailable')).toBe(true);
    expect(rows[2].querySelector('.fill, .target')).toBeNull();
    expect(rows[2].querySelector('.value')!.textContent).toBe('Unavailable');
    expect(rows[3].querySelector('.value')!.textContent).toBe('Entity not found');
    expect(rows[0].getAttribute('role')).toBe('meter');
  });

  it('tints ranges with band colours, hides target and names when asked, and draws below zero', async () => {
    const card = await mount({
      style: 'bullet',
      ranges: 'colours',
      min: -1000,
      max: 1000,
      target: 0,
      show: { target: false, name: false, value: false },
      entities: ['sensor.grid'],
    });
    const row = q(card, '.entity')!;
    expect(q(card, '.bullets.no-name')).not.toBeNull();
    expect(row.querySelector('.range')!.getAttribute('style')).toContain('color-mix(in srgb, var(--primary-color');
    expect(row.querySelector('.target, .name, .value')).toBeNull();
    expect(row.style.getPropertyValue('--start')).toBe('0.25');
    expect(row.style.getPropertyValue('--end')).toBe('0.5');
  });

  it('opens more-info from a row', async () => {
    const card = await mount({ style: 'bullet', entities: ['sensor.elec', 'sensor.gas'] });
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const row = qa(card, '.entity')[1];
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.gas']);
  });
});

describe('lollipop chart', () => {
  it('stands one stem per entity, with value above and name below', async () => {
    const card = await mount({
      style: 'lollipop',
      target: 50,
      entities: ['sensor.elec', 'sensor.off', 'sensor.missing'],
    });
    expect(q(card, '.compare.vertical')).not.toBeNull();
    const items = qa(card, '.pop.entity');
    expect(items.map((r) => r.dataset.index)).toEqual(['0', '1', '2']);
    expect(items[0].querySelector('.stem')).not.toBeNull();
    expect(items[0].querySelector('.dot')).not.toBeNull();
    expect(items[0].querySelector('.target')).not.toBeNull();
    expect(items[0].querySelector('.tip')!.textContent).toBe('14.2 kWh');
    expect(items[0].querySelector('.name')!.textContent).toBe('Electricity');
    expect(items[0].style.getPropertyValue('--pos')).toBe('0.142');
    expect(items[1].querySelector('.stem, .dot, .target')).toBeNull();
    expect(items[1].querySelector('.value')!.textContent).toBe('Unavailable');
    expect(items[2].querySelector('.value')!.textContent).toBe('Entity not found');
    expect(q(card, '.compare')!.getAttribute('aria-label')).toBe('Lollipop chart of Electricity, Off, sensor.missing');
  });

  it('lies across with the value on the right, and leaves values out when hidden', async () => {
    const card = await mount({
      style: 'lollipop',
      orientation: 'horizontal',
      show: { value: false },
      entities: ['sensor.elec', 'sensor.off'],
    });
    expect(q(card, '.compare.horizontal')).not.toBeNull();
    const [on, off] = qa(card, '.pop.entity');
    expect(on.querySelector('.value')).toBeNull();
    expect(on.querySelector('.target')).toBeNull();
    // An unavailable entity still says so with values hidden.
    expect(off.querySelector('.value')!.textContent).toBe('Unavailable');
  });
});

describe('bullet and lollipop options', () => {
  it('checks them', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', entities: ['sensor.elec'], ...extra } as CardConfig);
    expect(set({ style: 'bullet', ranges: 'stripes' })).toThrow('"ranges" must be one of: shades, colours');
    expect(set({ style: 'lollipop', orientation: 'diagonal' })).toThrow(
      '"orientation" must be one of: vertical, horizontal',
    );
    expect(set({ style: 'bullet', ranges: 'colours' })).not.toThrow();
  });

  it('have thumbnails in the comparisons group', () => {
    for (const name of ['bullet', 'lollipop'] as const) {
      const style = STYLES[name];
      expect(style.group).toBe('compare');
      expect(style.layout).toBe('chart');
    }
  });

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
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const change = (value: Record<string, unknown>) =>
      form.dispatchEvent(
        new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), ...value } } }),
      );
    return { ed, form, events, change };
  }

  it('are set in the editor', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'bullet', entities: ['sensor.elec'] } as CardConfig;
    const b = await editor(raw);
    expect(b.form.data).toEqual({ ranges: 'shades' });
    const labels = (
      (b.form.schema as { selector: { select: { options: { label: string }[] } } }[])[0].selector.select.options as {
        label: string;
      }[]
    ).map((o) => o.label);
    expect(labels).toEqual(['Shades of grey', 'Colour band colours']);
    b.change({ ranges: 'colours' });
    expect(b.events.at(-1)).toEqual({ ...raw, ranges: 'colours' });
    document.body.innerHTML = '';

    const raw2 = { type: 'custom:chartdeck-card', style: 'lollipop', orientation: 'horizontal' } as CardConfig;
    const l = await editor(raw2);
    expect(l.form.data).toEqual({ orientation: 'horizontal' });
    l.change({ orientation: 'vertical' });
    // Back to the default removes the key.
    expect(l.events.at(-1)).toEqual({ type: 'custom:chartdeck-card', style: 'lollipop' });
  });
});
