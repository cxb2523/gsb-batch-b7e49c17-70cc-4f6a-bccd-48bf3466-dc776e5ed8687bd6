import { describe, expect, it } from 'vitest';
import { bubbleDiameter, jitter, pairReadings, thin, validateXY, xyOptions } from '../src/chart/scatter-plot';
import type { CardConfig } from '../src/types';

describe('pairing readings in time', () => {
  it('samples every series at each time any of them changed, holding the last value', () => {
    const x = [
      { t: 0, v: 1 },
      { t: 10, v: 2 },
    ];
    const y = [
      { t: 5, v: 50 },
      { t: 10, v: 60 },
      { t: 20, v: 70 },
    ];
    expect(pairReadings([x, y])).toEqual([
      { t: 5, v: [1, 50] },
      { t: 10, v: [2, 60] },
      { t: 20, v: [2, 70] },
    ]);
  });

  it('leaves out times when a series is unavailable, has no value yet, or is the carried edge', () => {
    const x = [
      { t: 0, v: 1 },
      { t: 10, v: null },
      { t: 20, v: 3 },
      { t: 30, v: 3 },
    ];
    const y = [
      { t: 5, v: 7 },
      { t: 30, v: 8 },
    ];
    expect(pairReadings([x, y], 30)).toEqual([
      { t: 5, v: [1, 7] },
      { t: 20, v: [3, 7] },
    ]);
    expect(pairReadings([x, []])).toEqual([]);
  });

  it('pairs three series for bubbles', () => {
    const s = (v: number) => [{ t: 0, v }];
    expect(pairReadings([s(1), s(2), s(3)])).toEqual([{ t: 0, v: [1, 2, 3] }]);
  });
});

describe('scatter maths', () => {
  it('thins evenly, keeping the last', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(thin(items, 20)).toBe(items);
    expect(thin(items, 4)).toEqual([0, 2, 5, 9]);
  });

  it('jitters steadily per reading, between -1 and 1', () => {
    const a = jitter(1_700_000_000_000, 0);
    expect(jitter(1_700_000_000_000, 0)).toBe(a);
    expect(jitter(1_700_000_000_000, 1)).not.toBe(a);
    const all = Array.from({ length: 200 }, (_, i) => jitter(i * 60_000, 3));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...all)).toBeLessThanOrEqual(1);
    expect(Math.min(...all)).toBeLessThan(-0.5);
    expect(Math.max(...all)).toBeGreaterThan(0.5);
  });

  it('sizes bubbles by area between the smallest and largest', () => {
    expect(bubbleDiameter(0, [0, 10], 4, 20)).toBe(4);
    expect(bubbleDiameter(10, [0, 10], 4, 20)).toBe(20);
    // Halfway up the range: half the area between the two, not half the width.
    expect(bubbleDiameter(5, [0, 10], 0, 20)).toBeCloseTo(14.1, 1);
    expect(bubbleDiameter(99, [0, 10], 4, 20)).toBe(20);
    expect(bubbleDiameter(3, [3, 3], 0, 20)).toBeCloseTo(14.1, 1);
  });
});

describe('scatter and bubble options', () => {
  const check = (kind: 'scatter' | 'bubble', extra: Record<string, unknown>) => () =>
    validateXY({ type: 'x', ...extra } as CardConfig, kind);

  it('has defaults, and a bubble chart is always against an entity', () => {
    expect(xyOptions({ type: 'x' }, 'scatter')).toEqual({
      against: 'entity',
      dotSize: 6,
      jitter: 0,
      minSize: 6,
      maxSize: 32,
    });
    expect(xyOptions({ type: 'x', against: 'time', dot_size: 9, jitter: 3 }, 'scatter')).toMatchObject({
      against: 'time',
      dotSize: 9,
      jitter: 3,
    });
    expect(xyOptions({ type: 'x', against: 'time' }, 'bubble').against).toBe('entity');
  });

  it('gives readable errors', () => {
    expect(check('scatter', { against: 'moon' })).toThrow('"against" must be one of: entity, time');
    expect(check('scatter', { dot_size: 0 })).toThrow('"dot_size" must be a number from 2 to 30');
    expect(check('scatter', { jitter: 'lots' })).toThrow('"jitter" must be a number from 0 to 20');
    expect(check('scatter', { x_min: 3, x_max: 1 })).toThrow(/x_min/);
    expect(check('scatter', { source: 'cloud' })).toThrow(/source/);
    expect(check('bubble', { max_size: 200 })).toThrow('"max_size" must be a number from 2 to 80');
    expect(check('bubble', { min_size: 30, max_size: 10 })).toThrow('"min_size" must not be above "max_size"');
    expect(check('bubble', { min_size: 4, max_size: 40, jitter: 2 })).not.toThrow();
    expect(check('scatter', { against: 'time', dot_size: 8 })).not.toThrow();
  });
});
