/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, normalizeConfig } from '../src/config';
import { localize } from '../src/localize';

describe('normalizeConfig', () => {
  it('expands shorthand entities and applies defaults', () => {
    const c = normalizeConfig({ type: 'custom:chartdeck-card', entities: ['sensor.a'] });
    expect(c.style).toBe('bar');
    expect(c.sort).toBe('none');
    expect(c.animate).toBe(true);
    expect(c.show).toEqual({ name: true, value: true, icon: true, target: true, legend: false });
    expect(c.entities[0]).toMatchObject({
      entity: 'sensor.a',
      min: 0,
      max: 100,
      tap_action: { action: 'more-info' },
      hold_action: { action: 'none' },
      double_tap_action: { action: 'none' },
    });
    expect(c.entities[0].severity).toEqual(DEFAULT_BANDS);
    expect(c.legendBands).toEqual(DEFAULT_BANDS);
  });
  it('lets an entity override card-level options', () => {
    const c = normalizeConfig({
      type: 'x',
      max: 50,
      unit: 'W',
      entities: [{ entity: 'sensor.a', max: 'sensor.cap' }, 'sensor.b'],
    });
    expect(c.entities[0].max).toBe('sensor.cap');
    expect(c.entities[0].unit).toBe('W');
    expect(c.entities[1].max).toBe(50);
  });
  it('coerces and sorts bands', () => {
    const c = normalizeConfig({
      type: 'x',
      entities: ['sensor.a'],
      severity: [
        { from: '50' as any, color: 'green' },
        { from: 0, color: 'red' },
      ],
    });
    expect(c.entities[0].severity.map((b) => b.from)).toEqual([0, 50]);
    expect(c.legendBands.map((b) => b.from)).toEqual([0, 50]);
  });
  it('rejects a band whose from is blank or neither a number nor an entity id', () => {
    for (const from of ['', true, {}]) {
      expect(() =>
        normalizeConfig({ type: 'x', entities: ['sensor.a'], severity: [{ from: from as any, color: 'red' }] }),
      ).toThrow(/band 1.*number or an entity/i);
    }
  });
  it('keeps a band starting at an entity, leaving the order for when it is read', () => {
    const c = normalizeConfig({
      type: 'x',
      entities: ['sensor.a'],
      severity: [
        { from: 50, color: 'green' },
        { from: 'input_number.low', color: 'red' },
        { from: '0', color: 'amber' },
      ],
    });
    expect(c.legendBands.map((b) => b.from)).toEqual([50, 'input_number.low', 0]);
  });
  it('accepts no entities (editor preview) but rejects bad shapes', () => {
    expect(normalizeConfig({ type: 'x' }).entities).toEqual([]);
    expect(() => normalizeConfig({ type: 'x', entities: 'sensor.a' as any })).toThrow(/entities/);
    expect(() => normalizeConfig({ type: 'x', entities: [{ entity: 'sensor.a', attribute: 3 as any }] })).toThrow(
      /attribute/,
    );
    expect(() => normalizeConfig({ type: 'x', style: 'nonsense' as any })).toThrow(/style/);
    expect(() => normalizeConfig({ type: 'x', entities: [{ name: 'no id' } as any] })).toThrow(/entity/);
    expect(() => normalizeConfig({ type: 'x', min: 10, max: 10, entities: ['sensor.a'] })).toThrow(/max/);
  });
  it('accepts numeric strings for min/max/target/decimals/columns', () => {
    const c = normalizeConfig({
      type: 'x',
      min: '-20' as any,
      columns: '3' as any,
      entities: ['sensor.a'],
    });
    expect(c.entities[0].min).toBe(-20);
    expect(c.columns).toBe(3);
  });
  it('requires decimals to be a whole number from 0 to 20', () => {
    const entities = ['sensor.a'];
    expect(normalizeConfig({ type: 'x', decimals: 0, entities }).entities[0].decimals).toBe(0);
    expect(normalizeConfig({ type: 'x', decimals: '20' as any, entities }).entities[0].decimals).toBe(20);
    for (const bad of [-1, 21, 1.5, 100]) {
      expect(() => normalizeConfig({ type: 'x', decimals: bad, entities })).toThrow(
        /"decimals" must be a whole number from 0 to 20/,
      );
      expect(() => normalizeConfig({ type: 'x', entities: [{ entity: 'sensor.a', decimals: bad }] })).toThrow(
        /"decimals" must be a whole number from 0 to 20/,
      );
    }
    expect(() => normalizeConfig({ type: 'x', decimals: 'two' as any, entities })).toThrow(/"decimals"/);
  });
  it('requires columns to be a whole number of at least 1', () => {
    expect(normalizeConfig({ type: 'x', columns: 1 }).columns).toBe(1);
    for (const bad of [0, -2, 2.5]) {
      expect(() => normalizeConfig({ type: 'x', columns: bad })).toThrow(
        /"columns" must be a whole number of at least 1/,
      );
    }
  });
});

describe('localize', () => {
  it('returns english strings, interpolates and falls back to the key', () => {
    expect(localize(undefined, 'unavailable')).toBe('Unavailable');
    expect(localize({ states: {}, language: 'de' }, 'no_entities')).toBe('Add an entity in the editor to get started.');
    expect(localize(undefined, 'nope')).toBe('nope');
  });
});
