import { describe, expect, it } from 'vitest';
import { fillSpan, position } from '../src/scale';

describe('position', () => {
  it('maps and clamps', () => {
    expect(position(50, 0, 100)).toBe(0.5);
    expect(position(150, 0, 100)).toBe(1);
    expect(position(-5, 0, 100)).toBe(0);
  });
  it('returns 0 for degenerate input', () => {
    expect(position(5, 10, 10)).toBe(0);
    expect(position(5, 20, 10)).toBe(0);
    expect(position(NaN, 0, 1)).toBe(0);
  });
});

describe('fillSpan', () => {
  it('fills from zero normally', () => {
    expect(fillSpan(25, 0, 100)).toEqual([0, 0.25]);
  });
  it('fills from the zero point when the range straddles zero', () => {
    expect(fillSpan(50, -100, 100)).toEqual([0.5, 0.75]);
    expect(fillSpan(-50, -100, 100)).toEqual([0.25, 0.5]);
    expect(fillSpan(-150, -100, 100)).toEqual([0, 0.5]);
  });
  it('returns an empty span for an invalid range', () => {
    expect(fillSpan(5, 10, 10)).toEqual([0, 0]);
    expect(fillSpan(5, 10, -10)).toEqual([0, 0]);
    expect(fillSpan(NaN, -100, 100)).toEqual([0, 0]);
  });
});
