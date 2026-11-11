import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config';
import {
  buildTree,
  findNode,
  groupPath,
  levelName,
  parseGroupBy,
  partition,
  splitGroup,
  treeHeight,
  validateGroups,
} from '../src/chart/hierarchy';
import { resolveEntities } from '../src/resolve';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

function registries(): HomeAssistant {
  const hass = makeHass({
    'sensor.oven': ['1.2', { friendly_name: 'Oven' }],
    'sensor.kettle': ['0.6', { friendly_name: 'Kettle' }],
    'sensor.tv': ['0.5', { friendly_name: 'TV' }],
    'sensor.ev': ['3.6', { friendly_name: 'EV' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });
  Object.assign(hass, {
    entities: {
      'sensor.oven': { entity_id: 'sensor.oven', device_id: 'd1', labels: ['cooking'] },
      'sensor.kettle': { entity_id: 'sensor.kettle', area_id: 'kitchen' },
      'sensor.tv': { entity_id: 'sensor.tv', area_id: 'living_room' },
      'sensor.ev': { entity_id: 'sensor.ev' },
    },
    devices: { d1: { id: 'd1', name: 'Oven', name_by_user: 'Big oven', area_id: 'kitchen', labels: ['kitchen_kit'] } },
    areas: {
      kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground' },
      living_room: { area_id: 'living_room', floor_id: 'first' },
    },
    floors: { ground: { name: 'Ground floor' } },
    labels: { cooking: { name: 'Cooking' } },
  });
  return hass;
}

function items(config: Partial<CardConfig>, hass = registries()) {
  return resolveEntities(normalizeConfig({ type: 'x', ...config } as CardConfig), hass);
}

describe('grouping', () => {
  it('reads group_by as a list in house order, and rejects unknown levels', () => {
    expect(parseGroupBy(undefined)).toEqual([]);
    expect(parseGroupBy('area')).toEqual(['area']);
    expect(parseGroupBy(['area', 'floor', 'area'])).toEqual(['floor', 'area']);
    expect(() => parseGroupBy(['room'])).toThrow(/group_by.*floor, area, device, label/);
    expect(() => validateGroups({ type: 'x', entities: [{ entity: 'a', group: 3 }] } as unknown as CardConfig)).toThrow(
      /Entity 1: "group" must be text/,
    );
    expect(() =>
      validateGroups({ type: 'x', entities: ['a', { entity: 'b', group: 'X' }] } as CardConfig),
    ).not.toThrow();
  });

  it('splits an own group at slashes', () => {
    expect(splitGroup(' Ground / Kitchen /')).toEqual(['Ground', 'Kitchen']);
    expect(splitGroup(undefined)).toEqual([]);
  });

  it('names levels from the entity, its device, area and floor', () => {
    const hass = registries();
    expect(levelName('sensor.oven', 'area', hass)).toBe('Kitchen');
    expect(levelName('sensor.oven', 'floor', hass)).toBe('Ground floor');
    expect(levelName('sensor.oven', 'device', hass)).toBe('Big oven');
    expect(levelName('sensor.oven', 'label', hass)).toBe('Cooking');
    expect(levelName('sensor.tv', 'area', hass)).toBe('Living room');
    expect(levelName('sensor.tv', 'floor', hass)).toBe('First');
    expect(levelName('sensor.kettle', 'device', hass)).toBeUndefined();
    expect(levelName('sensor.ev', 'area', hass)).toBeUndefined();
    expect(levelName('sensor.ev', 'label', hass)).toBeUndefined();
    expect(levelName('sensor.nope', 'floor', hass)).toBeUndefined();
  });

  it('puts an entity in its own group, else its registry groups, else "Other"', () => {
    const hass = registries();
    const list = items({ entities: ['sensor.oven', 'sensor.ev', { entity: 'sensor.tv', group: 'Up / Lounge' }] }, hass);
    const paths = list.map((e) => groupPath(e, ['floor', 'area'], hass, 'Other'));
    expect(paths).toEqual([
      ['Ground floor', 'Kitchen'],
      ['Other', 'Other'],
      ['Up', 'Lounge'],
    ]);
    expect(groupPath(list[0], [], hass, 'Other')).toEqual([]);
  });
});

describe('tree', () => {
  it('sums groups, orders largest first and keeps item indexes', () => {
    const list = items({ entities: ['sensor.tv', 'sensor.oven', 'sensor.kettle', 'sensor.ev', 'sensor.off'] });
    const paths = [['Lounge'], ['Kitchen'], ['Kitchen'], [], ['Kitchen']];
    const root = buildTree(list, paths, 'All');
    expect(root.value).toBeCloseTo(5.9);
    expect(root.children.map((c) => c.name)).toEqual(['EV', 'Kitchen', 'Lounge']);
    const kitchen = findNode(root, ['Kitchen'])!;
    expect(kitchen.value).toBeCloseTo(1.8);
    expect(kitchen.children.map((c) => [c.name, c.index])).toEqual([
      ['Oven', 1],
      ['Kettle', 2],
      ['Off', 4],
    ]);
    expect(kitchen.children[2].value).toBe(0);
    expect(kitchen.path).toEqual(['Kitchen']);
    expect(findNode(root, ['Nowhere'])).toBeUndefined();
    expect(findNode(root, [])).toBe(root);
    expect(treeHeight(root)).toBe(2);
  });

  it('partitions each level in proportion, leaving out empty nodes', () => {
    const list = items({ entities: ['sensor.tv', 'sensor.oven', 'sensor.kettle', 'sensor.off'] });
    const root = buildTree(list, [['A'], ['B'], ['B'], ['B']], 'All');
    const spans = partition(root);
    expect(spans.map((s) => [s.node.name, s.level])).toEqual([
      ['All', 0],
      ['B', 1],
      ['Oven', 2],
      ['Kettle', 2],
      ['A', 1],
      ['TV', 2],
    ]);
    const b = spans[1];
    expect(b.x0).toBe(0);
    expect(b.x1).toBeCloseTo(1.8 / 2.3);
    expect(spans.at(-1)!.x1).toBeCloseTo(1);
    const empty = buildTree([], [], 'None');
    expect(partition(empty)).toHaveLength(1);
  });
});
