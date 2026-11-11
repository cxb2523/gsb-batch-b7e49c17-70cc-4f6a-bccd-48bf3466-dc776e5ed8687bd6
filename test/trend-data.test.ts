import { describe, expect, it } from 'vitest';
import {
  bandStops,
  bucketBounds,
  bucketSeries,
  extrema,
  parseBound,
  placeBuckets,
  trendDomain,
} from '../src/chart/trend-data';

const H = 3_600_000;

describe('trend bounds', () => {
  it('reads hard and soft bounds, and rejects anything else', () => {
    expect(parseBound(undefined, 'y_min')).toBeUndefined();
    expect(parseBound('', 'y_min')).toBeUndefined();
    expect(parseBound(5, 'y_min')).toEqual({ value: 5, soft: false });
    expect(parseBound('5', 'y_min')).toEqual({ value: 5, soft: false });
    expect(parseBound('~-2.5', 'y_min')).toEqual({ value: -2.5, soft: true });
    expect(() => parseBound('~', 'y_min')).toThrow(/"y_min" must be a number/);
    expect(() => parseBound('low', 'y_max')).toThrow(/"y_max"/);
    expect(() => parseBound(true, 'y_max')).toThrow(/"y_max"/);
  });

  it('pads the readings, and keeps hard bounds exactly', () => {
    expect(trendDomain([10, 20])).toEqual([9, 21]);
    expect(trendDomain([10, 20], { min: { value: 0, soft: false } })).toEqual([0, 21]);
    expect(trendDomain([10, 20], { max: { value: 15, soft: false } })).toEqual([9, 15]);
  });

  it('moves a soft bound only when a reading goes past it', () => {
    // ~0 holds: every reading is above it.
    expect(trendDomain([10, 20], { min: { value: 0, soft: true } })).toEqual([0, 21]);
    // ~15 gives way to the 10 reading below it.
    expect(trendDomain([10, 20], { min: { value: 15, soft: true } })).toEqual([9, 21]);
    expect(trendDomain([10, 20], { max: { value: 30, soft: true } })).toEqual([9, 30]);
    expect(trendDomain([10, 20], { max: { value: 18, soft: true } })).toEqual([9, 21]);
  });

  it('widens a narrow range to min_range about its middle', () => {
    const [lo, hi] = trendDomain([18.6, 18.8], { minRange: 4 });
    expect(lo).toBeCloseTo(16.3);
    expect(hi).toBeCloseTo(21.1);
  });

  it('stands bars on zero, and never returns an empty range', () => {
    expect(trendDomain([10, 20], { fromZero: true })).toEqual([0, 22]);
    expect(trendDomain([-20, -10], { fromZero: true })).toEqual([-22, 0]);
    expect(trendDomain(undefined)).toEqual([-0.1, 1.1]);
    expect(trendDomain([5, 5], { min: { value: 5, soft: false }, max: { value: 5, soft: false } })).toEqual([5, 6]);
  });
});

describe('trend buckets', () => {
  const range = { start: 0, end: 24 * H };

  it('splits the range into points_per_hour buckets, capped', () => {
    const bounds = bucketBounds(range, 0.5);
    expect(bounds).toHaveLength(13);
    expect(bounds[1]).toBe(2 * H);
    expect(bounds.at(-1)).toBe(24 * H);
    expect(bucketBounds(range, 60, 96)).toHaveLength(97);
    expect(bucketBounds(range, 0)).toEqual([]);
    expect(bucketBounds({ start: 5, end: 5 }, 1)).toEqual([]);
  });

  it('averages each bucket by time, and drops the carried point before a sum', () => {
    const points = [
      { t: 0, v: 10 },
      { t: 1.5 * H, v: 20 },
      { t: 4 * H, v: 20 },
    ];
    const bounds = [0, 2 * H, 4 * H];
    const mean = bucketSeries(points, bounds, 'mean', 'history', 4 * H);
    expect(mean.map((p) => p.v)).toEqual([12.5, 20]);
    const sum = bucketSeries(points, bounds, 'sum', 'history', 4 * H);
    expect(sum.map((p) => p.v)).toEqual([30, null]);
    expect(bucketSeries(points, [], 'mean', 'history', 4 * H)).toBe(points);
  });

  it('places each bucket at the middle of what has happened, carried out to both edges', () => {
    const placed = placeBuckets(
      [
        { t: 0, end: 2 * H, v: 1 },
        { t: 2 * H, end: 4 * H, v: 3 },
        { t: 4 * H, end: 6 * H, v: null },
      ],
      { start: 0, end: 6 * H },
      3 * H,
    );
    expect(placed).toEqual([
      { t: 0, v: 1, carried: true },
      { t: H, start: 0, end: 2 * H, v: 1 },
      { t: 2.5 * H, start: 2 * H, end: 3 * H, v: 3 },
      { t: 3 * H, v: 3, carried: true },
    ]);
    expect(placeBuckets([{ t: 0, end: H, v: null }], { start: 0, end: H }, H)).toEqual([
      { t: H / 2, start: 0, end: H, v: null },
    ]);
  });
});

describe('trend colours and extrema', () => {
  const bands = [
    { from: -Infinity, color: 'blue' },
    { from: 20, color: 'red' },
  ];

  it('changes colour at a band start, or blends towards it', () => {
    const hard = bandStops(bands, [10, 30], 'hard');
    expect(hard.map((s) => s.offset)).toEqual([0, 0.5, 0.5, 1]);
    expect(hard[1].color).toContain('--info-color');
    expect(hard[2].color).toContain('--error-color');
    const smooth = bandStops(bands, [10, 30], 'smooth');
    expect(smooth.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });

  it('finds the lowest, highest and average, skipping carried edges', () => {
    const points = [
      { t: 0, v: 50, carried: true },
      { t: 1, v: 10 },
      { t: 2, v: null },
      { t: 3, v: 30 },
      { t: 5, v: 30, carried: true },
    ];
    expect(extrema(points, false)).toEqual({ min: { t: 1, v: 10 }, max: { t: 3, v: 30 }, mean: 20 });
    // Weighted: 50 held for 1, 10 for 1, 30 for 2; the unavailable stretch doesn't count → 120 / 4.
    expect(extrema(points, true)!.mean).toBe(30);
    expect(extrema([{ t: 0, v: null }], false)).toBeUndefined();
  });
});
