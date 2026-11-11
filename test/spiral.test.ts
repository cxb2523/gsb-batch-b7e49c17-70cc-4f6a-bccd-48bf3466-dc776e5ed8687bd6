import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  ringRadius,
  spiralGeometry,
  spiralPoint,
  spokes,
  stretchAt,
  stretchPath,
  turnAngle,
  turnUnder,
  turnsAt,
} from '../src/chart/spiral';
import { STYLES } from '../src/styles';
import { piecesOf, spiralLayout, spiralOptions, spiralRaw } from '../src/styles/spiral';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

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
await import('../src/editor/chartdeck-card-editor');

const H = 3_600_000;
const D = 24 * H;
const utc = { timeZone: 'UTC', firstDay: 1 };

describe('spiral maths', () => {
  it('counts turns as wall-clock days, or weeks from the first weekday', () => {
    const mon = Date.UTC(2024, 0, 1);
    expect(turnsAt(mon + 6 * H, 'day', utc) - turnsAt(mon, 'day', utc)).toBeCloseTo(0.25);
    expect(turnsAt(mon, 'day', utc) % 1).toBe(0);
    // A Monday is a whole number of weeks when weeks start on Monday, not when they start on Sunday.
    expect(turnsAt(mon, 'week', utc) % 1).toBeCloseTo(0);
    expect(turnsAt(mon, 'week', { timeZone: 'UTC', firstDay: 7 }) % 1).toBeCloseTo(1 / 7);
    expect(turnsAt(mon + 3.5 * D, 'week', utc) - turnsAt(mon, 'week', utc)).toBeCloseTo(0.5);
    // Midnight in Paris is 23:00 UTC the day before.
    expect(turnsAt(Date.UTC(2024, 0, 1, 23), 'day', { timeZone: 'Europe/Paris', firstDay: 1 }) % 1).toBe(0);
    // The day the clocks go forward still takes exactly one turn.
    const z = { timeZone: 'Europe/London', firstDay: 1 };
    const sat = Date.UTC(2024, 2, 30);
    const sun = Date.UTC(2024, 2, 31);
    const mon2 = Date.UTC(2024, 3, 1) - H;
    expect(turnsAt(sun, 'day', z) - turnsAt(sat, 'day', z)).toBe(1);
    expect(turnsAt(mon2, 'day', z) - turnsAt(sun, 'day', z)).toBe(1);
  });

  it('lays turns out from a hole in the middle to the edge', () => {
    const g = spiralGeometry(200, 7, 0.25, 0.8, 100);
    expect(g.hole).toBeCloseTo(16);
    expect(ringRadius(g, 0) - g.width / 2).toBeCloseTo(g.hole);
    expect(ringRadius(g, 7) + g.width / 2).toBeCloseTo(100);
    expect(g.width).toBeCloseTo(g.pitch * 0.8);
    // The start is a quarter of the way round: the right-hand side.
    const [x, y] = spiralPoint(g, ringRadius(g, 0), turnAngle(g, 0));
    expect(x).toBeGreaterThan(100);
    expect(y).toBeCloseTo(100);
    expect(spiralGeometry(200, 1.3, -0.25, 0.5).phase).toBeCloseTo(0.75);
  });

  it('outlines a stretch, and nothing for an empty one', () => {
    const g = spiralGeometry(200, 2, 0, 1);
    const d = stretchPath(g, 0, 0.5);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split('L').length).toBe(2 * 46);
    expect(stretchPath(g, 1, 1)).toBe('');
  });

  it('finds the turn under a point, and nothing between turns or in the middle', () => {
    const g = spiralGeometry(200, 4, 0.1, 0.6);
    for (const u of [0.05, 0.6, 1.3, 2.75, 3.9]) {
      const [x, y] = spiralPoint(g, ringRadius(g, u), turnAngle(g, u));
      expect(turnUnder(g, x, y)).toBeCloseTo(u);
    }
    expect(turnUnder(g, 100, 100)).toBeUndefined();
    const [x, y] = spiralPoint(g, ringRadius(g, 1.5) + g.pitch / 2, turnAngle(g, 1.5));
    expect(turnUnder(g, x, y)).toBeUndefined();
    expect(turnUnder(g, x, y, g.pitch)).toBeDefined();
  });

  it('finds the stretch under a turn', () => {
    const s = [
      { u0: 0, u1: 0.1 },
      { u0: 0.2, u1: 0.3 },
      { u0: 0.3, u1: 0.5 },
    ];
    expect(stretchAt(s, 0.05)).toBe(0);
    expect(stretchAt(s, 0.15)).toBeUndefined();
    expect(stretchAt(s, 0.3)).toBe(2);
    expect(stretchAt(s, 0.6)).toBeUndefined();
    expect(stretchAt([], 0)).toBeUndefined();
  });

  it('labels hours or weekdays round the outside', () => {
    expect(spokes('day')).toEqual([0, 0.25, 0.5, 0.75]);
    expect(spokes('day', 3)).toHaveLength(8);
    expect(spokes('week')).toHaveLength(7);
  });

  it('places groups on the spiral, leaving out gaps and what is after now', () => {
    const start = Date.UTC(2024, 0, 1);
    const pieces = piecesOf(
      [
        { t: start, v: 1, end: start + H },
        { t: start + H, v: null, end: start + 2 * H },
        { t: start + 2 * H, v: 3, end: start + 3 * H },
        { t: start + 3 * H, v: 4, end: start + 4 * H },
      ],
      start,
      start + 2.5 * H,
      'day',
      utc,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ u0: 0, v: 1 });
    expect(pieces[0].u1).toBeCloseTo(1 / 24);
    expect(pieces[1].end).toBe(start + 2.5 * H);
  });

  it('reads its options and sets the span from the turns', () => {
    expect(spiralOptions({} as CardConfig)).toEqual({ turn: 'day', turns: 7, ring: 0.8 });
    expect(spiralOptions({ turn: 'week', ring_width: 50 } as CardConfig)).toEqual({
      turn: 'week',
      turns: 4,
      ring: 0.5,
    });
    const raw = spiralRaw({
      turns: 3,
      period: { calendar: 'week', last: 9, offset: 2, navigate: true },
    } as unknown as CardConfig);
    expect(raw.group_by).toBe('hour');
    expect(raw.period).toEqual({ offset: 2, navigate: true, last: 3, unit: 'day' });
  });

  it('puts the legend beside the spiral on a wide card', () => {
    expect(spiralLayout(520)).toEqual({ px: 300, side: true });
    expect(spiralLayout(320)).toEqual({ px: 288, side: false });
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();

function hassWith(history: Record<string, unknown>) {
  const hass = makeHass({
    'sensor.power': ['300', { friendly_name: 'Power', unit_of_measurement: 'W' }],
    'sensor.gone': ['unavailable', { friendly_name: 'Gone' }],
  });
  hass.config = { time_zone: 'UTC' } as HomeAssistant['config'];
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

// A reading every 30 minutes for 8 days, higher in the evening.
const power = Array.from({ length: 8 * 48 }, (_, i) => {
  const t = now - 8 * D + i * 30 * 60_000;
  return { s: String(100 + 50 * (new Date(t).getUTCHours() >= 18 ? 4 : 1) + (i % 3)), lu: t / 1000 };
});
const history = { 'sensor.power': power, 'sensor.gone': [{ s: 'unavailable', lu: (now - 2 * D) / 1000 }] };

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'spiral',
    entities: ['sensor.power', 'sensor.gone'],
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('spiral chart', () => {
  it('draws a spiral per entity, an hour per stretch, with labels, legend and now', async () => {
    const card = await mount({});
    const spirals = qa(card, '.sp');
    expect(spirals).toHaveLength(2);
    const pieces = spirals[0].querySelectorAll('.sp-piece');
    // Seven days of hours, give or take the hour now is in.
    expect(pieces.length).toBeGreaterThanOrEqual(7 * 24 - 1);
    expect(pieces.length).toBeLessThanOrEqual(7 * 24 + 1);
    expect(new Set([...pieces].map((p) => p.getAttribute('style'))).size).toBeGreaterThan(2);
    expect(spirals[1].querySelectorAll('.sp-piece')).toHaveLength(0);
    expect(spirals[0].querySelector('svg')!.getAttribute('aria-label')).toBe('Spiral of Power, 7 turns');
    expect(qa(card, '.sp-labels text').slice(0, 4).map(text)).toEqual(['12 AM', '3 AM', '6 AM', '9 AM']);
    expect(text(spirals[0].querySelector('.sp-side')!)).toContain('7 days, one turn a day');
    expect(spirals[0].querySelector('.sp-legend.scale')).not.toBeNull();
    expect(spirals[0].querySelector('.sp-now')).not.toBeNull();
    expect(spirals[1].querySelector('.sp-now')).toBeNull();
    expect(spirals[0].querySelector('.entity.sp-pieces')!.getAttribute('data-index')).toBe('0');
  });

  it('turns once a week with weekday labels, colours by bands, and hides the legend', async () => {
    const card = await mount({ turn: 'week', turns: 1, entities: ['sensor.power'] } as Partial<CardConfig>);
    expect(qa(card, '.sp-labels text').map(text)).toHaveLength(7);
    expect(text(q(card, '.sp-side')!)).toContain('1 weeks, one turn a week');
    const bands = await mount({ color_by: 'bands', legend: false } as Partial<CardConfig>);
    expect(q(bands, '.sp-legend')).toBeNull();
    const banded = await mount({ color_by: 'bands' } as Partial<CardConfig>);
    expect(q(banded, '.sp-legend.bands')).not.toBeNull();
  });

  it('shows the hour and value of the stretch under the pointer', async () => {
    const card = await mount({ entities: ['sensor.power'] });
    const plot = q(card, '.sp-plot')!;
    plot.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }) as DOMRect;
    let found = false;
    for (let x = 101; x < 200 && !found; x += 1) {
      plot.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 100 }));
      await card.updateComplete;
      found = q(card, '.tooltip') !== null;
    }
    expect(found).toBe(true);
    expect(text(q(card, '.tooltip-row')!)).toMatch(/^Power [\d,.]+ W$/);
    expect(text(q(card, '.tooltip-time')!)).toMatch(/–/);
    expect(q(card, '.sp-picked')).not.toBeNull();
    plot.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
  });

  it('opens an entity from its spiral', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const el = q(card, '.sp-pieces')!;
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.power']);
  });

  it('says when there is nothing to draw', async () => {
    const card = await mount({}, hassWith({}));
    expect(q(card, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'spiral', entities: ['sensor.power'], ...extra } as CardConfig);
    expect(set({ turn: 'month' })).toThrow(/"turn" must be one of: day, week/);
    expect(set({ turns: 40 })).toThrow(/"turns" must be a whole number from 1 to 31/);
    expect(set({ turn: 'week', turns: 20 })).toThrow(/from 1 to 13/);
    expect(set({ ring_width: 5 })).toThrow(/"ring_width" must be a number from 20 to 100/);
    expect(set({ color_by: 'series' })).toThrow(/"color_by" must be one of: scale, bands/);
    expect(set({ color_min: 'x' })).toThrow(/"color_min" must be a number/);
    expect(set({ color_min: 5, color_max: 1 })).toThrow(/below/);
    expect(set({ legend: 'no' })).toThrow(/legend/);
    expect(set({ turn: 'week', turns: 4, ring_width: 50, color_min: 0, color_max: 10 })).not.toThrow();
  });

  it('has a thumbnail', () => {
    const style = STYLES.spiral;
    expect(style.layout).toBe('chart');
    if (style.layout === 'chart') expect(style.thumbnail().values[0] as unknown[]).toHaveLength(12);
  });
});

describe('spiral editor', () => {
  it('writes the turn, turns and ring width', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'spiral', entities: ['sensor.power'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({ spiral_turn: 'day', spiral_ring_width: 80, color_by: 'scale', legend: true });
    const schema = JSON.stringify(form.schema);
    expect(schema).toContain('"max":31');
    expect(schema).not.toContain('group_by');
    expect((form.computeLabel as (s: { name: string }) => string)({ name: 'spiral_turns' })).toBe('Turns');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), spiral_turn: 'week', spiral_turns: 3, spiral_ring_width: 60 } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, turn: 'week', turns: 3, ring_width: 60 });
    ed.setConfig(events.at(-1)!);
    await ed.updateComplete;
    const weekly = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(JSON.stringify(weekly.schema)).toContain('"max":13');
  });
});
