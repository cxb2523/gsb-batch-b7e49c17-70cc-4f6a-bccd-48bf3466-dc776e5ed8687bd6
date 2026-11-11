import { describe, expect, it } from 'vitest';
import { axisAngle, labelAnchor, polar, polygonPoints, sectorPath } from '../src/chart/polar';

describe('polar maths', () => {
  it('measures angles clockwise from 12 o’clock', () => {
    expect(polar(10, 0)).toEqual([0, -10]);
    expect(polar(10, Math.PI / 2)).toEqual([10, 0]);
    expect(polar(10, Math.PI)).toEqual([0, 10]);
    expect(polar(10, (3 * Math.PI) / 2)).toEqual([-10, 0]);
  });

  it('spaces spokes evenly, the first straight up', () => {
    expect(axisAngle(0, 4)).toBe(0);
    expect(axisAngle(1, 4)).toBeCloseTo(Math.PI / 2);
    expect(axisAngle(3, 6)).toBeCloseTo(Math.PI);
    expect(axisAngle(0, 0)).toBe(0);
  });

  it('draws wedges, ring sectors and whole rings', () => {
    expect(sectorPath(0, 10, 0, Math.PI / 2)).toBe('M0 -10A10 10 0 0 1 10 0L0 0Z');
    expect(sectorPath(5, 10, 0, Math.PI / 2)).toBe('M0 -10A10 10 0 0 1 10 0L5 0A5 5 0 0 0 0 -5Z');
    expect(sectorPath(0, 10, 0, (3 * Math.PI) / 2)).toContain('A10 10 0 1 1');
    const disc = sectorPath(0, 10, 0, Math.PI * 2);
    expect(disc.match(/A/g)).toHaveLength(2);
    const ring = sectorPath(4, 10, 0, Math.PI * 2);
    expect(ring.match(/A/g)).toHaveLength(4);
    expect(sectorPath(0, 0, 0, 1)).toBe('');
    expect(sectorPath(0, 10, 1, 1)).toBe('');
  });

  it('writes polygon points and anchors labels by side', () => {
    expect(
      polygonPoints([
        [0, -1],
        [1, 0],
      ]),
    ).toBe('0,-1 1,0');
    expect(labelAnchor(0)).toBe('middle');
    expect(labelAnchor(Math.PI / 2)).toBe('start');
    expect(labelAnchor((3 * Math.PI) / 2)).toBe('end');
    expect(labelAnchor(Math.PI)).toBe('middle');
  });
});
