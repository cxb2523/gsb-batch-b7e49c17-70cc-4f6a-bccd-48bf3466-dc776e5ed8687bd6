import { describe, expect, it } from 'vitest';
import { arcPath, needlePath, polar, sweepAngles } from '../src/geometry';

describe('geometry', () => {
  it('polar: 0deg is 12 o clock, clockwise', () => {
    const [x, y] = polar(60, 60, 46, 90);
    expect(x).toBeCloseTo(106);
    expect(y).toBeCloseTo(60);
    const [tx, ty] = polar(60, 60, 46, 0);
    expect(tx).toBeCloseTo(60);
    expect(ty).toBeCloseTo(14);
  });
  it('arcPath builds arcs', () => {
    expect(arcPath(60, 60, 46, -90, 90)).toBe('M14.00 60.00 A46 46 0 0 1 106.00 60.00');
    expect(arcPath(60, 60, 46, -135, 135)).toContain(' 0 1 1 ');
    expect(arcPath(60, 60, 46, -180, 180).match(/A/g)).toHaveLength(2);
  });
  it('sweepAngles maps a span', () => {
    expect(sweepAngles(270, [0, 1])).toEqual([-135, 135]);
    expect(sweepAngles(180, [0.5, 0.75])).toEqual([0, 45]);
  });
  it('needlePath is a triangle pointing up', () => {
    expect(needlePath(60, 60, 40, 3)).toBe('M60.00 20.00 L63.00 60.00 L57.00 60.00 Z');
  });
});
