import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import { VIEW_H, VIEW_W } from '../src/chart/frame';
import {
  nearestPoint,
  pickHandlers,
  pickTooltip,
  pickedIndex,
  stopPick,
  validateXRange,
  valueAxes,
  xDecimals,
  xRange,
} from '../src/chart/xy';
import type { ChartContext } from '../src/styles/index';
import type { CardConfig } from '../src/types';

const ctxWith = (raw: Partial<CardConfig> = {}) => {
  const host = document.createElement('div');
  return { host, raw: { type: 'x', ...raw }, requestUpdate: vi.fn() } as unknown as ChartContext;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('value axes', () => {
  it('puts round steps on both axes, with the bottom ones as ticks and range', () => {
    const axes = valueAxes(ctxWith(), [3, 27], [0, 9], { yFloor: 0 });
    expect(axes.range.start).toBeLessThanOrEqual(3);
    expect(axes.range.end).toBeGreaterThanOrEqual(27);
    expect(axes.times[0]).toBe(axes.range.start);
    expect(axes.value.domain[0]).toBe(0);
    expect(axes.scales.x(axes.range.start)).toBe(0);
    expect(axes.scales.x(axes.range.end)).toBeCloseTo(VIEW_W);
    expect(axes.scales.y(0)).toBeCloseTo(VIEW_H);
    expect(xDecimals(axes)).toBe(0);
  });

  it('keeps fixed ends, the card y range over the floor, and copes with no data', () => {
    const axes = valueAxes(ctxWith({ y_min: 2, y_max: 8 }), [0.1, 0.4], undefined, {
      x: { min: 0, max: 0.5 },
      yFloor: 0,
    });
    expect(axes.range).toEqual({ start: 0, end: 0.5 });
    expect(axes.value.domain).toEqual([2, 8]);
    expect(xDecimals(axes)).toBe(1);
    expect(xDecimals({ ...axes, times: [1] })).toBe(0);
  });

  it('reads and checks x_min and x_max', () => {
    expect(xRange({ type: 'x', x_min: 1, x_max: 'a' })).toEqual({ min: 1, max: undefined });
    expect(() => validateXRange({ type: 'x', x_min: 'low' })).toThrow('"x_min" must be a number');
    expect(() => validateXRange({ type: 'x', x_min: 5, x_max: 5 })).toThrow('"x_min" must be below "x_max"');
    expect(() => validateXRange({ type: 'x', x_min: 0, x_max: 5 })).not.toThrow();
  });
});

describe('picking a mark', () => {
  it('finds the nearest point within reach in screen pixels', () => {
    const pts: [number, number][] = [
      [0, 0],
      [500, 100],
      [1000, 200],
    ];
    // A 200 × 100 px plot: the middle point is at (100, 50) px.
    expect(nearestPoint(pts, 0.52, 0.5, 200, 100)).toBe(1);
    expect(nearestPoint(pts, 0.98, 0.98, 200, 100)).toBe(2);
    expect(nearestPoint(pts, 0.25, 0.25, 200, 100, 10)).toBeUndefined();
  });

  it('asks which mark is under the pointer and redraws only when it changes', () => {
    vi.useFakeTimers();
    const ctx = ctxWith();
    const pick = vi.fn((fx: number) => (fx < 0.5 ? 0 : 1));
    const h = pickHandlers(ctx, pick);
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 50 }) as DOMRect;
    const ev = (x: number, type = 'mouse') =>
      ({ currentTarget: el, clientX: x, clientY: 10, pointerType: type }) as never;
    h.move(ev(20));
    expect(pick).toHaveBeenLastCalledWith(0.2, 0.2, 100, 50);
    expect(pickedIndex(ctx.host)).toBe(0);
    h.move(ev(30));
    expect(ctx.requestUpdate).toHaveBeenCalledTimes(1);
    h.move(ev(80));
    expect(pickedIndex(ctx.host)).toBe(1);
    h.leave(ev(80));
    expect(pickedIndex(ctx.host)).toBeUndefined();
    h.move(ev(80, 'touch'));
    h.leave(ev(80, 'touch'));
    expect(pickedIndex(ctx.host)).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(pickedIndex(ctx.host)).toBeUndefined();
    h.move(ev(10, 'touch'));
    h.leave(ev(10, 'touch'));
    stopPick(ctx.host);
    expect(pickedIndex(ctx.host)).toBeUndefined();
    const zero = document.createElement('div');
    zero.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    h.move({ currentTarget: zero, clientX: 5, clientY: 5, pointerType: 'mouse' } as never);
    expect(pick).toHaveBeenLastCalledWith(0, 0, 0, 0);
  });

  it('draws a tooltip with a dot or a shaded band, on the side that fits', () => {
    const el = document.createElement('div');
    render(
      pickTooltip({
        x: 0.9,
        y: 0.5,
        plotWidth: 400,
        title: 'Head',
        rows: [{ name: 'A', value: '1', color: 'red' }],
        dot: 'red',
      }),
      el,
    );
    expect(el.querySelector('.tooltip')!.classList.contains('left')).toBe(true);
    expect(el.querySelector('.hover-dot')).not.toBeNull();
    expect(el.querySelector('.tooltip-time')!.textContent).toBe('Head');
    render(
      pickTooltip({ x: 0.1, y: 2, plotWidth: 400, title: 'B', rows: [{ name: 'n', value: 'v' }], band: [0, 0.2] }),
      el,
    );
    expect(el.querySelector('.pick-band')).not.toBeNull();
    expect(el.querySelector('.hover-dot')).toBeNull();
    expect(el.querySelector('.swatch')).toBeNull();
    render(pickTooltip({ x: 2, y: 0, plotWidth: 400, title: 'C', rows: [] }), el);
    expect(el.querySelector('.tooltip')).toBeNull();
  });
});
