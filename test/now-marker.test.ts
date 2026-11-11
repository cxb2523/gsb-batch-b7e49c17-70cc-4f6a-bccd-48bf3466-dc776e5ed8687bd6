import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  labelSide,
  markLabelBoxes,
  nextMark,
  nowInView,
  nowLabel,
  nowMarkerOf,
  stopNowMarker,
  tickNowMarker,
  validateNowMarker,
} from '../src/chart/now-marker';
import { NOW_MARKER_FIELDS, nowMarkerSchema } from '../src/editor/now-marker-editor';
import type { ChartContext } from '../src/styles/index';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';
import { stubEditorElements } from './helpers/chart';
import type { Stub } from './helpers/chart';

stubEditorElements();
await import('../src/editor/chartdeck-card-editor');

const M = 60_000;
const H = 3_600_000;
const zone = { timeZone: 'UTC', firstDay: 1 };
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');

describe('now marker options', () => {
  it('accepts its modes and explains a bad one', () => {
    for (const v of [undefined, 'off', 'line', 'time', 'countdown']) {
      expect(() => validateNowMarker({ type: 'x', now_marker: v } as CardConfig)).not.toThrow();
    }
    expect(() => validateNowMarker({ type: 'x', now_marker: true } as unknown as CardConfig)).toThrow(
      '"now_marker" must be one of: off, line, time, countdown',
    );
    expect(nowMarkerOf({ type: 'x' } as CardConfig)).toBe('off');
    expect(nowMarkerOf({ type: 'x', now_marker: 'time' } as CardConfig)).toBe('time');
  });

  it('shows only when the present is inside the span, clear of its end', () => {
    expect(nowInView({ start: 0, end: 1000 }, 500)).toBe(true);
    expect(nowInView({ start: 0, end: 1000 }, 999)).toBe(false);
    expect(nowInView({ start: 0, end: 1000 }, 0)).toBe(false);
    expect(nowInView({ start: 0, end: 1000 }, 2000)).toBe(false);
  });
});

describe('countdown', () => {
  const now = Date.UTC(2026, 10, 8, 14, 48);
  const raw = (annotations: unknown[]) => ({ type: 'x', annotations }) as CardConfig;

  it('finds the next set time any time annotation marks', () => {
    const r = raw([
      { type: 'time', times: ['16:00', '07:30'], label: 'Peak rate' },
      { type: 'time', times: ['15:30'] },
      { type: 'line', value: 3 },
    ]);
    expect(nextMark(r, now, zone)).toEqual({ t: Date.UTC(2026, 10, 8, 15, 30), label: undefined });
    // Past today's last mark, the next is tomorrow's first.
    expect(nextMark(r, Date.UTC(2026, 10, 8, 23, 0), zone)).toEqual({
      t: Date.UTC(2026, 10, 9, 7, 30),
      label: 'Peak rate',
    });
    expect(nextMark(raw([{ type: 'time', times: ['2026-11-01 07:00'] }]), now, zone)).toBeUndefined();
    expect(nextMark({ type: 'x' } as CardConfig, now, zone)).toBeUndefined();
  });

  it('counts down in hours and minutes, rounded up, else gives the time', () => {
    const r = raw([{ type: 'time', times: ['16:00'], label: 'Peak rate' }]);
    expect(nowLabel('countdown', r, now, zone, undefined)).toBe('Peak rate in 1 h 12 m');
    expect(nowLabel('countdown', r, Date.UTC(2026, 10, 8, 15, 59, 30), zone, undefined)).toBe('Peak rate in 1 m');
    expect(nowLabel('countdown', raw([{ type: 'time', times: ['16:00'] }]), now, zone, undefined)).toBe(
      'Next in 1 h 12 m',
    );
    expect(nowLabel('countdown', raw([]), now, zone, undefined)).toMatch(/\d{1,2}:48/);
    expect(nowLabel('time', r, now, zone, undefined)).toMatch(/\d{1,2}:48/);
    expect(nowLabel('line', r, now, zone, undefined)).toBe('');
  });
});

describe('minute timer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one timer per card, redraws at the next minute, and stops on request', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const ctx = { host, requestUpdate: vi.fn() } as unknown as ChartContext;
    const now = Date.UTC(2026, 10, 8, 14, 48, 20);
    tickNowMarker(ctx, now);
    tickNowMarker(ctx, now);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(39_000);
    expect(ctx.requestUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_100);
    expect(ctx.requestUpdate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    tickNowMarker(ctx, now);
    stopNowMarker(host);
    expect(vi.getTimerCount()).toBe(0);
    stopNowMarker(host);
  });

  it('waits for a visible tab', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const ctx = { host, requestUpdate: vi.fn() } as unknown as ChartContext;
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    tickNowMarker(ctx, Date.UTC(2026, 10, 8, 14, 48));
    vi.advanceTimersByTime(M + 100);
    expect(ctx.requestUpdate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    hidden.mockRestore();
    vi.advanceTimersByTime(M + 100);
    expect(ctx.requestUpdate).toHaveBeenCalledTimes(1);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();

function hass() {
  const h = makeHass({ 'sensor.rate': ['24', { friendly_name: 'Rate', unit_of_measurement: 'p' }] });
  h.callWS = vi.fn(async () => ({
    'sensor.rate': [
      { s: '7', lu: (now - 40 * 86_400_000) / 1000 },
      { s: '24', lu: (now - 2 * H) / 1000 },
    ],
  })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.rate'],
    period: { calendar: 'month', until: 'end' },
    ...extra,
  } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  for (let i = 0; i < 3; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel) as HTMLElement | null;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('now marker on charts', () => {
  it('draws a line with a countdown to the next set time on a span that runs past now', async () => {
    const card = await mount({
      now_marker: 'countdown',
      annotations: [{ type: 'time', times: [iso(now + 72 * M)], label: 'Peak rate' }],
    });
    const marker = q(card, '.now-marker');
    expect(marker).not.toBeNull();
    expect(parseFloat(marker!.style.left)).toBeGreaterThan(0);
    expect(parseFloat(marker!.style.left)).toBeLessThan(100);
    expect(q(card, '.now-label')!.textContent).toBe('Peak rate in 1 h 12 m');
    card.remove();
  });

  it('draws a bare line, and nothing when off or on a rolling span', async () => {
    let card = await mount({ now_marker: 'line' });
    expect(q(card, '.now-marker')).not.toBeNull();
    expect(q(card, '.now-label')).toBeNull();
    card.remove();
    card = await mount({});
    expect(q(card, '.now-marker')).toBeNull();
    card.remove();
    card = await mount({ now_marker: 'time', period: { last: 24, unit: 'hour' } });
    expect(q(card, '.now-marker')).toBeNull();
    card.remove();
  });

  it('marks now inside the current group on a column chart', async () => {
    const card = await mount({ style: 'column', now_marker: 'time', period: { last: 7, unit: 'day' } });
    expect(q(card, '.now-marker')).not.toBeNull();
    expect(q(card, '.now-label')!.textContent).toMatch(/\d:\d\d/);
    card.remove();
  });
});

describe('now marker in the editor', () => {
  it('is a dropdown in the line and column chart sections', async () => {
    expect(NOW_MARKER_FIELDS[0]).toMatchObject({ name: 'now_marker', default: 'off' });
    expect(nowMarkerSchema(undefined)[0].selector.select.options.map((o) => o.value)).toEqual([
      'off',
      'line',
      'time',
      'countdown',
    ]);
    for (const style of ['line', 'column']) {
      const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
        setConfig(c: CardConfig): void;
        hass?: unknown;
        updateComplete: Promise<boolean>;
      };
      const events: CardConfig[] = [];
      ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
      ed.hass = makeHass({});
      ed.setConfig({ type: 'custom:chartdeck-card', style, entities: ['sensor.rate'] } as CardConfig);
      document.body.appendChild(ed);
      await ed.updateComplete;
      const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
      expect((form.data as Record<string, unknown>).now_marker).toBe('off');
      form.dispatchEvent(
        new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), now_marker: 'countdown' } } }),
      );
      expect(events.at(-1)!.now_marker).toBe('countdown');
      ed.remove();
    }
  });
});

describe('now marker beside a time annotation', () => {
  // Today at 11:57 on a 600 px plot, with "Night rate" marked at 21:00.
  const day = Date.UTC(2026, 10, 9);
  const view = { start: day, end: day + 24 * H };
  const raw = { type: 'x', annotations: [{ type: 'time', times: ['21:00'], label: 'Night rate' }] } as CardConfig;
  const x = (t: number) => ((t - view.start) / (view.end - view.start)) * 1000;
  const width = 600;

  it('finds where the annotation labels sit', () => {
    const [box] = markLabelBoxes(raw, view, zone, x, width);
    expect(box[0]).toBeCloseTo(width * (21 / 24) + 2, 5);
    expect(markLabelBoxes({ type: 'x' } as CardConfig, view, zone, x, width)).toEqual([]);
    // One that would run off the right edge ends at its line instead.
    const late = { type: 'x', annotations: [{ type: 'time', times: ['23:30'], label: 'Night rate' }] } as CardConfig;
    const [end] = markLabelBoxes(late, view, zone, x, width);
    expect(end[1]).toBeCloseTo(width * (23.5 / 24) - 2, 5);
  });

  it('puts the label left of the line when it would touch an annotation label, else right', () => {
    const at = width * ((11 + 57 / 60) / 24);
    const boxes = markLabelBoxes(raw, view, zone, x, width);
    // A pill that would run right up to "Night rate" goes on the left.
    expect(labelSide(at, boxes[0][0] - at - 8, width, boxes)).toBe('end');
    // A short label clears it, and stays on the right.
    expect(labelSide(at, 40, width, boxes)).toBe('start');
    // Near the right edge it flips, as before; with no room left either, it keeps to where it fits.
    expect(labelSide(width - 20, 60, width, [])).toBe('end');
    expect(labelSide(10, 130, width, [[150, 200]])).toBe('start');
    expect(labelSide(130, 130, width, [[0, 300]])).toBe('start');
  });

  it('draws the countdown pill clear of its target label on a card', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 9, 11, 57)));
    try {
      const h = makeHass({ 'sensor.rate': ['24', { friendly_name: 'Rate', unit_of_measurement: 'W' }] }, {
        config: { time_zone: 'UTC' },
        locale: { language: 'en', number_format: 'language', time_zone: 'server' },
      } as Partial<HomeAssistant>);
      h.callWS = vi.fn(async () => ({
        'sensor.rate': [{ s: '24', lu: (Date.now() - 30 * H) / 1000 }],
      })) as HomeAssistant['callWS'];
      const card = document.createElement('chartdeck-card') as Card;
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'line',
        entities: ['sensor.rate'],
        period: { calendar: 'day', until: 'end' },
        now_marker: 'countdown',
        annotations: [{ type: 'time', times: ['21:00'], label: 'Night rate' }],
      } as CardConfig);
      card.hass = h;
      document.body.appendChild(card);
      for (let i = 0; i < 3; i++) {
        await card.updateComplete;
        await new Promise((r) => setTimeout(r, 0));
      }
      const label = q(card, '.now-label')!;
      expect(label.textContent).toBe('Night rate in 9 h 3 m');
      expect(label.classList.contains('end')).toBe(true);
      stopNowMarker(card);
    } finally {
      vi.useRealTimers();
    }
  });
});
