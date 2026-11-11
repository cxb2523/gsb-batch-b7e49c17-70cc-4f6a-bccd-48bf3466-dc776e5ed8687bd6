import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  FULL,
  clampWindow,
  isZoomed,
  minZoomMs,
  panBy,
  pinchWindow,
  selectWindow,
  visiblePoints,
  windowRange,
  zoomAt,
} from '../src/chart/zoom';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

const close = (w: { from: number; to: number }, from: number, to: number) => {
  expect(w.from).toBeCloseTo(from, 6);
  expect(w.to).toBeCloseTo(to, 6);
};

describe('zoom maths', () => {
  it('keeps a window inside the span and no narrower than the least', () => {
    close(clampWindow({ from: -0.2, to: 0.3 }, 0.1), 0, 0.5);
    close(clampWindow({ from: 0.9, to: 1.2 }, 0.1), 0.7, 1);
    close(clampWindow({ from: 0.5, to: 0.5 }, 0.1), 0.5, 0.6);
    close(clampWindow({ from: 0.2, to: 3 }, 0.1), 0, 1);
    close(clampWindow({ from: NaN, to: NaN }, 0.1), 0, 1);
    expect(isZoomed(FULL)).toBe(false);
    expect(isZoomed({ from: 0, to: 0.99 })).toBe(true);
  });

  it('zooms about the pointer, so the time under it stays put', () => {
    const w = zoomAt(FULL, 0.25, 2, 0.01);
    close(w, 0.125, 0.625);
    // The point a quarter across was at 0.25 of the span and still is.
    expect(w.from + 0.25 * (w.to - w.from)).toBeCloseTo(0.25);
    close(zoomAt(w, 0.5, 0.25, 0.01), 0, 1);
    close(zoomAt(FULL, 0.5, 1000, 0.1), 0.45, 0.55);
  });

  it('pans a window, stopping at either end', () => {
    close(panBy({ from: 0.2, to: 0.4 }, 0.1), 0.3, 0.5);
    close(panBy({ from: 0.2, to: 0.4 }, -1), 0, 0.2);
    close(panBy({ from: 0.2, to: 0.4 }, 5), 0.8, 1);
  });

  it('pinches: the moments under each finger stay under them', () => {
    // Fingers at 0.4 and 0.6 of the whole span spread to 0.2 and 0.8: three times closer in.
    const w = pinchWindow(FULL, [0.4, 0.6], [0.2, 0.8], 0.01);
    close(w, 1 / 3, 2 / 3);
    // Fingers moving together sideways pan.
    close(pinchWindow({ from: 0.4, to: 0.6 }, [0.2, 0.8], [0.3, 0.9], 0.01), 0.38, 0.58);
    // Fingers that meet keep the zoom and follow their middle.
    close(pinchWindow({ from: 0.4, to: 0.6 }, [0.4, 0.6], [0.6, 0.605], 0.01), 0.3795, 0.5795);
    close(pinchWindow(FULL, [0.5, 0.5], [0.1, 0.9], 0.01), 0, 1);
  });

  it('turns a drag into a window, widening one that is too narrow', () => {
    close(selectWindow({ from: 0.5, to: 1 }, 0.8, 0.2, 0.01), 0.6, 0.9);
    close(selectWindow(FULL, 0.5, 0.5, 0.1), 0.45, 0.55);
  });

  it('finds the times on show and the points they need', () => {
    expect(windowRange({ start: 1000, end: 2000 }, { from: 0.25, to: 0.5 })).toEqual({ start: 1250, end: 1500 });
    const pts = [0, 10, 20, 30, 40].map((t) => ({ t, v: t }));
    expect(visiblePoints(pts, { start: 12, end: 28 }).map((p) => p.t)).toEqual([10, 20, 30]);
    expect(visiblePoints(pts, { start: 20, end: 20 }).map((p) => p.t)).toEqual([10, 20, 30]);
    expect(visiblePoints(pts, { start: -5, end: 50 })).toBe(pts);
    expect(visiblePoints([], { start: 0, end: 1 })).toEqual([]);
    // A group from 10 to 19 is still in view at 15.
    const groups = [0, 10, 20].map((t) => ({ t, v: 1, end: t + 10 }));
    expect(visiblePoints(groups, { start: 15, end: 16 }).map((p) => p.t)).toEqual([0, 10, 20]);
    expect(minZoomMs({ group: undefined })).toBe(300_000);
    expect(minZoomMs({ group: { unit: 'day', aggregate: 'mean' } })).toBe(2 * 86_400_000);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass() {
  const h = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  const rows = (base: number) =>
    Array.from({ length: 24 }, (_, i) => ({ s: String(base + (i % 5)), lu: sec((24 - i) * H - 60_000) }));
  h.callWS = vi.fn(async () => ({ 'sensor.in': rows(18), 'sensor.out': rows(4) })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown> = {}) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    zoom: true,
    ...extra,
  } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel) as HTMLElement;
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

/** Make `el` 1000 px wide, so a fraction across is `frac * 1000` px. */
function sized(el: Element) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  return el;
}

function pointer(el: Element, type: string, frac: number, opts: { id?: number; kind?: string; button?: number } = {}) {
  sized(el);
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: frac * 1000, button: opts.button ?? 0 });
  Object.defineProperty(ev, 'pointerType', { value: opts.kind ?? 'mouse' });
  Object.defineProperty(ev, 'pointerId', { value: opts.id ?? 1 });
  el.dispatchEvent(ev);
  return ev;
}

function wheel(el: Element, frac: number, init: WheelEventInit) {
  sized(el);
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: frac * 1000, ...init });
  el.dispatchEvent(ev);
  return ev;
}

const timeLabels = (card: Card) => qa(card, '.x-axis .axis-label').map((e) => e.textContent);
const windowStyle = (card: Card) => q(card, '.overview-window').getAttribute('style');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('zoom on the line chart', () => {
  it('zooms with Ctrl + scroll about the pointer, and resets with the button or a double click', async () => {
    const card = await mount({ overview: true });
    const area = q(card, '.plot-area');
    expect(area.classList.contains('zoomable')).toBe(true);
    expect(q(card, '.zoom-reset')).toBeNull();
    const before = timeLabels(card);
    const line = q(card, 'path.line').getAttribute('d');
    // A plain scroll is the page's.
    expect(wheel(area, 0.5, { deltaY: -100 }).defaultPrevented).toBe(false);
    expect(wheel(area, 0.75, { deltaY: -200, ctrlKey: true }).defaultPrevented).toBe(true);
    await card.updateComplete;
    expect(q(card, '.zoom-reset')).not.toBeNull();
    expect(area.classList.contains('zoomed')).toBe(true);
    expect(timeLabels(card)).not.toEqual(before);
    expect(q(card, 'path.line').getAttribute('d')).not.toBe(line);
    expect(windowStyle(card)).not.toMatch(/left:0%;width:100%/);
    q(card, '.zoom-reset').click();
    await card.updateComplete;
    expect(q(card, '.zoom-reset')).toBeNull();
    expect(windowStyle(card)).toMatch(/left:0%;width:100%/);
    wheel(area, 0.5, { deltaY: -3, deltaMode: 1, metaKey: true });
    await card.updateComplete;
    expect(q(card, '.zoom-reset')).not.toBeNull();
    area.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.zoom-reset')).toBeNull();
  });

  it('drags to choose a span, then drags to pan it, and scrolls sideways', async () => {
    const card = await mount({ overview: true });
    const area = q(card, '.plot-area');
    pointer(area, 'pointerdown', 0.25);
    pointer(area, 'pointermove', 0.251);
    await card.updateComplete;
    expect(q(card, '.zoom-select')).toBeNull();
    expect(q(card, '.tooltip')).not.toBeNull();
    pointer(area, 'pointermove', 0.5);
    // Leaving mid-drag doesn't end it.
    pointer(area, 'pointerleave', 0.6);
    await card.updateComplete;
    expect(q(card, '.zoom-select')!.getAttribute('style')).toBe('left:25%;width:25%');
    expect(q(card, '.tooltip')).toBeNull();
    pointer(area, 'pointerup', 0.5);
    await card.updateComplete;
    expect(q(card, '.zoom-select')).toBeNull();
    expect(windowStyle(card)).toBe('left:25%;width:25%');
    // Zoomed, a drag pans: 10% of the plot to the left moves on by 10% of the window.
    pointer(area, 'pointerdown', 0.5);
    pointer(area, 'pointermove', 0.4);
    pointer(area, 'pointerup', 0.4);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:27.5%;width:25%');
    // Sideways scroll (or Shift + scroll) pans too.
    expect(wheel(area, 0.5, { deltaX: 400 }).defaultPrevented).toBe(true);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:37.5%;width:25%');
    wheel(area, 0.5, { deltaY: -400, shiftKey: true });
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:27.5%;width:25%');
    // A right-button press, and a plain click, don't zoom.
    pointer(area, 'pointerdown', 0.1, { button: 2 });
    pointer(area, 'pointerup', 0.1, { button: 2 });
    pointer(area, 'pointerdown', 0.1);
    pointer(area, 'pointerup', 0.1);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:27.5%;width:25%');
  });

  it('pinches with two fingers and double-taps back', async () => {
    const card = await mount({ overview: true });
    const area = q(card, '.plot-area');
    pointer(area, 'pointerdown', 0.4, { id: 1, kind: 'touch' });
    await card.updateComplete;
    expect(q(card, '.tooltip')).not.toBeNull();
    pointer(area, 'pointerdown', 0.6, { id: 2, kind: 'touch' });
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
    // A third finger is ignored.
    pointer(area, 'pointerdown', 0.9, { id: 3, kind: 'touch' });
    pointer(area, 'pointercancel', 0.9, { id: 3, kind: 'touch' });
    pointer(area, 'pointermove', 0.2, { id: 1, kind: 'touch' });
    pointer(area, 'pointermove', 0.8, { id: 2, kind: 'touch' });
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:33.33%;width:33.33%');
    pointer(area, 'pointerup', 0.8, { id: 2, kind: 'touch' });
    pointer(area, 'pointermove', 0.1, { id: 1, kind: 'touch' });
    pointer(area, 'pointerup', 0.1, { id: 1, kind: 'touch' });
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:33.33%;width:33.33%');
    pointer(area, 'pointerdown', 0.5, { id: 4, kind: 'touch' });
    pointer(area, 'pointerup', 0.5, { id: 4, kind: 'touch' });
    pointer(area, 'pointerleave', 0.5, { id: 4, kind: 'touch' });
    pointer(area, 'pointerdown', 0.51, { id: 5, kind: 'touch' });
    pointer(area, 'pointerup', 0.51, { id: 5, kind: 'touch' });
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:0%;width:100%');
  });

  it('moves, resizes and redraws the window on the overview strip, and by keyboard', async () => {
    const card = await mount({ zoom: false, overview: true });
    expect(q(card, '.plot-area').classList.contains('zoomable')).toBe(false);
    const strip = q(card, '.overview');
    expect(qa(card, '.overview-lines path')).toHaveLength(2);
    // Across the strip: a new window.
    pointer(strip, 'pointerdown', 0.2);
    pointer(strip, 'pointermove', 0.6);
    pointer(strip, 'pointerup', 0.6);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:20%;width:40%');
    expect(q(card, '.overview').classList.contains('zoomed')).toBe(true);
    // Its middle moves it; its edges resize it.
    pointer(strip, 'pointerdown', 0.4);
    pointer(strip, 'pointermove', 0.5);
    pointer(strip, 'pointerup', 0.5);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:30%;width:40%');
    pointer(strip, 'pointerdown', 0.7);
    pointer(strip, 'pointermove', 0.9);
    pointer(strip, 'pointerup', 0.9);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:30%;width:60%');
    pointer(strip, 'pointerdown', 0.3);
    pointer(strip, 'pointermove', 0.5);
    pointer(strip, 'pointerup', 0.5);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:50%;width:40%');
    // A tap beside it centres it there; a moving pointer with nothing pressed does nothing.
    pointer(strip, 'pointermove', 0.1);
    pointer(strip, 'pointerdown', 0.2);
    pointer(strip, 'pointerup', 0.2);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:0%;width:40%');
    pointer(strip, 'pointerup', 0.2);
    const win = q(card, '.overview-window');
    expect(win.getAttribute('aria-valuetext')).toMatch(/^Shown: .+ to .+/);
    const key = (k: string) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      win.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(key('ArrowRight')).toBe(true);
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:10%;width:40%');
    key('ArrowUp');
    await card.updateComplete;
    expect(windowStyle(card)).toMatch(/width:26.67%/);
    key('-');
    key('End');
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:60%;width:40%');
    for (const k of ['ArrowLeft', 'ArrowDown', '+', '=', 'Home']) key(k);
    expect(key('a')).toBe(false);
    key('Escape');
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:0%;width:100%');
    // A right-button press on the strip is ignored; a double click resets.
    pointer(strip, 'pointerdown', 0.2, { button: 2 });
    pointer(strip, 'pointermove', 0.6, { button: 2 });
    pointer(strip, 'pointerdown', 0.2);
    pointer(strip, 'pointermove', 0.6);
    pointer(strip, 'pointercancel', 0.6);
    await card.updateComplete;
    strip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await card.updateComplete;
    expect(windowStyle(card)).toBe('left:0%;width:100%');
  });

  it('starts again from the whole span after previous / next, and when switched off', async () => {
    const card = await mount({ period: { last: 24, unit: 'hour', navigate: true }, overview: true });
    wheel(q(card, '.plot-area'), 0.5, { deltaY: -200, ctrlKey: true });
    await card.updateComplete;
    expect(q(card, '.zoom-reset')).not.toBeNull();
    q(card, '.period-prev').click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    expect(q(card, '.zoom-reset')).toBeNull();
    const off = await mount({ zoom: false });
    expect(q(off, '.overview')).toBeNull();
    expect(q(off, '.plot-area').classList.contains('zoomable')).toBe(false);
  });

  it('checks its options, and forgets the zoom when it leaves the page', async () => {
    const card = await mount();
    expect(() =>
      card.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], zoom: 'yes' } as unknown as CardConfig),
    ).toThrow('"zoom" must be true or false');
    expect(() =>
      card.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], overview: 1 } as unknown as CardConfig),
    ).toThrow('"overview" must be true or false');
    card.remove();
  });
});

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of [
  'ha-form',
  'ha-expansion-panel',
  'ha-selector',
  'ha-entity-picker',
  'ha-icon-picker',
  'ha-icon-button',
  'ha-switch',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}

describe('zoom in the editor', () => {
  it('sets zoom and the overview strip from the Chart section', async () => {
    await import('../src/editor/chartdeck-card-editor');
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const names = JSON.stringify(form.schema);
    expect(names).toContain('"zoom"');
    expect(names).toContain('"overview"');
    expect((form.data as Record<string, unknown>).zoom).toBe(false);
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), zoom: true, overview: true } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, zoom: true, overview: true });
  });
});
