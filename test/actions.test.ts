import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachActions, isInteractive } from '../src/actions';
import type { ActionConfig } from '../src/types';

const none: ActionConfig = { action: 'none' };
const more: ActionConfig = { action: 'more-info' };
const mk = (o: Partial<Record<'tap_action' | 'hold_action' | 'double_tap_action', ActionConfig>> = {}) => ({
  entity: 'sensor.a',
  tap_action: more,
  hold_action: none,
  double_tap_action: none,
  ...o,
});

const ptr = (el: HTMLElement, type: string, x = 0, y = 0) =>
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

describe('actions', () => {
  let el: HTMLDivElement;
  let seen: string[];
  let detach: () => void;
  const setup = (cfg: ReturnType<typeof mk>) => {
    detach = attachActions(el, () => cfg);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    el = document.createElement('div');
    seen = [];
    el.addEventListener('hass-action', (e) => seen.push((e as CustomEvent).detail.action));
  });
  afterEach(() => {
    detach?.();
    vi.useRealTimers();
  });

  it('fires tap immediately when no double-tap action', () => {
    setup(mk());
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    expect(seen).toEqual(['tap']);
  });

  it('includes the entity config, bubbles and is composed', () => {
    const cfg = mk();
    setup(cfg);
    const parent = document.createElement('div');
    parent.appendChild(el);
    let ev: CustomEvent | undefined;
    parent.addEventListener('hass-action', (e) => (ev = e as CustomEvent));
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    expect(ev?.detail.config).toBe(cfg);
    expect(ev?.composed).toBe(true);
  });

  it('waits 250 ms and fires double_tap on two quick taps', () => {
    setup(mk({ double_tap_action: more }));
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    vi.advanceTimersByTime(100);
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['double_tap']);
  });

  it('fires tap after 250 ms when double-tap is configured but only one tap', () => {
    setup(mk({ double_tap_action: more }));
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    vi.advanceTimersByTime(249);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['tap']);
  });

  it('fires hold after 500 ms and no tap on release', () => {
    setup(mk({ hold_action: more }));
    ptr(el, 'pointerdown');
    vi.advanceTimersByTime(500);
    ptr(el, 'pointerup');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['hold']);
  });

  it('cancels hold when the pointer moves more than 10 px', () => {
    setup(mk({ hold_action: more }));
    ptr(el, 'pointerdown', 0, 0);
    ptr(el, 'pointermove', 11, 0);
    vi.advanceTimersByTime(600);
    ptr(el, 'pointerup', 11, 0);
    expect(seen).toEqual([]);
  });

  it('keeps hold when movement stays within 10 px', () => {
    setup(mk({ hold_action: more }));
    ptr(el, 'pointerdown', 0, 0);
    ptr(el, 'pointermove', 5, 5);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['hold']);
  });

  it('cancels hold on pointercancel and pointerleave', () => {
    setup(mk({ hold_action: more }));
    ptr(el, 'pointerdown');
    ptr(el, 'pointercancel');
    vi.advanceTimersByTime(600);
    ptr(el, 'pointerdown');
    ptr(el, 'pointerleave');
    vi.advanceTimersByTime(600);
    ptr(el, 'pointerup');
    expect(seen).toEqual([]);
  });

  it('fires tap on Enter and Space', () => {
    setup(mk());
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(seen).toEqual(['tap', 'tap']);
  });

  it('ignores auto-repeated keydown', () => {
    setup(mk());
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
    expect(seen).toEqual(['tap']);
  });

  it('ignores non-primary pointer buttons', () => {
    setup(mk({ hold_action: more }));
    el.dispatchEvent(new MouseEvent('pointerdown', { button: 2 }));
    el.dispatchEvent(new MouseEvent('pointerup', { button: 2 }));
    el.dispatchEvent(new MouseEvent('pointerdown', { button: 1 }));
    vi.advanceTimersByTime(600);
    el.dispatchEvent(new MouseEvent('pointerup', { button: 1 }));
    expect(seen).toEqual([]);
  });

  it('suppresses the context menu only when a hold action is set', () => {
    setup(mk({ hold_action: more }));
    const withHold = new MouseEvent('contextmenu', { cancelable: true });
    el.dispatchEvent(withHold);
    expect(withHold.defaultPrevented).toBe(true);
    detach();

    setup(mk());
    const without = new MouseEvent('contextmenu', { cancelable: true });
    el.dispatchEvent(without);
    expect(without.defaultPrevented).toBe(false);
  });

  it('fires nothing for action none', () => {
    setup(mk({ tap_action: none }));
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it('stops listening after detach', () => {
    setup(mk());
    detach();
    ptr(el, 'pointerdown');
    ptr(el, 'pointerup');
    expect(seen).toEqual([]);
  });

  it('isInteractive is true when any action is not none', () => {
    expect(isInteractive(mk({ tap_action: none }))).toBe(false);
    expect(isInteractive(mk({ tap_action: none, hold_action: more }))).toBe(true);
    expect(isInteractive(mk({ tap_action: none, double_tap_action: more }))).toBe(true);
    expect(isInteractive(mk())).toBe(true);
  });
});
