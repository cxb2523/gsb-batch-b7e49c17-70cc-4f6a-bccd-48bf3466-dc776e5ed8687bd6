import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { nearestIndex, snapTime, TOUCH_LINGER_MS, tooltipSide } from '../src/chart/tooltip';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

describe('nearest reading', () => {
  const pts = [{ t: 0 }, { t: 10 }, { t: 20 }, { t: 40 }];

  it('finds the point nearest in time by binary search', () => {
    expect(nearestIndex([], 5)).toBe(-1);
    expect(nearestIndex(pts, -100)).toBe(0);
    expect(nearestIndex(pts, 0)).toBe(0);
    expect(nearestIndex(pts, 4)).toBe(0);
    expect(nearestIndex(pts, 5)).toBe(0);
    expect(nearestIndex(pts, 6)).toBe(1);
    expect(nearestIndex(pts, 29)).toBe(2);
    expect(nearestIndex(pts, 31)).toBe(3);
    expect(nearestIndex(pts, 1000)).toBe(3);
    expect(nearestIndex([{ t: 7 }], 0)).toBe(0);
  });

  it('snaps to the nearest reading across every series', () => {
    const a = [
      { t: 0, v: 1 },
      { t: 30, v: 2 },
    ];
    const b = [{ t: 12, v: 5 }];
    expect(snapTime([a, b], 14)).toBe(12);
    expect(snapTime([a, b], 25)).toBe(30);
    expect(snapTime([[], []], 25)).toBeUndefined();
  });

  it('puts the box on whichever side of the guide it fits', () => {
    expect(tooltipSide(0.2, 500)).toBe('right');
    expect(tooltipSide(0.9, 500)).toBe('left');
    expect(tooltipSide(0.6, 250)).toBe('pin-left');
    expect(tooltipSide(0.4, 250)).toBe('pin-right');
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
// The chart's span ends at the moment it renders, and the fixture is relative to the moment the
// file loads. On a busy machine seconds pass between the two, so a reading 12 h old lands just
// short of half way. Pin the clock; only Date is faked, timers stay real.
const now = new Date(2026, 10, 7, 15, 0, 0).getTime();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass() {
  const h = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  h.callWS = vi.fn(async () => ({
    'sensor.in': [
      { s: '19', lu: sec(20 * H) },
      { s: '20.25', lu: sec(12 * H) },
      { s: 'unavailable', lu: sec(8 * H) },
      { s: '21', lu: sec(2 * H) },
    ],
    'sensor.out': [{ s: '5', lu: sec(20 * H) }],
  })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown> = {}) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    ...extra,
  } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

/** A pointer event at `frac` of the way across a 1000 px plot. */
function point(el: Element, type: string, frac: number, pointerType = 'mouse') {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: frac * 1000 });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('hover tooltip', () => {
  it('follows the pointer with a guide, a dot per series and each value', async () => {
    const card = await mount();
    const area = q(card, '.plot-area')!;
    expect(area.classList.contains('hoverable')).toBe(true);
    expect(q(card, '.tooltip')).toBeNull();
    // 12 h ago is half way across a 24 h chart.
    point(area, 'pointermove', 0.5);
    await card.updateComplete;
    expect(q(card, '.crosshair')!.getAttribute('style')).toMatch(/left:50%/);
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Inside 20.3 °C', 'Outside 5.0 °C']);
    expect(qa(card, '.hover-dot')).toHaveLength(2);
    expect(q(card, '.tooltip-time')!.textContent).toMatch(/\d/);
    // In the unavailable stretch the entity has no value.
    point(area, 'pointermove', 1 - 7.5 / 24);
    await card.updateComplete;
    expect(qa(card, '.tooltip-value').map((e) => e.textContent)).toEqual(['—', '5.0 °C']);
    expect(qa(card, '.hover-dot')).toHaveLength(1);
    point(area, 'pointerleave', 0.5);
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
  });

  it('stays up for a moment after a finger lifts, then goes', async () => {
    const card = await mount();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now });
    const area = q(card, '.plot-area')!;
    point(area, 'pointerdown', 0.2, 'touch');
    point(area, 'pointerleave', 0.2, 'touch');
    await card.updateComplete;
    expect(q(card, '.tooltip')).not.toBeNull();
    point(area, 'pointermove', 0.25, 'touch');
    point(area, 'pointercancel', 0.25, 'touch');
    vi.advanceTimersByTime(TOUCH_LINGER_MS);
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
    card.remove();
  });

  it('does not fire the header actions, and can be turned off', async () => {
    const card = await mount();
    const fired: unknown[] = [];
    card.addEventListener('hass-action', (e) => fired.push(e));
    const area = q(card, '.plot-area')!;
    point(area, 'pointerdown', 0.5);
    area.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toHaveLength(0);
    const off = await mount({ tooltip: false });
    expect(q(off, '.plot-area')!.classList.contains('hoverable')).toBe(false);
    point(q(off, '.plot-area')!, 'pointermove', 0.5);
    await off.updateComplete;
    expect(q(off, '.tooltip')).toBeNull();
    expect(() => off.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], tooltip: 'yes' } as never)).toThrow(
      '"tooltip" must be true or false',
    );
  });
});
