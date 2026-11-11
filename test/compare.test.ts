import { describe, expect, it } from 'vitest';
import {
  direction,
  extentOf,
  lowHigh,
  niceStep,
  niceTicks,
  readingAt,
  relativeChange,
  withZero,
} from '../src/chart/compare';

describe('comparison maths', () => {
  it('picks a 1/2/2.5/5 step', () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(7, 5)).toBe(2);
    expect(niceStep(0.3, 3)).toBeCloseTo(0.1);
    expect(niceStep(40, 5)).toBe(10);
    expect(niceStep(0, 5)).toBe(1);
    expect(niceStep(10, 0)).toBe(1);
  });

  it('makes round ticks that enclose the data', () => {
    expect(niceTicks(16.1, 24.6, 5)).toEqual([16, 18, 20, 22, 24, 26]);
    expect(niceTicks(0, 5, 5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceTicks(-1800, 2200, 4)).toEqual([-2000, -1000, 0, 1000, 2000, 3000]);
    expect(niceTicks(0.1, 0.3, 2)).toEqual([0.1, 0.2, 0.3]);
    expect(niceTicks(5, 1, 4)).toEqual([1, 2, 3, 4, 5]);
    expect(niceTicks(3, 3, 4)).toEqual([2.5, 2.75, 3, 3.25, 3.5]);
    expect(niceTicks(NaN, 3)).toEqual([]);
  });

  it('finds the extent, skipping gaps', () => {
    expect(extentOf([3, null, -2, undefined, NaN, 7])).toEqual([-2, 7]);
    expect(extentOf([null])).toBeUndefined();
    expect(withZero([3, 7])).toEqual([0, 7]);
    expect(withZero([-3, -1])).toEqual([-3, 0]);
    expect(withZero([-3, 4])).toEqual([-3, 4]);
  });

  it('reads the value in force at a time', () => {
    const points = [
      { t: 10, v: 1 },
      { t: 20, v: null },
      { t: 30, v: 3 },
    ];
    expect(readingAt(points, 5)).toBeNull();
    expect(readingAt(points, 10)).toBe(1);
    expect(readingAt(points, 15)).toBe(1);
    expect(readingAt(points, 25)).toBeNull();
    expect(readingAt(points, 99)).toBe(3);
    expect(readingAt([], 1)).toBeNull();
  });

  it('takes low and high from readings and statistics', () => {
    expect(
      lowHigh([
        { t: 1, v: 5, min: 2, max: 9 },
        { t: 2, v: null },
        { t: 3, v: 6 },
      ]),
    ).toEqual([2, 9]);
    expect(lowHigh([{ t: 1, v: null }])).toBeUndefined();
  });

  it('measures change and direction', () => {
    expect(relativeChange(100, 112)).toBeCloseTo(0.12);
    expect(relativeChange(-10, -5)).toBeCloseTo(0.5);
    expect(relativeChange(0, 5)).toBeUndefined();
    expect(relativeChange(null, 5)).toBeUndefined();
    expect(direction(1, 2)).toBe('up');
    expect(direction(2, 1)).toBe('down');
    expect(direction(2, 2)).toBe('flat');
  });
});
