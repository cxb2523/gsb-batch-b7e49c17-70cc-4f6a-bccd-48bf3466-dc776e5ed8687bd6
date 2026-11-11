import { describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import {
  SERIES_COLORS,
  apportion,
  arcs,
  cachedSchema,
  centreText,
  chartForm,
  checkBoolean,
  checkChoice,
  checkNumber,
  checkText,
  choice,
  degreesFor,
  partColor,
  partValues,
  partsLegend,
  percentText,
  segStyle,
  shade,
  sharedUnit,
  shares,
  shrink,
  summary,
} from '../src/chart/parts';
import type { ResolvedEntity } from '../src/resolve';
import type { ChartContext } from '../src/styles/index';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';

function entity(over: Partial<ResolvedEntity> & { config?: Record<string, unknown> } = {}): ResolvedEntity {
  return {
    entityId: 'sensor.x',
    available: true,
    value: 10,
    min: 0,
    max: 100,
    target: null,
    name: 'X',
    unit: 'kWh',
    decimals: 1,
    position: 0.1,
    span: [0, 0.1],
    targetPosition: null,
    band: { from: 0, color: 'green' },
    bands: [{ from: 0, color: 'green' }],
    valueText: '10',
    display: '10 kWh',
    label: 'X, 10 kWh',
    ...over,
    config: { entity: 'sensor.x', tap_action: { action: 'more-info' }, ...(over.config ?? {}) },
  } as unknown as ResolvedEntity;
}

describe('share maths', () => {
  it('counts only positive available values as parts', () => {
    const items = [
      entity({ value: 5 }),
      entity({ value: -3 }),
      entity({ available: false, value: null }),
      entity({ value: 0 }),
    ];
    expect(partValues(items)).toEqual([5, 0, 0, 0]);
  });

  it('turns values into fractions of their sum, or all zero', () => {
    expect(shares([1, 3])).toEqual([0.25, 0.75]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(shares([-2, 2])).toEqual([0, 1]);
  });

  it('apportions whole numbers that add up exactly', () => {
    expect(apportion([1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion([8.4, 6.2, 3.1, 1.6, 1.5]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(apportion([64, 36], 100)).toEqual([64, 36]);
    expect(apportion([0, 0])).toEqual([0, 0]);
    expect(apportion([1, 2], 9)).toEqual([3, 6]);
  });

  it('lays arcs end to end across a range', () => {
    expect(arcs([0.25, 0.75])).toEqual([
      { start: 0, end: 90 },
      { start: 90, end: 360 },
    ]);
    expect(arcs([0.5], -90, 90)).toEqual([{ start: -90, end: 0 }]);
  });

  it('shrinks an arc from both ends, never past zero length', () => {
    expect(shrink({ start: 0, end: 90 }, 10)).toEqual({ start: 5, end: 85 });
    expect(shrink({ start: 0, end: 4 }, 10)).toEqual({ start: 2, end: 2 });
    expect(shrink({ start: 0, end: 4 }, -1)).toEqual({ start: 0, end: 4 });
  });

  it('converts a length on a circle to degrees', () => {
    expect(degreesFor(Math.PI, 180)).toBeCloseTo(1);
    expect(degreesFor(5, 0)).toBe(0);
  });

  it('draws an arc as a dash turned to its start', () => {
    expect(segStyle({ start: 90, end: 180 })).toBe('--a:0.000deg;--len:90.000');
    expect(segStyle({ start: 10, end: 5 })).toContain('--len:0.000');
  });
});

describe('part colours', () => {
  it('uses the series palette, an own colour, the band, or shades', () => {
    expect(partColor(entity(), 0, 3, 'series')).toBe('var(--primary-color, #2f6fe4)');
    expect(partColor(entity(), 5, 9, 'series')).toBe(SERIES_COLORS[5]);
    expect(partColor(entity({ config: { color: 'red' } }), 0, 3, 'series')).toBe('var(--error-color, #ef3b5a)');
    expect(partColor(entity(), 0, 3, 'bands')).toBe('var(--success-color, #1fae7a)');
    expect(partColor(entity(), 0, 3, 'shades', '#123456')).toBe('#123456');
    expect(partColor(entity(), 2, 3, 'shades', '#123456')).toContain('#123456 35%');
  });

  it('shades from full strength towards the card background', () => {
    expect(shade('red', 0, 4)).toBe('red');
    expect(shade('red', 1, 1)).toBe('red');
    expect(shade('red', 3, 4)).toBe('color-mix(in srgb, red 35%, var(--card-background-color, #fff))');
  });
});

describe('summaries', () => {
  it('shares a unit only when every available item has it', () => {
    expect(sharedUnit([entity(), entity()])).toBe('kWh');
    expect(sharedUnit([entity(), entity({ unit: 'W' })])).toBe('');
    expect(sharedUnit([entity(), entity({ unit: 'W', available: false })])).toBe('kWh');
  });

  it('totals or averages the available values', () => {
    const hass = makeHass({});
    const items = [
      entity({ value: 2, decimals: 0 }),
      entity({ value: 3.5, decimals: 1 }),
      entity({ available: false, value: null }),
    ];
    expect(summary(items, 'total', hass)).toMatchObject({ value: 5.5, text: '5.5', unit: 'kWh' });
    expect(summary(items, 'average', hass)?.value).toBeCloseTo(2.75);
    expect(summary(items, 'total', hass, [1, 1, 0])?.value).toBe(2);
    expect(summary([entity({ available: false, value: null })], 'total', hass)).toBeUndefined();
  });

  it('formats a percentage', () => {
    expect(percentText(40, makeHass({}))).toBe('40 %');
  });
});

describe('legend and centre', () => {
  const ctx = (show: Partial<ChartContext['config']['show']> = {}) =>
    ({
      hass: makeHass({}),
      config: { show: { name: true, value: true, icon: true, target: true, legend: true, ...show } },
    }) as unknown as ChartContext;

  it('draws a tappable row per entity with its share', () => {
    const host = document.createElement('div');
    const rows = [
      { index: 0, entity: entity({ name: 'Heat pump' }), color: 'red', share: '40 %' },
      {
        index: 1,
        entity: entity({ available: false, display: 'Unavailable', config: { tap_action: { action: 'none' } } }),
        color: 'blue',
      },
    ];
    render(partsLegend(rows, ctx()), host);
    const els = host.querySelectorAll('.part-row');
    expect(els).toHaveLength(2);
    expect(els[0].getAttribute('data-index')).toBe('0');
    expect(els[0].getAttribute('tabindex')).toBe('0');
    expect(els[0].getAttribute('aria-label')).toBe('X, 10 kWh, 40 %');
    expect(els[0].querySelector('.part-share')!.textContent).toBe('40 %');
    expect(els[1].classList.contains('unavailable')).toBe(true);
    expect(els[1].hasAttribute('tabindex')).toBe(false);
    expect(els[1].querySelector('.swatch')!.classList.contains('empty')).toBe(true);
  });

  it('draws no legend when it would be empty', () => {
    const host = document.createElement('div');
    render(partsLegend([{ index: 0, entity: entity(), color: 'red' }], ctx({ name: false, value: false })), host);
    expect(host.querySelector('.parts-legend')).toBeNull();
    render(partsLegend([], ctx()), host);
    expect(host.querySelector('.parts-legend')).toBeNull();
  });

  it('draws a centre number with an optional unit and caption', () => {
    const host = document.createElement('div');
    render(centreText('61', '%', 'average'), host);
    expect(host.querySelector('.centre-unit')!.textContent).toBe('%');
    expect(host.querySelector('.centre-caption')!.textContent).toBe('average');
    render(centreText('61', '', ''), host);
    expect(host.querySelector('.centre-unit')).toBeNull();
    expect(host.querySelector('.centre-caption')).toBeNull();
  });
});

describe('option checks', () => {
  const raw = (o: Record<string, unknown>) => ({ type: 'x', ...o }) as CardConfig;
  it('accepts unset and valid values, and names the option when not', () => {
    expect(() => checkChoice(raw({}), 'shape', ['a'])).not.toThrow();
    expect(() => checkChoice(raw({ shape: 'b' }), 'shape', ['a', 'c'])).toThrow('"shape" must be one of: a, c');
    expect(() => checkNumber(raw({ gap: 3 }), 'gap', 0, 10)).not.toThrow();
    expect(() => checkNumber(raw({ gap: 11 }), 'gap', 0, 10)).toThrow('"gap" must be a number from 0 to 10');
    expect(() => checkNumber(raw({ gap: '2' }), 'gap', 0, 10)).toThrow(/gap/);
    expect(() => checkBoolean(raw({ rounded: 'yes' }), 'rounded')).toThrow('"rounded" must be true or false');
    expect(() => checkBoolean(raw({ rounded: true }), 'rounded')).not.toThrow();
    expect(() => checkText(raw({ label: 3 }), 'label')).toThrow('"label" must be text');
    expect(() => checkText(raw({ label: 'a' }), 'label')).not.toThrow();
  });
});

describe('chart form', () => {
  it('labels dropdown choices and builds a schema once per language', () => {
    const hass = makeHass({});
    expect(choice(hass, 'color_by', ['series']).select.options).toEqual([
      { value: 'series', label: 'One colour per entity' },
    ]);
    const build = vi.fn(() => [{ name: 'a' }]);
    const first = cachedSchema('parts-test', hass, build);
    expect(cachedSchema('parts-test', hass, build)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('commits changed values and drops ones set back to their default', () => {
    const commit = vi.fn();
    const config = { type: 'x', style: 'pie', gap: 4 } as CardConfig;
    const host = document.createElement('div');
    const fields = [{ name: 'gap', path: ['gap'], default: 2 }];
    render(chartForm({ config, commit, hass: makeHass({}) }, 'chart', [], fields), host);
    const form = host.querySelector('ha-form') as HTMLElement & { data: Record<string, unknown> };
    expect(form.data).toEqual({ gap: 4 });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { gap: 2 } } }));
    expect(commit).toHaveBeenCalledWith({ type: 'x', style: 'pie' });
    commit.mockClear();
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { gap: 4 } } }));
    expect(commit).not.toHaveBeenCalled();
  });
});
