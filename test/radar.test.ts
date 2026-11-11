import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { deviceClassName, radarModel, radius } from '../src/styles/radar';
import { normalizeConfig } from '../src/config';
import { resolveEntities } from '../src/resolve';
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

function air(): HomeAssistant {
  const hass = makeHass({
    'sensor.lounge_temp': [
      '21',
      { friendly_name: 'Lounge temp', device_class: 'temperature', unit_of_measurement: '°C' },
    ],
    'sensor.lounge_co2': ['640', { friendly_name: 'Lounge CO2', device_class: 'carbon_dioxide' }],
    'sensor.lounge_hum': ['48', { friendly_name: 'Lounge humidity', device_class: 'humidity' }],
    'sensor.bed_temp': ['19', { friendly_name: 'Bedroom temp', device_class: 'temperature' }],
    'sensor.bed_co2': ['1120', { friendly_name: 'Bedroom CO2', device_class: 'carbon_dioxide' }],
    'sensor.bed_hum': ['unavailable', { friendly_name: 'Bedroom humidity', device_class: 'humidity' }],
  });
  Object.assign(hass, {
    entities: Object.fromEntries(
      ['lounge_temp', 'lounge_co2', 'lounge_hum', 'bed_temp', 'bed_co2', 'bed_hum'].map((id) => [
        `sensor.${id}`,
        { entity_id: `sensor.${id}`, area_id: id.startsWith('lounge') ? 'lounge' : 'bedroom' },
      ]),
    ),
    areas: { lounge: { area_id: 'lounge', name: 'Lounge' }, bedroom: { area_id: 'bedroom', name: 'Bedroom' } },
  });
  return hass;
}

const ALL = [
  'sensor.lounge_temp',
  'sensor.lounge_co2',
  'sensor.lounge_hum',
  'sensor.bed_temp',
  'sensor.bed_co2',
  'sensor.bed_hum',
];

async function mount(config: Partial<CardConfig>, hass = air()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'radar', entities: ALL.slice(0, 3), ...config } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

function items(config: Partial<CardConfig>, hass = air()) {
  return resolveEntities(normalizeConfig({ type: 'x', ...config } as CardConfig), hass);
}

describe('radar maths', () => {
  it('names device classes readably', () => {
    expect(deviceClassName('carbon_dioxide')).toBe('CO₂');
    expect(deviceClassName('pm25')).toBe('PM2.5');
    expect(deviceClassName('atmospheric_pressure')).toBe('Atmospheric pressure');
  });

  it('places a value between its limits, or as a share of the largest', () => {
    const [temp, co2, , , , gone] = items({ entities: ALL, max: 2000 });
    expect(radius(temp, 'limits', 1120)).toBeCloseTo(21 / 2000);
    expect(radius(co2, 'shared', 1120)).toBeCloseTo(640 / 1120);
    expect(radius(co2, 'shared', 0)).toBe(0);
    expect(radius(gone, 'limits', 1)).toBeNull();
  });

  it('makes one series of every entity without groups', () => {
    const hass = air();
    const model = radarModel(items({ entities: ALL.slice(0, 3) }, hass), { type: 'x' }, hass);
    expect(model.axes.map((a) => a.name)).toEqual(['Lounge temp', 'Lounge CO2', 'Lounge humidity']);
    expect(model.series).toHaveLength(1);
  });

  it('lines groups up on axes by axis name, device class, then name', () => {
    const hass = air();
    const list = items(
      { entities: [...ALL, { entity: 'sensor.lounge_temp', axis: 'Warmth', group: 'Spare' }, 'sensor.missing'] },
      hass,
    );
    const model = radarModel(list, { type: 'x', group_by: 'area' }, hass);
    expect(model.axes.map((a) => a.name)).toEqual(['Temperature', 'CO₂', 'Humidity', 'Warmth', 'sensor.missing']);
    expect(model.series.map((s) => s.name)).toEqual(['Lounge', 'Bedroom', 'Spare', 'Other']);
    expect(model.series[1].points.map((p) => p.axis)).toEqual([0, 1, 2]);
    expect(model.series[1].points[2].r).toBeNull();
    expect(model.series[1].color).toContain('--warning-color');
  });
});

describe('radar chart', () => {
  it('draws a filled shape with a marker per value, round labelled axes', async () => {
    const card = await mount({ max: 2000 });
    expect(qa(card, 'polygon.grid')).toHaveLength(4);
    expect(qa(card, 'line.spoke')).toHaveLength(3);
    const area = q(card, 'polygon.area')!;
    expect(area.classList.contains('filled')).toBe(true);
    expect(area.getAttribute('stroke')).toContain('--primary-color');
    expect(qa(card, '.marker.entity').map((m) => m.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(qa(card, '.axis-label').map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Lounge temp 21.0 °C',
      'Lounge CO2 640.0',
      'Lounge humidity 48.0',
    ]);
    expect(q(card, 'svg.radar-plot')!.getAttribute('aria-label')).toBe(
      'Radar chart of Lounge temp, Lounge CO2, Lounge humidity',
    );
    expect(q(card, '.radar-legend')).toBeNull();
  });

  it('draws outlines only when fill is off, and hides names when asked', async () => {
    const card = await mount({ fill: false, show: { name: false } });
    expect(q(card, 'polygon.area')!.classList.contains('filled')).toBe(false);
    expect(q(card, 'polygon.area')!.getAttribute('fill')).toBe('none');
    expect(q(card, '.axis-label')!.textContent!.trim()).toBe('21.0 °C');
  });

  it('draws one shape per area with a legend, skipping the missing value', async () => {
    const card = await mount({ entities: ALL, group_by: ['area'], scale: 'shared' });
    expect(qa(card, 'polygon.area')).toHaveLength(2);
    expect(qa(card, '.marker')).toHaveLength(5);
    expect(qa(card, '.radar-legend-item').map((e) => e.textContent!.trim())).toEqual(['Lounge', 'Bedroom']);
    expect(qa(card, '.axis-label').map((e) => e.textContent!.trim())).toEqual(['Temperature', 'CO₂', 'Humidity']);
  });

  it('keeps going with two axes, unavailable and missing entities', async () => {
    const card = await mount({ entities: ['sensor.bed_hum', 'sensor.missing'] });
    expect(qa(card, 'circle.grid')).toHaveLength(4);
    expect(q(card, 'polygon.area')).toBeNull();
    expect(qa(card, '.marker')).toHaveLength(0);
    expect(qa(card, '.axis-value.muted')).toHaveLength(2);
  });

  it('opens more-info from a marker', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const marker = qa(card, '.marker')[1] as HTMLElement;
    marker.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    marker.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.lounge_co2']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'radar', entities: ['sensor.a'], ...extra } as CardConfig);
    expect(set({ scale: 'log' })).toThrow(/"scale" must be one of: limits, shared/);
    expect(set({ fill: 'yes' })).toThrow(/fill/);
    expect(set({ group_by: 'room' })).toThrow(/group_by/);
    expect(set({ entities: [{ entity: 'sensor.a', axis: 3 }] })).toThrow(/axis/);
    expect(set({ scale: 'shared', fill: false, group_by: ['area'] })).not.toThrow();
  });
});

describe('radar editor', () => {
  it('writes scale, fill, grouping, and each entity’s group and axis', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = air();
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'radar',
      group_by: 'area',
      entities: ALL.slice(0, 2),
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const [form, groups, axes] = [...ed.shadowRoot!.querySelectorAll('.section-chart ha-form')] as Stub[];
    expect(form.data).toEqual({ radar_scale: 'limits', radar_fill: true, group_by: ['area'] });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), radar_scale: 'shared', radar_fill: false } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, group_by: ['area'], scale: 'shared', fill: false });
    expect(groups.data).toEqual({ e0: undefined, e1: undefined });
    expect((groups.computeLabel as (s: { name: string }) => string)({ name: 'e1' })).toBe('Lounge CO2');
    groups.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { e0: 'Spare', e1: '' } } }));
    expect(events.at(-1)!.entities).toEqual([{ entity: 'sensor.lounge_temp', group: 'Spare' }, 'sensor.lounge_co2']);
    axes.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { e1: 'Air' } } }));
    expect(events.at(-1)!.entities).toEqual(['sensor.lounge_temp', { entity: 'sensor.lounge_co2', axis: 'Air' }]);
  });

  it('says to add an entity first when there are none', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = air();
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'radar' } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('.entity-options')!.textContent).toContain('Add an entity above first.');
  });
});
