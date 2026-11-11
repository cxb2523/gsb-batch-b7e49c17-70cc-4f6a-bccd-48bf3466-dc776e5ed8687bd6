import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config';
import { matchEntities, normalizeRule } from '../src/fill';
import { resolveEntities, sortEntities } from '../src/resolve';
import type { HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

function house(): HomeAssistant {
  const hass = makeHass({
    'sensor.kitchen_temp': ['21.5', { device_class: 'temperature', friendly_name: 'Kitchen temperature' }],
    'sensor.lounge_temp': ['19', { device_class: 'temperature', friendly_name: 'Lounge temperature' }],
    'sensor.loft_temp': ['12', { device_class: 'temperature', friendly_name: 'Loft temperature' }],
    'sensor.phone_battery': ['80', { device_class: 'battery', friendly_name: 'Phone battery' }],
    'sensor.door_battery': ['15', { device_class: 'battery', friendly_name: 'Door battery' }],
    'sensor.remote_battery': ['unavailable', { device_class: 'battery', friendly_name: 'Remote battery' }],
    'sensor.hidden_battery': ['50', { device_class: 'battery', friendly_name: 'Hidden battery' }],
    'sensor.kitchen_mode': ['eco', { friendly_name: 'Kitchen mode' }],
    'light.kitchen': ['on', { friendly_name: 'Kitchen light' }],
    'input_number.kitchen_target': ['20', { friendly_name: 'Kitchen target' }],
  });
  hass.entities = {
    'sensor.kitchen_temp': { entity_id: 'sensor.kitchen_temp', area_id: 'kitchen', labels: [] },
    'sensor.lounge_temp': { entity_id: 'sensor.lounge_temp', device_id: 'dev_lounge', labels: ['climate'] },
    'sensor.loft_temp': { entity_id: 'sensor.loft_temp', area_id: 'loft', labels: [] },
    'sensor.door_battery': { entity_id: 'sensor.door_battery', device_id: 'dev_door', labels: [] },
    'sensor.hidden_battery': { entity_id: 'sensor.hidden_battery', hidden: true, labels: [] },
    'sensor.kitchen_mode': { entity_id: 'sensor.kitchen_mode', area_id: 'kitchen', labels: [] },
    'light.kitchen': { entity_id: 'light.kitchen', area_id: 'kitchen', labels: [] },
    'input_number.kitchen_target': { entity_id: 'input_number.kitchen_target', area_id: 'kitchen', labels: [] },
  };
  hass.devices = {
    dev_lounge: { id: 'dev_lounge', area_id: 'lounge', labels: [] },
    dev_door: { id: 'dev_door', area_id: 'hall', labels: ['outdoor'] },
  };
  hass.areas = {
    kitchen: { area_id: 'kitchen', floor_id: 'ground' },
    lounge: { area_id: 'lounge', floor_id: 'ground' },
    hall: { area_id: 'hall', floor_id: 'ground' },
    loft: { area_id: 'loft', floor_id: 'top' },
  };
  return hass;
}

const match = (include: unknown, exclude?: unknown, hass = house()) =>
  matchEntities(normalizeRule(include, 'include')!, normalizeRule(exclude, 'exclude'), hass);

describe('normalizeRule', () => {
  it('takes one value or a list, and drops empty keys', () => {
    expect(normalizeRule({ area: 'kitchen', domain: ['sensor'], label: [] }, 'include')).toEqual({
      area: ['kitchen'],
      domain: ['sensor'],
    });
    expect(normalizeRule({ area: [] }, 'include')).toBeUndefined();
    expect(normalizeRule(undefined, 'include')).toBeUndefined();
  });

  it('rejects unknown keys, entity in include, and non-text values', () => {
    expect(() => normalizeRule({ room: 'x' }, 'include')).toThrow(/can't match on "room"/);
    expect(() => normalizeRule({ entity: 'sensor.a' }, 'include')).toThrow(/entity/);
    expect(normalizeRule({ entity: 'sensor.a' }, 'exclude')).toEqual({ entity: ['sensor.a'] });
    expect(() => normalizeRule({ area: [3] }, 'include')).toThrow(/text/);
    expect(() => normalizeRule(['area'], 'include')).toThrow(/must list/);
  });
});

describe('matchEntities', () => {
  it('matches by device class, by name, skipping hidden and non-numeric entities', () => {
    expect(match({ device_class: 'battery' })).toEqual([
      'sensor.door_battery',
      'sensor.phone_battery',
      'sensor.remote_battery',
    ]);
  });

  it('reads the area from the entity, else its device, and the floor from the area', () => {
    expect(match({ area: 'kitchen' })).toEqual(['input_number.kitchen_target', 'sensor.kitchen_temp']);
    expect(match({ area: 'lounge' })).toEqual(['sensor.lounge_temp']);
    expect(match({ floor: 'ground', device_class: 'temperature' })).toEqual([
      'sensor.kitchen_temp',
      'sensor.lounge_temp',
    ]);
  });

  it('ORs values of one key, ANDs different keys', () => {
    expect(match({ area: ['kitchen', 'loft'], device_class: 'temperature' })).toEqual([
      'sensor.kitchen_temp',
      'sensor.loft_temp',
    ]);
    expect(match({ domain: 'input_number' })).toEqual(['input_number.kitchen_target']);
  });

  it('matches labels on the entity or its device', () => {
    expect(match({ label: ['climate', 'outdoor'] })).toEqual(['sensor.door_battery', 'sensor.lounge_temp']);
  });

  it('leaves out anything matching any exclude key', () => {
    expect(match({ device_class: 'temperature' }, { area: 'loft', entity: 'sensor.lounge_temp' })).toEqual([
      'sensor.kitchen_temp',
    ]);
    expect(match({ device_class: 'battery' }, { label: 'outdoor' })).toEqual([
      'sensor.phone_battery',
      'sensor.remote_battery',
    ]);
  });

  it('reuses the result while hass is unchanged, and notices a new entity', () => {
    const hass = house();
    const include = normalizeRule({ device_class: 'battery' }, 'include')!;
    const first = matchEntities(include, undefined, hass);
    expect(matchEntities(include, undefined, hass)).toBe(first);
    const next = { ...hass, states: { ...hass.states } };
    next.states['sensor.new_battery'] = {
      entity_id: 'sensor.new_battery',
      state: '99',
      attributes: { device_class: 'battery', friendly_name: 'A new battery' },
    };
    expect(matchEntities(include, undefined, next)[0]).toBe('sensor.new_battery');
  });
});

describe('cards filled from rules', () => {
  const cfg = (extra: Record<string, unknown>) => normalizeConfig({ type: 'custom:chartdeck-card', ...extra } as never);

  it('lists entities first, then matches not already listed, with the card options', () => {
    const config = cfg({ entities: ['sensor.phone_battery'], include: { device_class: 'battery' }, max: 200 });
    const resolved = resolveEntities(config, house());
    expect(resolved.map((e) => e.entityId)).toEqual([
      'sensor.phone_battery',
      'sensor.door_battery',
      'sensor.remote_battery',
    ]);
    expect(resolved[1].max).toBe(200);
  });

  it('hides unavailable entities when asked', () => {
    const config = cfg({ include: { device_class: 'battery' }, hide_unavailable: true });
    expect(resolveEntities(config, house()).map((e) => e.entityId)).toEqual([
      'sensor.door_battery',
      'sensor.phone_battery',
    ]);
  });

  it('validates limit and the card options matched entities inherit', () => {
    expect(() => cfg({ include: { domain: 'sensor' }, limit: 0 })).toThrow(/limit/);
    expect(() => cfg({ include: { domain: 'sensor' }, min: 10, max: 5 })).toThrow(/max/);
    expect(cfg({ include: { domain: 'sensor' }, limit: '3' }).limit).toBe(3);
  });

  it('sorts the whole list, then the card keeps the top N', () => {
    const config = cfg({ include: { device_class: 'battery' }, sort: 'ascending', limit: 1 });
    const sorted = sortEntities(resolveEntities(config, house()), config.sort);
    expect(sorted.slice(0, config.limit).map((e) => e.entityId)).toEqual(['sensor.door_battery']);
  });
});
