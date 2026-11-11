import { describe, expect, it } from 'vitest';
import { inset, squarify } from '../src/chart/treemap-layout';
import type { Rect } from '../src/chart/treemap-layout';

const area = (r: Rect) => r.w * r.h;

describe('squarify', () => {
  it('gives each value an area in proportion, filling the rectangle', () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const rect = { x: 0, y: 0, w: 600, h: 400 };
    const out = squarify(values, rect);
    const total = values.reduce((a, b) => a + b, 0);
    out.forEach((r, i) => expect(area(r)).toBeCloseTo((values[i] / total) * 600 * 400, 6));
    for (const r of out) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(400 + 1e-9);
    }
    // The classic example's first two land side by side as squares-ish columns.
    expect(Math.max(out[0].w / out[0].h, out[0].h / out[0].w)).toBeLessThan(2);
  });

  it('keeps the input order and gives nothing to zero, negative and missing values', () => {
    const out = squarify([0, 5, -2, Number.NaN, 5], { x: 10, y: 20, w: 100, h: 50 });
    expect(out).toHaveLength(5);
    expect(area(out[0])).toBe(0);
    expect(area(out[2])).toBe(0);
    expect(area(out[3])).toBe(0);
    expect(area(out[1])).toBeCloseTo(2500);
    expect(area(out[4])).toBeCloseTo(2500);
    expect(out[1].x).toBe(10);
  });

  it('lays rows along the top of a tall rectangle', () => {
    const out = squarify([1, 1], { x: 0, y: 0, w: 10, h: 40 });
    expect(out[0]).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    expect(out[1]).toEqual({ x: 0, y: 20, w: 10, h: 20 });
  });

  it('returns empty rectangles when there is nothing to lay out', () => {
    expect(squarify([], { x: 0, y: 0, w: 1, h: 1 })).toEqual([]);
    expect(squarify([1], { x: 0, y: 0, w: 0, h: 1 })[0].w).toBe(0);
  });

  it('insets without going negative', () => {
    expect(inset({ x: 0, y: 0, w: 10, h: 10 }, 2)).toEqual({ x: 2, y: 2, w: 6, h: 6 });
    expect(inset({ x: 0, y: 0, w: 2, h: 10 }, 4)).toEqual({ x: 1, y: 1, w: 0, h: 8 });
  });
});
