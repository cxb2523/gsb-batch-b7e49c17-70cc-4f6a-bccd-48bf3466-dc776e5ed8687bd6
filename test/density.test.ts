import { describe, expect, it } from 'vitest';
import {
  bandwidth,
  byValue,
  densityCurve,
  jitter,
  kde,
  quantile,
  readingsOf,
  sampleReadings,
  splitReadings,
  summarize,
} from '../src/chart/density';
import type { Reading } from '../src/chart/density';
import {
  categoryGeometry,
  categoryOptions,
  clockScale,
  labelColumn,
  labelCount,
  numberScale,
  validateCategoryOptions,
} from '../src/chart/category-plot';
import type { CardConfig } from '../src/types';

const plain = (values: number[]): Reading[] => values.map((v, i) => ({ t: i, v, w: 1, real: true }));

describe('readings', () => {
  it('weights history by how long each value held, leaving out gaps and the edge point', () => {
    const points = [
      { t: 0, v: 20, carried: true },
      { t: 10, v: 21 },
      { t: 11, v: null },
      { t: 15, v: 20 },
      { t: 100, v: 20 },
    ];
    expect(readingsOf(points, true, 100)).toEqual([
      { t: 0, v: 20, w: 10, real: false },
      { t: 10, v: 21, w: 1, real: true },
      { t: 15, v: 20, w: 85, real: true },
    ]);
  });

  it('counts grouped values and statistics rows once each', () => {
    const points = [
      { t: 0, v: 1 },
      { t: 10, v: null },
      { t: 20, v: 3 },
    ];
    expect(readingsOf(points, false, 30).map((r) => r.w)).toEqual([1, 1]);
  });

  it('keeps two readings in the same instant, barely', () => {
    const r = readingsOf(
      [
        { t: 5, v: 1 },
        { t: 5, v: 2 },
      ],
      true,
      10,
    );
    expect(r.map((x) => x.w)).toEqual([1, 5]);
  });

  it('splits held values across period boundaries', () => {
    const r: Reading[] = [
      { t: 0, v: 1, w: 150, real: false },
      { t: 150, v: 2, w: 50, real: true },
    ];
    const [a, b] = splitReadings(r, [0, 100, 200], true);
    expect(a).toEqual([{ t: 0, v: 1, w: 100, real: false }]);
    expect(b).toEqual([
      { t: 100, v: 1, w: 50, real: false },
      { t: 150, v: 2, w: 50, real: true },
    ]);
    const byTime = splitReadings(plain([5, 6, 7]), [0, 2, 4], false);
    expect(byTime.map((p) => p.map((x) => x.v))).toEqual([[5, 6], [7]]);
  });

  it('samples readings taken in the range, evenly', () => {
    const r = [...plain([1, 2, 3, 4, 5, 6]), { t: 9, v: 0, w: 1, real: false }];
    expect(sampleReadings(r, 3).map((x) => x.v)).toEqual([1, 3, 5]);
    expect(sampleReadings(r, 10)).toHaveLength(6);
  });
});

describe('quantiles and summary', () => {
  it('interpolates between readings at the middle of their weight', () => {
    const s = byValue(plain([4, 1, 3, 2]));
    expect(quantile(s, 0.5)).toBe(2.5);
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 1)).toBe(4);
    expect(quantile(byValue(plain([7])), 0.3)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('lets a value held longer pull the median to it', () => {
    const s = byValue([
      { t: 0, v: 20, w: 100, real: true },
      { t: 1, v: 30, w: 1, real: true },
      { t: 2, v: 31, w: 1, real: true },
    ]);
    expect(quantile(s, 0.5)).toBeLessThan(20.5);
  });

  it('summarises with whiskers inside 1.5 box-lengths', () => {
    const s = summarize(plain([1, 2, 3, 4, 5, 6, 7, 8, 100]))!;
    expect(s).toMatchObject({ n: 9, min: 1, max: 100, median: 5, low: 1, high: 8 });
    expect(s.q1).toBeCloseTo(2.75);
    expect(s.mean).toBeCloseTo(136 / 9);
    expect(summarize([])).toBeUndefined();
  });
});

describe('density', () => {
  it('picks a bandwidth by Silverman’s rule, never finer than the sensor’s step', () => {
    const values = Array.from({ length: 100 }, (_, i) => Math.round(Math.sin(i) * 50) / 10);
    const h = bandwidth(plain(values));
    expect(h).toBeGreaterThanOrEqual(0.1);
    expect(h).toBeLessThan(2);
    // Coarse steps: never narrower than a step.
    expect(bandwidth(plain([0, 0, 0, 5, 5, 5, 10, 10]))).toBeGreaterThanOrEqual(5);
    // All the same: 1 % of the value, or 1 at zero.
    expect(bandwidth(plain([20, 20, 20]))).toBeCloseTo(0.2);
    expect(bandwidth(plain([0, 0]))).toBe(1);
    expect(bandwidth([])).toBe(1);
  });

  it('counts a long-held value as one reading, not many', () => {
    const many = plain([1, 2, 3, 4, 5, 6, 7, 8]);
    const held = many.map((r, i) => ({ ...r, w: i === 0 ? 1000 : 1 }));
    expect(bandwidth(held)).not.toBe(bandwidth(many));
  });

  it('estimates a density that integrates to about one', () => {
    const r = plain([0, 0, 1, 2]);
    const xs = Array.from({ length: 401 }, (_, i) => -4 + i * 0.025);
    const ds = kde(r, 0.5, xs);
    const area = ds.reduce((a, d) => a + d * 0.025, 0);
    expect(area).toBeCloseTo(1, 2);
    expect(kde([], 1, [0])).toEqual([0]);
  });

  it('outlines the density from two bandwidths below to two above, peak scaled to one', () => {
    const curve = densityCurve(plain([10, 11, 12]), 1, [0, 100], 8);
    expect(curve).toHaveLength(9);
    expect(curve[0].x).toBe(8);
    expect(curve[8].x).toBe(14);
    expect(Math.max(...curve.map((p) => p.d))).toBe(1);
    expect(densityCurve(plain([10]), 1, [9, 10.5], 2)[0].x).toBe(9);
    expect(densityCurve([], 1, [0, 1])).toEqual([]);
    expect(densityCurve(plain([10]), 1, [20, 30])).toEqual([]);
  });

  it('jitters steadily within half a unit', () => {
    expect(jitter(3)).toBe(jitter(3));
    for (let i = 0; i < 50; i++) expect(Math.abs(jitter(i))).toBeLessThanOrEqual(0.5);
  });
});

describe('category plot', () => {
  const host = document.createElement('div');
  const ctx = (raw: Record<string, unknown>) => ({ host, requestUpdate: () => undefined, raw: raw as CardConfig });

  it('reads and checks its options', () => {
    expect(categoryOptions({} as CardConfig)).toEqual({
      orientation: 'horizontal',
      axis: true,
      grid: true,
      min: undefined,
      max: undefined,
    });
    const check = (raw: Record<string, unknown>) => () => validateCategoryOptions(raw as CardConfig);
    expect(check({ orientation: 'sideways' })).toThrow(/"orientation" must be one of: horizontal, vertical/);
    expect(check({ value_axis: 1 })).toThrow(/value_axis/);
    expect(check({ value_min: 'a' })).toThrow(/value_min/);
    expect(check({ value_min: 5, value_max: 1 })).toThrow(/below/);
    expect(check({ compact: 'yes' })).toThrow(/compact/);
    expect(check({ tooltip: 1 })).toThrow(/tooltip/);
    expect(check({ orientation: 'vertical', value_grid: false, value_min: 0, value_max: 1 })).not.toThrow();
  });

  it('lays bands across or up the plot', () => {
    const across = categoryGeometry(ctx({}), 2, { domain: [0, 10] });
    expect(across.at(5, 1)).toEqual([500, 150]);
    expect(across.at(0, 0, -0.5)).toEqual([0, 0]);
    expect(across.bandPx).toBe(64);
    expect(categoryGeometry(ctx({ compact: true }), 2, { domain: [0, 1] }).bandPx).toBe(44);
    expect(categoryGeometry(ctx({}), 10, { domain: [0, 1] }).bandPx).toBe(40);
    expect(categoryGeometry(ctx({}), 20, { domain: [0, 1] }).bandPx).toBe(28);
    expect(categoryGeometry(ctx({}), 2, { domain: [0, 1] }, 96).bandPx).toBe(96);
    expect(categoryGeometry(ctx({ compact: true }), 2, { domain: [0, 1] }, 96).bandPx).toBe(66);
    const up = categoryGeometry(ctx({ orientation: 'vertical' }), 4, { domain: [0, 10] });
    expect(up.at(10, 3)).toEqual([350, 0]);
    expect(up.width).toBe(400);
    expect(up.valuePx).toBe(180);
    expect(categoryGeometry(ctx({ orientation: 'vertical', compact: true }), 1, { domain: [0, 1] }).valuePx).toBe(110);
  });

  it('sizes the name column and the number of labels to the card', () => {
    expect(labelColumn(200)).toBe(64);
    expect(labelColumn(1000)).toBe(140);
    expect(labelCount(330, 'horizontal')).toBe(5);
    expect(labelCount(50, 'horizontal')).toBe(2);
    expect(labelCount(180, 'vertical')).toBe(4);
    expect(labelCount(110, 'vertical')).toBe(3);
  });

  it('labels values as numbers, or hours as clock times', () => {
    const n = numberScale([1, 9], { value_max: 20 } as CardConfig, 4, undefined);
    expect(n.domain[1]).toBe(20);
    expect(n.format(5)).toBe('5');
    const clock = clockScale(4, { locale: { language: 'en-GB', time_format: '24' } } as never);
    expect(clock.ticks).toEqual([0, 6, 12, 18, 24]);
    expect(clock.format(6)).toMatch(/^0?6:00$/);
    expect(clock.format(13.5)).toBe('13:30');
    expect(clockScale(8, undefined).ticks).toHaveLength(9);
    expect(clockScale(30, { language: 'not a language!' } as never).ticks).toHaveLength(25);
  });
});
