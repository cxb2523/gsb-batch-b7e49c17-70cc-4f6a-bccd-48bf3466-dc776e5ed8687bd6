import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  annotationEntities,
  annotationValues,
  isTimeText,
  labelWidth,
  markTimes,
  placeMarkLabels,
  pointFor,
  resolveValue,
  stateSpans,
  timeList,
  validateAnnotations,
} from '../src/chart/annotations';
import type { ChartSeries } from '../src/chart/frame';
import {
  annotationData,
  annotationFromData,
  annotationSchema,
  withAnnotations,
} from '../src/editor/annotations-editor';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

const check =
  (annotations: unknown, extra: Record<string, unknown> = {}) =>
  () =>
    validateAnnotations({ type: 'x', annotations, ...extra } as CardConfig);

describe('annotation options', () => {
  it('accepts every kind, and explains a bad one', () => {
    expect(
      check([
        { type: 'line', value: 21, label: 'Target', color: 'red', dash: false },
        { type: 'line', value: 'input_number.target' },
        { type: 'line', value: '21.5' },
        { type: 'band', from: 18, to: 'sensor.high' },
        { type: 'band', to: 5 },
        { type: 'time', times: ['07:00', '2026-10-28 22:30', '2026-10-28T08:00:00Z'] },
        { type: 'time', times: '07:00, 19:00:30' },
        { type: 'state', entity: 'switch.heater', state: 'on', shade: true },
        { type: 'point', at: 'min', entity: 'sensor.in' },
      ]),
    ).not.toThrow();
    expect(check(undefined)).not.toThrow();
    expect(check('x')).toThrow('"annotations" must be a list');
    expect(check([7])).toThrow('"annotations[0]" must have a "type"');
    expect(check([{ type: 'arrow' }])).toThrow('"annotations[0].type" must be one of: line, band, time, state, point');
    expect(check([{ type: 'line' }])).toThrow('"annotations[0].value" is needed for a line');
    expect(check([{ type: 'line', value: 'twenty' }])).toThrow(
      '"annotations[0].value" must be a number or an entity id',
    );
    expect(check([{ type: 'band' }])).toThrow('"annotations[0].from" or "annotations[0].to" is needed for a band');
    expect(check([{ type: 'line', value: 1, label: 2 }])).toThrow('"annotations[0].label" must be text');
    expect(check([{ type: 'line', value: 1, dash: 'no' }])).toThrow('"annotations[0].dash" must be true or false');
    expect(check([{ type: 'time', times: 7 }])).toThrow('"annotations[0].times" must be a time or a list of times');
    expect(check([{ type: 'time', times: ['25:00'] }])).toThrow('has "25:00": use 07:00 or 2026-10-28 07:00');
    expect(check([{ type: 'state' }])).toThrow('"annotations[0].entity" is needed for a state mark');
    expect(check([{ type: 'state', entity: 'Heater' }])).toThrow('"annotations[0].entity" must be an entity id');
    expect(check([{ type: 'point', at: 'middle' }])).toThrow(
      '"annotations[0].at" must be one of: max, min, last, first',
    );
    expect(check(undefined, { zones: 'yes' })).toThrow('"zones" must be true or false');
  });

  it('reads times', () => {
    expect(isTimeText('7:05')).toBe(true);
    expect(isTimeText('24:00')).toBe(false);
    expect(isTimeText('2026-10-28 07:00')).toBe(true);
    expect(isTimeText('2026-10-28T07:00:00+01:00')).toBe(true);
    expect(isTimeText('tomorrow')).toBe(false);
    expect(timeList(' 07:00 ,, 08:00')).toEqual(['07:00', '08:00']);
    expect(timeList(undefined)).toEqual([]);
  });

  it('resolves values from numbers and entities, and lists the entities to watch', () => {
    const hass = makeHass({ 'input_number.t': '21.5', 'sensor.off': 'unavailable' });
    expect(resolveValue(3, hass)).toBe(3);
    expect(resolveValue('4', hass)).toBe(4);
    expect(resolveValue('input_number.t', hass)).toBe(21.5);
    expect(resolveValue('sensor.off', hass)).toBeUndefined();
    expect(resolveValue('sensor.gone', hass)).toBeUndefined();
    expect(resolveValue(undefined, hass)).toBeUndefined();
    const raw = {
      type: 'x',
      annotations: [
        { type: 'line', value: 'input_number.t' },
        { type: 'line', value: 30 },
        { type: 'line', value: 'sensor.off' },
        { type: 'band', from: 'sensor.low', to: 9 },
        { type: 'state', entity: 'switch.heater' },
        { type: 'point', entity: 'sensor.in' },
      ],
    } as CardConfig;
    expect(annotationEntities(raw)).toEqual(['input_number.t', 'sensor.off', 'sensor.low', 'switch.heater']);
    expect(annotationValues(raw, hass)).toEqual([21.5, 30]);
    expect(annotationEntities({ type: 'x' } as CardConfig)).toEqual([]);
  });
});

describe('marks in time', () => {
  const london = { timeZone: 'Europe/London', firstDay: 1 };

  it('puts a daily time on every day in the range, in the zone, and single times once', () => {
    const start = Date.UTC(2026, 9, 24, 12);
    const end = Date.UTC(2026, 9, 26, 12);
    // British Summer Time ends on 25 October: 07:00 is 06:00 UTC before and 07:00 UTC after.
    expect(markTimes(['07:00'], { start, end }, london)).toEqual([Date.UTC(2026, 9, 25, 7), Date.UTC(2026, 9, 26, 7)]);
    expect(markTimes(['2026-10-24 18:30', '2026-10-24T20:00:00Z', '2026-12-01 00:00'], { start, end }, london)).toEqual(
      [Date.UTC(2026, 9, 24, 17, 30), Date.UTC(2026, 9, 24, 20)],
    );
  });

  it('finds the stretches an entity spent in a state', () => {
    const changes = [
      { t: 0, s: 'off' },
      { t: 10, s: 'on' },
      { t: 15, s: 'on' },
      { t: 20, s: 'off' },
      { t: 30, s: 'ON' },
    ];
    expect(stateSpans(changes, 'on', { start: 5, end: 40 }, 35)).toEqual([
      { start: 10, end: 20, s: 'on' },
      { start: 30, end: 35, s: 'ON' },
    ]);
    // No state: every change, the first clipped to the range.
    expect(stateSpans(changes, undefined, { start: 5, end: 25 }, 25).map((s) => s.start)).toEqual([5, 10, 20]);
    expect(stateSpans(changes, 'on', { start: 21, end: 25 }, 25)).toEqual([]);
  });

  it('keeps mark labels apart in two rows, flipping them at the right edge', () => {
    expect(labelWidth('Alarm')).toBe(39);
    const rows = placeMarkLabels(
      [
        { x: 50, width: 50 },
        { x: 10, width: 50 },
        { x: 40, width: 50 },
        { x: 70, width: 50 },
        { x: 290, width: 50 },
      ],
      300,
    );
    expect(rows).toEqual([undefined, 0, 1, 0, 0]);
  });

  it('picks the reading a point label sits on', () => {
    const s = {
      points: [
        { t: 0, v: 5, carried: true },
        { t: 1, v: 3 },
        { t: 2, v: null },
        { t: 3, v: 9 },
        { t: 10, v: 9 },
      ],
    } as unknown as ChartSeries;
    const range = { start: 0, end: 10 };
    expect(pointFor(s, 'max', range, false)!.t).toBe(3);
    expect(pointFor(s, 'min', range, false)!.t).toBe(1);
    expect(pointFor(s, 'first', range, false)!.t).toBe(1);
    expect(pointFor(s, 'last', range, false)!.t).toBe(10);
    expect(pointFor(s, 'first', range, true)!.t).toBe(0);
    expect(pointFor({ points: [] } as unknown as ChartSeries, 'max', range, false)).toBeUndefined();
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass(failStates = false) {
  const h = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
    'input_number.target': '30',
    'switch.heater': 'on',
  });
  h.states['switch.heater'].last_changed = new Date(now - H).toISOString();
  h.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    const ids = msg.entity_ids as string[];
    if (ids.includes('switch.heater')) {
      if (failStates) throw new Error('nope');
      return {
        'switch.heater': [
          { s: 'off', lu: sec(30 * H) },
          { s: 'on', lu: sec(10 * H) },
          { s: 'off', lu: sec(8 * H) },
          { s: 'on', lu: sec(4 * H) },
          { s: 'off', lu: sec(3 * H) },
        ],
      };
    }
    return {
      'sensor.in': [
        { s: '19', lu: sec(20 * H) },
        { s: '23', lu: sec(12 * H) },
        { s: '21', lu: sec(2 * H) },
      ],
      'sensor.out': [{ s: '5', lu: sec(20 * H) }],
    };
  }) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    ...extra,
  } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  for (let i = 0; i < 3; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (card: Card, sel: string) => qa(card, sel).map((e) => e.textContent!.replace(/\s+/g, ' ').trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('annotations on the line chart', () => {
  it('draws threshold lines (from a number or an entity) and widens the axis to show them', async () => {
    const card = await mount({
      annotations: [
        { type: 'line', value: 'input_number.target', label: 'Target' },
        { type: 'line', value: 2, color: 'blue', dash: false },
        { type: 'line', value: 'sensor.gone', label: 'Gone' },
      ],
    });
    const lines = qa(card, 'line.threshold');
    expect(lines).toHaveLength(2);
    expect(lines[0].classList.contains('dashed')).toBe(true);
    expect(lines[0].getAttribute('stroke')).toContain('--error-color');
    expect(lines[1].classList.contains('dashed')).toBe(false);
    expect(text(card, '.annotation-label')).toEqual(['Target']);
    // The axis now reaches 30 and 2, past the readings (5 to 23).
    const values = text(card, '.y-axis .axis-label').map(Number);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...values)).toBeLessThanOrEqual(2);
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
  });

  it('shades bands and the severity zones behind the lines, skipping what it cannot place', async () => {
    const card = await mount({
      zones: true,
      severity: [
        { from: 0, color: 'blue' },
        { from: 20, color: 'red' },
        { from: 500, color: 'green' },
      ],
      annotations: [
        { type: 'band', from: 18, to: 21, label: 'Comfort' },
        { type: 'band', to: 10 },
        { type: 'band', from: 'sensor.gone' },
        { type: 'band', from: 100, to: 200 },
      ],
    });
    expect(qa(card, 'rect.zone')).toHaveLength(2);
    expect(qa(card, 'rect.band')).toHaveLength(2);
    expect(text(card, '.annotation-label.band')).toEqual(['Comfort']);
    // Behind: the shading comes before the data in the drawing.
    const group = card.shadowRoot!.querySelector('.annotations-behind')!;
    expect(group.compareDocumentPosition(card.shadowRoot!.querySelector('path.line')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('marks set times and an entity turning on, with labels that do not overlap', async () => {
    const card = await mount({
      annotations: [
        { type: 'time', times: [new Date(now - 6 * H).toISOString().replace(/\.\d+Z$/, 'Z')], label: 'Alarm' },
        { type: 'state', entity: 'switch.heater', state: 'on', label: 'Heating on', shade: true },
        { type: 'state', entity: 'switch.heater', color: 'grey' },
      ],
    });
    expect(qa(card, 'line.mark-line.time')).toHaveLength(1);
    // On at 10 h and 4 h ago, then on again an hour ago (from the live state).
    expect(qa(card, 'line.mark-line.state')).toHaveLength(3 + 5);
    expect(qa(card, 'rect.state-shade')).toHaveLength(3);
    const labels = text(card, '.annotation-label.mark');
    // On a narrow card not every label fits; those that do never share a row with a neighbour.
    expect(labels).toContain('Heating on');
    expect(labels).toContain('Alarm');
    expect(labels.length).toBeLessThan(4);
    expect(qa(card, '.annotation-label.mark')[0].getAttribute('title')).toMatch(/ at /);
  });

  it('draws the chart without state marks while they load or if they fail', async () => {
    const card = await mount({ annotations: [{ type: 'state', entity: 'switch.heater' }] }, hass(true));
    expect(qa(card, 'path.line')).toHaveLength(2);
    expect(qa(card, 'line.mark-line')).toHaveLength(0);
  });

  it('labels the highest, lowest and latest readings of a series', async () => {
    const card = await mount({
      annotations: [
        { type: 'point', label: 'Peak' },
        { type: 'point', at: 'min', entity: 'sensor.in', color: 'green' },
        { type: 'point', at: 'last', entity: 'sensor.out' },
        { type: 'point', at: 'max', entity: 'sensor.missing' },
      ],
    });
    expect(text(card, '.annotation-label.point')).toEqual(['Peak 23.0 °C', '19.0 °C', '5.0 °C', '23.0 °C']);
    expect(qa(card, '.annotation-dot')).toHaveLength(4);
  });

  it('redraws when an entity it reads changes', async () => {
    const card = await mount({ annotations: [{ type: 'line', value: 'input_number.target' }] });
    const before = qa(card, 'line.threshold')[0].getAttribute('y1');
    const h = card.hass!;
    card.hass = {
      ...h,
      states: { ...h.states, 'input_number.target': { ...h.states['input_number.target'], state: '25' } },
    };
    await card.updateComplete;
    expect(qa(card, 'line.threshold')[0].getAttribute('y1')).not.toBe(before);
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

describe('annotations in the editor', () => {
  it('turns annotations into form data and back', () => {
    expect(annotationData({ type: 'line', value: 21 })).toEqual({
      type: 'line',
      value: '21',
      dash: true,
      history: false,
      zone: 'none',
      label: undefined,
      color: undefined,
    });
    expect(annotationData({ type: 'time', times: ['07:00', '08:00'] }).times).toBe('07:00, 08:00');
    expect(annotationData({ type: 'point', entity: 'sensor.in' })).toMatchObject({ at: 'max', series: 'sensor.in' });
    const line = { type: 'line' as const, value: 21 };
    expect(annotationFromData({ type: 'line', value: ' 22.5 ', dash: true, label: '', color: 'red' }, line)).toEqual({
      type: 'line',
      value: 22.5,
      color: 'red',
    });
    expect(annotationFromData({ type: 'line', value: 'input_number.t', dash: false }, line)).toEqual({
      type: 'line',
      value: 'input_number.t',
      dash: false,
    });
    expect(annotationFromData({ type: 'time', times: '07:00, 19:00' }, { type: 'time' })).toEqual({
      type: 'time',
      times: ['07:00', '19:00'],
    });
    expect(annotationFromData({ type: 'point', series: 'sensor.out', at: 'min' }, { type: 'point' })).toEqual({
      type: 'point',
      entity: 'sensor.out',
      at: 'min',
    });
    // A new kind keeps the label and colour only.
    expect(annotationFromData({ type: 'band', value: '3', label: 'L', color: 'red' }, line)).toEqual({
      type: 'band',
      label: 'L',
      color: 'red',
    });
    expect(annotationFromData({}, line)).toEqual({ type: 'line' });
    expect(withAnnotations({ type: 'x', annotations: [line] } as CardConfig, [])).toEqual({ type: 'x' });
    expect(annotationSchema('line', undefined, [])).toBe(annotationSchema('line', undefined, []));
  });

  it('adds, edits and removes annotations, and shades the zones', async () => {
    await import('../src/editor/chartdeck-card-editor');
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => {
      const config = (e as CustomEvent).detail.config as CardConfig;
      events.push(config);
      ed.setConfig(config);
    });
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const root = ed.shadowRoot!;
    const chart = root.querySelector('.section-chart ha-form') as Stub;
    expect((chart.data as Record<string, unknown>).zones).toBe(false);
    chart.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(chart.data as object), zones: true } } }),
    );
    expect(events.at(-1)!.zones).toBe(true);
    const add = (type: string) =>
      (root.querySelector(`.annotation-add button[data-type="${type}"]`) as HTMLElement).click();
    for (const type of ['line', 'band', 'time', 'state', 'point']) {
      add(type);
      await ed.updateComplete;
    }
    expect(events.at(-1)!.annotations).toEqual([
      { type: 'line', value: 0 },
      { type: 'band', from: 0, to: 1 },
      { type: 'time', times: ['07:00'] },
      { type: 'state', entity: 'sensor.in', state: 'on' },
      { type: 'point', at: 'max' },
    ]);
    const forms = [...root.querySelectorAll('.annotation ha-form')] as Stub[];
    expect(forms).toHaveLength(5);
    forms[0].dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(forms[0].data as object), value: '21', label: 'T' } },
      }),
    );
    expect((events.at(-1)!.annotations as unknown[])[0]).toEqual({ type: 'line', value: 21, label: 'T' });
    await ed.updateComplete;
    for (let i = 0; i < 5; i++) {
      (root.querySelector('.annotation .remove') as HTMLElement).click();
      await ed.updateComplete;
    }
    expect(events.at(-1)!.annotations).toBeUndefined();
  });

  it('starts a state mark on a placeholder when the card has no entities', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: [{ entity: 'sensor.a' }] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    (ed.shadowRoot!.querySelector('.annotation-add button[data-type="state"]') as HTMLElement).click();
    expect((events.at(-1)!.annotations as { entity: string }[])[0].entity).toBe('sensor.a');
  });
});
