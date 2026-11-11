import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  DEFAULT_ACTIVE,
  activeSet,
  averageDay,
  barHeights,
  bucketBounds,
  clip,
  clockDays,
  foldSlots,
  formatClockDuration,
  isGap,
  minuteAngle,
  polar,
  ringLayout,
  sectorPath,
  stateIntervals,
  switchOns,
  totalMs,
  wallMinute,
  wallSpans,
} from '../src/chart/day-clock';
import { DAY_CLOCK_FIELDS, dayClockEntityFields } from '../src/editor/day-clock-editor';
import { startOf } from '../src/history/timezone';
import type { Point } from '../src/history/types';
import { day_clock, dialLabels, fitText, minuteLabel, ringKind, validateDayClock } from '../src/styles/day-clock';
import { STYLES } from '../src/styles/index';
import type { CardConfig, HomeAssistant } from '../src/types';
import type { ResolvedEntity } from '../src/resolve';
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

const M = 60_000;
const H = 3_600_000;
const LONDON = 'Europe/London';
const zone = { timeZone: LONDON, firstDay: 1 };
const iso = (s: string) => Date.parse(s);
const txt = (...rows: [number, string | undefined][]): Point[] => rows.map(([t, s]) => ({ t, v: null, s }));

describe('state intervals', () => {
  // 29 Oct 2026 is GMT, so wall clock = UTC.
  const midnight = iso('2026-10-29T00:00:00Z');
  const now = iso('2026-10-29T15:40:00Z');
  const on = new Set(['on']);

  it('clips an interval running over midnight from yesterday, and keeps one still running at now', () => {
    // The store hands over the reading from before the range moved to its start, marked carried.
    const points: Point[] = [
      { t: midnight, v: null, s: 'on', carried: true },
      ...txt([midnight + 1 * H, 'off'], [midnight + 6 * H, 'on'], [midnight + 7 * H, 'off'], [midnight + 15 * H, 'on']),
    ];
    const spans = stateIntervals(points, { start: midnight, end: now }, on);
    expect(spans.active).toEqual([
      { start: midnight, end: midnight + H, carried: true },
      { start: midnight + 6 * H, end: midnight + 7 * H },
      { start: midnight + 15 * H, end: now },
    ]);
    expect(totalMs(spans.active)).toBe(2 * H + 40 * M);
    // Already on at midnight is not a switch-on today.
    expect(switchOns(spans.active)).toBe(2);
    expect(spans.word).toBe('on');
  });

  it('treats a point earlier than the range as carried, and skips gaps', () => {
    const points = txt(
      [midnight - 2 * H, 'on'],
      [midnight + H, 'unavailable'],
      [midnight + 2 * H, 'on'],
      [midnight + 3 * H, 'unknown'],
    );
    const spans = stateIntervals(points, { start: midnight, end: midnight + 4 * H }, on);
    expect(spans.active).toEqual([
      { start: midnight, end: midnight + H, carried: true },
      { start: midnight + 2 * H, end: midnight + 3 * H },
    ]);
    expect(spans.known).toEqual(spans.active);
    expect(isGap(undefined)).toBe(true);
    expect(isGap('')).toBe(true);
    expect(isGap('off')).toBe(false);
  });

  it('joins repeats and honours a custom active set', () => {
    const points = txt([0, 'heat'], [10, 'heat'], [20, 'idle'], [30, 'cool']);
    expect(stateIntervals(points, { start: 0, end: 40 }, new Set(['heat', 'cool'])).active).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it('clips to a range, marking a cut start as carried', () => {
    expect(
      clip(
        [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
          { start: 40, end: 50 },
        ],
        { start: 5, end: 25 },
      ),
    ).toEqual([
      { start: 5, end: 10, carried: true },
      { start: 20, end: 25 },
    ]);
  });

  it('reads the active option as one state, a list, or the defaults', () => {
    expect([...activeSet('heating')]).toEqual(['heating']);
    expect([...activeSet([' on ', 'open', 3])]).toEqual(['on', 'open']);
    expect([...activeSet([])]).toEqual(DEFAULT_ACTIVE);
    expect(activeSet(undefined).has('home')).toBe(true);
  });
});

describe('the dial and the clock changes', () => {
  it('maps a plain day minute by minute', () => {
    const midnight = iso('2026-10-29T00:00:00Z');
    expect(wallMinute(midnight + 90 * M, midnight, LONDON)).toBe(90);
    expect(wallSpans({ start: midnight + 6 * H, end: midnight + 8 * H }, midnight, LONDON)).toEqual([[360, 480]]);
    expect(minuteAngle(360)).toBeCloseTo(Math.PI / 2);
  });

  it('on the 23-hour day, the skipped hour is left empty and the arc keeps its real length', () => {
    const bounds = clockDays(iso('2026-03-29T12:00:00Z'), zone, 1, 0);
    expect(bounds).toEqual([iso('2026-03-29T00:00:00Z'), iso('2026-03-29T23:00:00Z')]);
    // 00:30 GMT to 03:30 BST: two hours of real time, drawn 00:30–01:00 and 02:00–03:30.
    const spans = wallSpans(
      { start: iso('2026-03-29T00:30:00Z'), end: iso('2026-03-29T02:30:00Z') },
      bounds[0],
      LONDON,
    );
    expect(spans).toEqual([
      [30, 60],
      [120, 210],
    ]);
    // The day still ends at the top of the dial.
    expect(wallSpans({ start: bounds[1] - H, end: bounds[1] }, bounds[0], LONDON)).toEqual([[1380, 1440]]);
  });

  it('on the 25-hour day, the repeated hour draws over itself', () => {
    const bounds = clockDays(iso('2026-10-25T12:00:00Z'), zone, 1, 0);
    expect(bounds[1] - bounds[0]).toBe(25 * H);
    // 00:30 BST to 02:30 GMT: three hours, 01:00–02:00 twice.
    const spans = wallSpans(
      { start: iso('2026-10-24T23:30:00Z'), end: iso('2026-10-25T02:30:00Z') },
      bounds[0],
      LONDON,
    );
    expect(spans).toEqual([
      [30, 120],
      [60, 150],
    ]);
  });

  it('lists N whole days back from today, stepping back N days at a time', () => {
    const now = iso('2026-10-29T15:40:00Z');
    const week = clockDays(now, zone, 7, 0);
    expect(week).toHaveLength(8);
    expect(week[6]).toBe(iso('2026-10-29T00:00:00Z'));
    expect(week[7]).toBe(iso('2026-10-30T00:00:00Z'));
    // Over the clock change: 25 Oct is 25 hours long.
    expect(week[0]).toBe(iso('2026-10-22T23:00:00Z'));
    expect(clockDays(now, zone, 7, 1)[7]).toBe(week[0]);
    expect(clockDays(now, zone, 1, 1)).toEqual([iso('2026-10-28T00:00:00Z'), iso('2026-10-29T00:00:00Z')]);
  });

  it('draws sectors, whole rings and polar points', () => {
    expect(polar(10, 0)).toEqual([0, -10]);
    expect(polar(10, Math.PI / 2)).toEqual([10, 0]);
    expect(sectorPath(5, 10, 0, Math.PI / 2)).toBe('M0 -10A10 10 0 0 1 10 0L5 0A5 5 0 0 0 0 -5Z');
    expect(sectorPath(0, 10, 0, 4)).toMatch(/L0 0Z$/);
    expect(sectorPath(5, 10, 0, Math.PI * 2).match(/M/g)).toHaveLength(2);
    expect(sectorPath(0, 10, 0, Math.PI * 2).match(/M/g)).toHaveLength(1);
    expect(sectorPath(5, 10, 1, 1)).toBe('');
  });
});

describe('the average day', () => {
  const days = [0, 1, 2, 3].map((d) => iso('2026-10-26T00:00:00Z') + d * 24 * H);

  it('counts, for each minute, the days it was on out of the days it was known', () => {
    const at = (d: number, h: number) => days[d] + h * H;
    const active = [
      { start: at(0, 7), end: at(0, 8) },
      { start: at(1, 7), end: at(1, 7.5) },
    ];
    const known = [{ start: days[0], end: days[3] }];
    expect(averageDay(active, known, days, LONDON)).toEqual([
      { from: 420, to: 450, on: 2, of: 3 },
      { from: 450, to: 480, on: 1, of: 3 },
    ]);
  });

  it('leaves out days a minute was not known (unrecorded, or not yet happened)', () => {
    const active = [
      { start: days[0] + 7 * H, end: days[0] + 8 * H },
      { start: days[2] + 7 * H, end: days[2] + 8 * H },
    ];
    // Day 1 unrecorded; day 2 only known until 07:30.
    const known = [
      { start: days[0], end: days[1] },
      { start: days[2], end: days[2] + 7.5 * H },
    ];
    expect(averageDay(active, known, days, LONDON)).toEqual([
      { from: 420, to: 450, on: 2, of: 2 },
      { from: 450, to: 480, on: 1, of: 1 },
    ]);
  });
});

describe('bars by the hour', () => {
  const midnight = iso('2026-10-29T00:00:00Z');
  const day = [midnight, midnight + 24 * H];
  const num = (...rows: [number, number | null][]): Point[] => rows.map(([t, v]) => ({ t, v }));

  it('buckets by real time from the day start', () => {
    expect(bucketBounds({ start: 0, end: 2 * H }, 30)).toEqual([0, 30 * M, 60 * M, 90 * M, 2 * H]);
  });

  it('takes a time-weighted mean per hour, up to now', () => {
    const points = num([midnight, 10], [midnight + 30 * M, 20], [midnight + 2 * H, 40]);
    const slots = foldSlots(points, day, 60, 'mean', midnight + 3 * H, LONDON);
    expect(slots).toEqual([
      { index: 0, v: 15, days: 1 },
      { index: 1, v: 20, days: 1 },
      { index: 2, v: 40, days: 1 },
    ]);
  });

  it('sums a meter’s change per half hour', () => {
    const points = num([midnight, 100], [midnight + 10 * M, 101], [midnight + 40 * M, 103.5]);
    const slots = foldSlots(points, day, 30, 'change', midnight + 60 * M, LONDON);
    expect(slots.map((s) => [s.index, s.v])).toEqual([
      [0, 1],
      [1, 2.5],
    ]);
  });

  it('adds the two 01:00 hours of the 25-hour day together for a total, and averages them for a mean', () => {
    const bounds = clockDays(iso('2026-10-25T12:00:00Z'), zone, 1, 0);
    const first = iso('2026-10-25T00:00:00Z'); // 01:00 BST
    const second = iso('2026-10-25T01:00:00Z'); // 01:00 GMT
    const meter = num([first, 0], [first + 30 * M, 2], [second + 30 * M, 5]);
    const change = foldSlots(meter, bounds, 60, 'change', bounds[1], LONDON);
    expect(change.find((s) => s.index === 1)?.v).toBe(5);
    const temp = num([first, 10], [second, 20], [second + H, 30]);
    const mean = foldSlots(temp, bounds, 60, 'mean', second + H + M, LONDON);
    expect(mean.find((s) => s.index === 1)?.v).toBe(15);
  });

  it('averages each hour across days', () => {
    const two = [midnight - 24 * H, midnight, midnight + 24 * H];
    const points = num([two[0], 10], [two[0] + H, null], [midnight, 30], [midnight + H, null]);
    const slots = foldSlots(points, two, 60, 'mean', midnight + 2 * H, LONDON);
    expect(slots).toEqual([{ index: 0, v: 20, days: 2 }]);
    expect(foldSlots(points, two, 60, 'max', midnight + 2 * H, LONDON)[0].v).toBe(20);
  });

  it('scales totals from zero and levels from lowest to highest', () => {
    const slots = [5, 10, 0].map((v, index) => ({ index, v, days: 1 }));
    expect(barHeights(slots, true)).toEqual([0.5, 1, 0]);
    expect(barHeights(slots, false)).toEqual([0.15 + 0.85 * 0.5, 1, 0.15]);
    expect(barHeights([{ index: 0, v: 3, days: 1 }], false)).toEqual([1]);
    expect(barHeights([], true)).toEqual([]);
    expect(barHeights([{ index: 0, v: 0, days: 1 }], true)).toEqual([0]);
  });
});

describe('layout and text', () => {
  it('stacks rings from the outside in and keeps a hole for the centre', () => {
    const one = ringLayout(['state']);
    expect(one.rings).toEqual([{ r0: 77, r1: 92 }]);
    const many = ringLayout(['state', 'numeric', 'state', 'numeric', 'state', 'state']);
    expect(many.hole).toBeCloseTo(44);
    expect(many.rings[0].r1).toBe(92);
    expect(ringLayout([]).hole).toBe(92);
  });

  it('formats durations as the dial shows them', () => {
    expect(formatClockDuration(4 * H + 10 * M)).toBe('4 h 10 m');
    expect(formatClockDuration(2 * H)).toBe('2 h');
    expect(formatClockDuration(25 * M)).toBe('25 m');
    expect(formatClockDuration(-5)).toBe('0 m');
  });

  it('fits centre text, cutting it short only when it would get too small', () => {
    expect(fitText('4 h 10 m', 80, 17)).toEqual({ size: 17, text: '4 h 10 m' });
    const cut = fitText('A very long name for a radiator valve on', 60, 11);
    expect(cut.size).toBeCloseTo(11 * 0.62);
    expect(cut.text.endsWith('…')).toBe(true);
  });

  it('labels the dial on a 24- or 12-hour clock', () => {
    const h24 = makeHass({}, { locale: { language: 'en', number_format: 'language', time_format: '24' } });
    const h12 = makeHass({}, { locale: { language: 'en', number_format: 'language', time_format: '12' } });
    expect(dialLabels(h24)).toEqual(['00', '06', '12', '18']);
    expect(dialLabels(h12)).toEqual(['12 AM', '6 AM', '12 PM', '6 PM']);
    expect(dialLabels(makeHass({}, { locale: { language: 'en-GB', number_format: 'language' } }))).toEqual([
      '00',
      '06',
      '12',
      '18',
    ]);
    expect(minuteLabel(420, h24)).toBe('07:00');
    expect(minuteLabel(1440, h24)).toBe('00:00');
    expect(minuteLabel(810, h12)).toBe('1:30 PM');
  });

  it('decides arcs or bars from the domain, the active option, the unit and the value', () => {
    const e = (id: string, extra: Partial<ResolvedEntity> = {}, attrs: Record<string, unknown> = {}) =>
      ({
        entityId: id,
        config: { entity: id },
        stateObj: { entity_id: id, state: '1', attributes: attrs },
        available: true,
        ...extra,
      }) as unknown as ResolvedEntity;
    expect(ringKind(e('binary_sensor.door'))).toBe('state');
    expect(ringKind(e('sensor.power', {}, { unit_of_measurement: 'W' }))).toBe('numeric');
    expect(ringKind(e('sensor.mode', { available: false }))).toBe('state');
    expect(ringKind(e('sensor.count'))).toBe('numeric');
    // A text sensor with no unit gets a state ring, not empty number bars.
    const washer = e('sensor.washer', {
      stateObj: { entity_id: 'sensor.washer', state: 'washing', attributes: {} },
    } as never);
    expect(ringKind(washer)).toBe('state');
    expect(ringKind(e('sensor.flag', { config: { entity: 'sensor.flag', active: '1' } } as never))).toBe('state');
    expect(ringKind(e('sensor.flag', { config: { entity: 'sensor.flag', active: [] } } as never))).toBe('numeric');
  });
});

describe('validate', () => {
  const base = { type: 'x', style: 'day_clock' } as CardConfig;
  it('accepts its options and rejects bad ones readably', () => {
    expect(() =>
      validateDayClock({ ...base, days: 7, center: 'now', bucket: 30, aggregate: 'max', period: { offset: 1 } }),
    ).not.toThrow();
    expect(() => validateDayClock({ ...base, bucket: '15' })).not.toThrow();
    expect(() => validateDayClock({ ...base, days: 0 })).toThrow('"days" must be a whole number from 1 to 31');
    expect(() => validateDayClock({ ...base, days: 1.5 })).toThrow('"days"');
    expect(() => validateDayClock({ ...base, center: 'middle' })).toThrow('"center" must be one of: total, now, none');
    expect(() => validateDayClock({ ...base, bucket: 20 })).toThrow('"bucket" must be one of: 15, 30, 60');
    expect(() => validateDayClock({ ...base, aggregate: 'median' })).toThrow('"aggregate" must be one of');
    expect(() => validateDayClock({ ...base, tooltip: 'yes' })).toThrow('"tooltip" must be true or false');
    expect(() =>
      validateDayClock({ ...base, entities: ['switch.a', { entity: 'switch.b', active: ['on'] }] }),
    ).not.toThrow();
    expect(() => validateDayClock({ ...base, entities: [{ entity: 'switch.b', active: 1 }] })).toThrow(
      '"active" must be a state or a list of states',
    );
  });
});

/* ------------------------------------------------------------------ the card */

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const NOW = iso('2026-10-29T15:40:00Z');
const MIDNIGHT = iso('2026-10-29T00:00:00Z');
const s = (t: number) => t / 1000;

function hassFor(
  history: Record<string, unknown[]>,
  extra: Record<string, string | [string, Record<string, unknown>]> = {},
) {
  const hass = makeHass(
    {
      'climate.house': ['heat', { friendly_name: 'Heating', hvac_action: 'heating' }],
      'switch.water': ['off', { friendly_name: 'Hot water' }],
      'sensor.motion': [
        '3',
        { friendly_name: 'Motion', unit_of_measurement: 'events', state_class: 'total_increasing' },
      ],
      ...extra,
    },
    {
      locale: { language: 'en', number_format: 'language', time_zone: 'server', time_format: '24' },
      config: { time_zone: LONDON },
    } as Partial<HomeAssistant>,
  );
  hass.formatEntityState = (o, st) => st ?? o.state;
  hass.formatEntityAttributeValue = (_o, _a, v) => String(v);
  hass.callWS = vi.fn(async (msg: { entity_ids: string[] }) => {
    const out: Record<string, unknown[]> = {};
    for (const id of msg.entity_ids) if (history[id]) out[id] = history[id];
    return out;
  }) as unknown as HomeAssistant['callWS'];
  return hass;
}

const HISTORY = {
  'climate.house': [
    { s: 'heat', a: { hvac_action: 'heating' }, lu: s(MIDNIGHT - H) },
    { s: 'heat', a: { hvac_action: 'idle' }, lu: s(MIDNIGHT + H) },
    { s: 'heat', a: { hvac_action: 'heating' }, lu: s(MIDNIGHT + 6 * H) },
    { s: 'heat', a: { hvac_action: 'idle' }, lu: s(MIDNIGHT + 8 * H) },
    { s: 'heat', a: { hvac_action: 'heating' }, lu: s(MIDNIGHT + 15 * H) },
  ],
  'switch.water': [
    { s: 'off', lu: s(MIDNIGHT - H) },
    { s: 'on', lu: s(MIDNIGHT + 6 * H) },
    { s: 'unavailable', lu: s(MIDNIGHT + 7 * H) },
    { s: 'off', lu: s(MIDNIGHT + 8 * H) },
  ],
  'sensor.motion': [
    { s: '0', lu: s(MIDNIGHT - H) },
    { s: '2', lu: s(MIDNIGHT + 7 * H + 10 * M) },
    { s: '3', lu: s(MIDNIGHT + 9 * H) },
  ],
};

async function mount(config: Partial<CardConfig>, hass = hassFor(HISTORY)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'day_clock',
    entities: ['climate.house', 'switch.water', 'sensor.motion'],
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
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('24-hour clock card', () => {
  it('is registered as a history chart named "24-hour clock"', () => {
    expect(STYLES.day_clock).toBe(day_clock);
    expect(day_clock.group).toBe('history');
    expect(day_clock.thumbnail()).toBeTruthy();
  });

  it('draws one ring per entity: arcs for states, bars for numbers, with a hand and the dimmed future', async () => {
    const card = await mount({});
    const rings = qa(card, '.dc-ring');
    expect(rings.map((r) => r.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(rings.map((r) => r.classList.contains('numeric'))).toEqual([false, false, true]);
    // Heating: carried in from yesterday, 06–08, and running since 15:00.
    expect(rings[0].querySelectorAll('.dc-mark')).toHaveLength(3);
    // Hot water: on 06–07, then unavailable (a gap).
    expect(rings[1].querySelectorAll('.dc-mark')).toHaveLength(1);
    // Motion: a meter, so bars of its change in the hours it went up (07:00 and 08:00).
    expect(rings[2].querySelectorAll('.dc-mark').length).toBeGreaterThan(0);
    expect(q(card, '.dc-hand')).not.toBeNull();
    expect(q(card, '.dc-future')).not.toBeNull();
    expect(text(q(card, '.dc-centre-value'))).toBe('3 h 40 m');
    expect(text(q(card, '.dc-centre-label'))).toBe('Heating on');
    expect(qa(card, '.dc-label').map((l) => l.textContent)).toEqual(['00', '06', '12', '18']);
    expect(q(card, 'svg.dc-svg')!.getAttribute('role')).toBe('img');
    expect(q(card, 'svg.dc-svg')!.getAttribute('aria-label')).toBe('24-hour clock chart of Heating, Hot water, Motion');
    const legend = qa(card, '.dc-item').map(text);
    expect(legend[0]).toBe('Heating 3 h 40 m · 2 times');
    expect(legend[1]).toBe('Hot water 1 h · once');
    expect(legend[2]).toBe('Motion 3.0 events · busiest 07:00');
    expect(text(q(card, '.dc-now'))).toBe('15:40 · Heating on');
    // Climate rings follow what it is doing, not its mode.
    const call = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].no_attributes === false);
    expect(call?.[0].entity_ids).toEqual(['climate.house']);
  });

  it('shows a tooltip for an arc on hover or focus, and for a bar', async () => {
    const card = await mount({});
    const arcs = qa(card, '.dc-ring')[0].querySelectorAll('.dc-mark');
    arcs[1].dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(text(q(card, '.dc-tip .tooltip-time'))).toBe('06:00 – 08:00');
    expect(text(q(card, '.dc-tip .tooltip-value'))).toBe('2 h');
    arcs[2].dispatchEvent(new FocusEvent('focus'));
    await card.updateComplete;
    expect(text(q(card, '.dc-tip .tooltip-time'))).toBe('15:00 – now');
    expect(text(q(card, '.dc-tip .tooltip-value'))).toBe('40 m so far');
    arcs[2].dispatchEvent(new FocusEvent('blur'));
    await card.updateComplete;
    expect(q(card, '.dc-tip')).toBeNull();
    const bar = qa(card, '.dc-ring')[2].querySelector('.dc-mark')!;
    bar.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(text(q(card, '.dc-tip .tooltip-time'))).toBe('07:00 – 08:00');
    expect(text(q(card, '.dc-tip .tooltip-value'))).toBe('2.0 events');
    bar.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(q(card, '.dc-tip')).toBeNull();
  });

  it('keeps a touch tooltip up for a moment', async () => {
    const card = await mount({});
    const arc = qa(card, '.dc-ring')[1].querySelector('.dc-mark')!;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    arc.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
    arc.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'touch' }));
    await card.updateComplete;
    expect(q(card, '.dc-tip')).not.toBeNull();
    vi.advanceTimersByTime(3100);
    await card.updateComplete;
    expect(q(card, '.dc-tip')).toBeNull();
  });

  it('honours per-entity colour and active states, and centre options', async () => {
    const card = await mount({
      center: 'now',
      entities: [
        { entity: 'switch.water', color: 'red', active: 'off' },
        { entity: 'climate.house', name: 'House' },
      ],
    } as Partial<CardConfig>);
    const first = qa(card, '.dc-ring')[0];
    expect(first.querySelector('.dc-mark')!.getAttribute('fill')).toContain('--error-color');
    // Off from before midnight to 06:00, and from 08:00 on.
    expect(first.querySelectorAll('.dc-mark')).toHaveLength(2);
    expect(text(q(card, '.dc-centre-value'))).toBe('15:40');
    expect(text(q(card, '.dc-centre-label'))).toBe('Hot water off');
    const none = await mount({ center: 'none' });
    expect(none.shadowRoot!.querySelector('.dc-centre')).toBeNull();
  });

  it('shows a missing entity as an empty ring, and only a message when there is nothing at all', async () => {
    const card = await mount({ entities: ['switch.water', 'light.gone'] });
    const rings = qa(card, '.dc-ring');
    expect(rings).toHaveLength(2);
    expect(rings[1].querySelectorAll('.dc-mark')).toHaveLength(0);
    expect(text(qa(card, '.dc-item')[1])).toBe('light.gone Entity not found');
    const empty = await mount({ entities: ['light.gone'] });
    expect(text(empty.shadowRoot!.querySelector('.chart-message'))).toBe('No readings in this period.');
    expect(empty.shadowRoot!.querySelector('.dc-dial')).toBeNull();
  });

  it('says so while loading and when loading fails', async () => {
    const hass = hassFor(HISTORY);
    hass.callWS = vi.fn(() => new Promise(() => undefined)) as unknown as HomeAssistant['callWS'];
    const loading = await mount({}, hass);
    expect(text(loading.shadowRoot!.querySelector('.chart-message'))).toBe('Loading history…');
    const failing = hassFor(HISTORY);
    failing.callWS = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as HomeAssistant['callWS'];
    const failed = await mount({}, failing);
    expect(text(failed.shadowRoot!.querySelector('.chart-message.error'))).toBe("Couldn't load history: boom");
  });

  it('shows the average day over several days, with no hand', async () => {
    const day = 24 * H;
    const history = {
      'switch.water': [
        { s: 'off', lu: s(MIDNIGHT - 3 * day) },
        { s: 'on', lu: s(MIDNIGHT - 2 * day + 7 * H) },
        { s: 'off', lu: s(MIDNIGHT - 2 * day + 8 * H) },
        { s: 'on', lu: s(MIDNIGHT - day + 7 * H) },
        { s: 'off', lu: s(MIDNIGHT - day + 7.5 * H) },
      ],
      'sensor.motion': [
        { s: '0', lu: s(MIDNIGHT - 3 * day) },
        { s: '4', lu: s(MIDNIGHT - day + 7 * H + M) },
      ],
    };
    const card = await mount({ days: 3, entities: ['switch.water', 'sensor.motion'] }, hassFor(history));
    expect(q(card, '.dc-hand')).toBeNull();
    const arcs = [...qa(card, '.dc-ring')[0].querySelectorAll('.dc-mark')];
    expect(arcs.map((a) => a.getAttribute('fill-opacity'))).toEqual(['0.6666666666666666', '0.3333333333333333']);
    // Arcs over several days are not each a tab stop.
    expect(arcs[0].getAttribute('tabindex')).toBeNull();
    arcs[0].dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(text(q(card, '.dc-tip'))).toBe('07:00 – 07:30 Hot water on 2 of 3 days');
    expect(text(qa(card, '.dc-item')[0])).toBe('Hot water 30 m a day · 0.7 times a day');
    expect(text(qa(card, '.dc-item')[1])).toBe('Motion 1.3 events a day · busiest 07:00');
    expect(text(q(card, '.dc-centre-label'))).toBe('Hot water on per day');
    expect(text(q(card, '.dc-foot'))).toBe('Average day · last 3 days');
    const bar = qa(card, '.dc-ring')[1].querySelector('.dc-mark')!;
    bar.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(text(q(card, '.dc-tip .tooltip-value'))).toBe('1.3 events on average');
  });

  it('steps back a day with the buttons, drawing the whole of yesterday', async () => {
    const card = await mount({ period: { navigate: true } } as Partial<CardConfig>);
    expect(text(q(card, '.period-label'))).toBe('Today');
    (q(card, '.period-prev') as HTMLButtonElement).click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    expect(text(q(card, '.period-label'))).toBe('Yesterday');
    expect(q(card, '.dc-hand')).toBeNull();
    expect(q(card, '.dc-now')).toBeNull();
  });

  it('labels numbers that are levels by their peak, and a numeric-only centre by its value', async () => {
    const hass = hassFor(
      {
        'sensor.temp': [
          { s: '18', lu: s(MIDNIGHT - H) },
          { s: '21', lu: s(MIDNIGHT + 7 * H) },
          { s: '19', lu: s(MIDNIGHT + 9 * H) },
        ],
      },
      { 'sensor.temp': ['19', { friendly_name: 'Lounge', unit_of_measurement: '°C' }] },
    );
    const card = await mount({ entities: ['sensor.temp'], bucket: 30 } as Partial<CardConfig>, hass);
    expect(text(q(card, '.dc-item'))).toBe('Lounge peak 21.0 °C at 07:00');
    expect(qa(card, '.dc-mark')).toHaveLength(32);
    expect(text(q(card, '.dc-centre-value'))).toBe('19.0 °C');
    expect(text(q(card, '.dc-centre-label'))).toBe('Lounge');
  });

  it('moves the hand every minute and stops when the card leaves', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'day_clock', entities: ['switch.water'] } as CardConfig);
    card.hass = hassFor(HISTORY);
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(10);
    await card.updateComplete;
    const before = q(card, '.dc-hand')!.getAttribute('x2');
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    await card.updateComplete;
    expect(q(card, '.dc-hand')!.getAttribute('x2')).not.toBe(before);
    card.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('24-hour clock editor', () => {
  it('shows the Chart section and writes days, centre, bucket and aggregate', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'day_clock', entities: ['switch.a'], bucket: 30 } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      days: 1,
      period_offset: 0,
      period_navigate: false,
      center: 'total',
      bucket: '30',
      aggregate: 'auto',
      tooltip: true,
    });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), days: 7, center: 'none', bucket: '15', aggregate: 'max' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, days: 7, center: 'none', bucket: 15, aggregate: 'max' });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), bucket: '60', period_navigate: true } },
      }),
    );
    const last = events.at(-1)!;
    expect(last.bucket).toBeUndefined();
    expect(last.period).toEqual({ navigate: true });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string; path: string[] }[] }).fields;
    expect(fields.map((f) => f.path.join('.'))).toEqual(['color', 'active']);
    expect(dayClockEntityFields().schema).toHaveLength(1);
    expect(DAY_CLOCK_FIELDS.map((f) => f.name)).toContain('bucket');
  });
});

// The interval maths runs on any start of day the zone gives.
it('finds the start of a day in the zone', () => {
  expect(startOf('day', NOW, zone)).toBe(MIDNIGHT);
});

describe('text history (shared loader, as on the state timeline branch)', () => {
  it('keeps the words of states, keyed apart from the numbers', async () => {
    const { key, parseHistory, toPoint, toText } = await import('../src/history/fetch');
    expect(parseHistory([{ s: 'on', lu: 1 }], undefined, true)).toEqual([{ t: 1000, v: null, s: 'on' }]);
    expect(toPoint(5, 3, true)).toEqual({ t: 5, v: null, s: '3' });
    expect(toPoint(5, '3')).toEqual({ t: 5, v: 3 });
    expect(toText(true)).toBe('true');
    expect(toText(null)).toBeUndefined();
    expect(key({ entity: 'a', text: true })).toBe('a|text');
    expect(key({ entity: 'a', attribute: 'b', text: true })).toBe('a|b|text');
  });
});
