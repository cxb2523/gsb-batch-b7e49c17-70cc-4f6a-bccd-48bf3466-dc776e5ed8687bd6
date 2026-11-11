import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  actionKind,
  actionSpans,
  climateData,
  climateRequests,
  holdRuns,
  rangeBandPath,
  rangePoints,
  valueAt,
} from '../src/chart/climate-data';
import { key, loadHistory, parseHistory, toPoint, toText } from '../src/history/fetch';
import { HistoryStore } from '../src/history/store';
import type { Point } from '../src/history/types';
import { actionLabel, climateOptions } from '../src/styles/climate';
import type { ResolvedEntity } from '../src/resolve';
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
const flush = () => new Promise((r) => setTimeout(r, 0));
const p = (t: number, v: number | null): Point => ({ t, v });
const s = (t: number, words?: string): Point => ({ t, v: null, s: words });

describe('climate data', () => {
  it('asks for the four temperatures and the action as words, all from the one entity', () => {
    const r = climateRequests('climate.lounge');
    expect(Object.values(r).map((x) => x.attribute)).toEqual([
      'current_temperature',
      'temperature',
      'target_temp_low',
      'target_temp_high',
      'hvac_action',
    ]);
    expect(r.action.text).toBe(true);
    expect(r.current.text).toBeUndefined();
    expect(key(r.action)).toBe('climate.lounge|hvac_action|text');
    expect(key(r.current)).toBe('climate.lounge|current_temperature');
  });

  it('keeps words for a text series and numbers for the rest', () => {
    expect(toText('heating')).toBe('heating');
    expect(toText(3)).toBe('3');
    expect(toText(true)).toBe('true');
    expect(toText(null)).toBeUndefined();
    expect(toPoint(5, 'heating', true)).toEqual({ t: 5, v: null, s: 'heating' });
    expect(toPoint(5, '21')).toEqual({ t: 5, v: 21 });
    const rows = [
      { s: 'heat', a: { current_temperature: 19.5, hvac_action: 'heating' }, lu: 1 },
      { s: 'unavailable', a: {}, lu: 2 },
      { s: 'heat', a: { current_temperature: 20, hvac_action: 'idle' }, lu: 3 },
    ];
    expect(parseHistory(rows, 'hvac_action', true)).toEqual([
      { t: 1000, v: null, s: 'heating' },
      { t: 2000, v: null, s: undefined },
      { t: 3000, v: null, s: 'idle' },
    ]);
    expect(parseHistory(rows, 'current_temperature').map((x) => x.v)).toEqual([19.5, null, 20]);
    expect(parseHistory(rows, undefined, true).map((x) => x.s)).toEqual(['heat', 'unavailable', 'heat']);
  });

  it('loads every attribute in one call, and a text state in the compact one', async () => {
    const hass = makeHass({});
    const calls: Record<string, unknown>[] = [];
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      calls.push(msg);
      return {
        'climate.a': [{ s: 'heat', a: { current_temperature: 20, hvac_action: 'heating' }, lu: 1 }],
        'switch.b': [{ s: 'on', lu: 1 }],
      };
    }) as HomeAssistant['callWS'];
    const r = climateRequests('climate.a');
    const out = await loadHistory(hass, [...Object.values(r), { entity: 'switch.b', text: true }], {
      start: 0,
      end: 10_000,
    });
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.no_attributes === false)!.entity_ids).toEqual(['climate.a']);
    expect(out.get(key(r.current))).toEqual([{ t: 1000, v: 20 }]);
    expect(out.get(key(r.action))).toEqual([{ t: 1000, v: null, s: 'heating' }]);
    expect(out.get(key(r.target))).toEqual([{ t: 1000, v: null }]);
    expect(out.get('switch.b|text')).toEqual([{ t: 1000, v: null, s: 'on' }]);
  });

  it('appends live attribute changes, as numbers and as words', async () => {
    const hass = makeHass({ 'climate.a': ['heat', { current_temperature: 19, hvac_action: 'idle' }] });
    hass.callWS = vi.fn(async () => ({
      'climate.a': [{ s: 'heat', a: { current_temperature: 19, hvac_action: 'idle' }, lu: 1 }],
    })) as HomeAssistant['callWS'];
    const store = new HistoryStore(() => {});
    const r = climateRequests('climate.a');
    const series = Object.values(r);
    store.get(hass, series, { start: 0, end: 20_000 }, 'history');
    await flush();
    const next = {
      ...hass,
      states: {
        'climate.a': {
          ...hass.states['climate.a'],
          attributes: { current_temperature: 19.5, hvac_action: 'heating' },
          last_updated: new Date(15_000).toISOString(),
        },
      },
    };
    const loaded = store.get(next, series, { start: 0, end: 20_000 }, 'history');
    expect(loaded.data.get(key(r.current))!.map((x) => x.v)).toEqual([19, 19.5]);
    expect(loaded.data.get(key(r.action))!.map((x) => x.s)).toEqual(['idle', 'heating']);
    expect(loaded.data.get(key(r.target))!.map((x) => x.v)).toEqual([null, null]);
  });

  it('carries each part on to the present', () => {
    const r = climateRequests('climate.a');
    const loaded = new Map<string, Point[]>([
      [key(r.current), [p(0, 19), p(10, 20)]],
      [key(r.target), [p(0, 21), p(10, null)]],
      [key(r.action), [s(0, 'heating')]],
    ]);
    const d = climateData(loaded, r, 50, key);
    expect(d.current.at(-1)).toEqual({ t: 50, v: 20, carried: true });
    expect(d.target).toHaveLength(2);
    expect(d.action.at(-1)).toEqual({ t: 50, v: null, s: 'heating', carried: true });
    expect(d.low).toEqual([]);
  });

  it('sorts actions into heating, cooling, drying and fan, and idle into nothing', () => {
    expect(actionKind('heating')).toBe('heat');
    expect(actionKind('preheating')).toBe('heat');
    expect(actionKind('cooling')).toBe('cool');
    expect(actionKind('defrosting')).toBe('cool');
    expect(actionKind('drying')).toBe('dry');
    expect(actionKind('fan')).toBe('fan');
    expect(actionKind('idle')).toBeUndefined();
    expect(actionKind('off')).toBeUndefined();
    expect(actionKind(undefined)).toBeUndefined();
  });

  it('finds the stretches spent running, merging repeats, broken by idle and gaps', () => {
    const pts = [
      s(0, 'idle'),
      s(10, 'heating'),
      s(20, 'heating'),
      s(30, 'idle'),
      s(40, 'cooling'),
      s(50),
      s(60, 'fan'),
      s(70, 'heating'),
    ];
    expect(actionSpans(pts, 100)).toEqual([
      { kind: 'heat', action: 'heating', start: 10, end: 30 },
      { kind: 'cool', action: 'cooling', start: 40, end: 50 },
      { kind: 'fan', action: 'fan', start: 60, end: 70 },
      { kind: 'heat', action: 'heating', start: 70, end: 100 },
    ]);
    expect(actionSpans(pts, 100, ['heat']).map((x) => x.start)).toEqual([10, 70]);
    expect(actionSpans([s(0, 'heating'), s(0, 'idle')], 10)).toEqual([]);
    expect(actionSpans([], 10)).toEqual([]);
  });

  it('reads the value in effect at a time', () => {
    const pts = [p(10, 1), p(20, 2), p(30, 3)];
    expect(valueAt(pts, 5)).toBeUndefined();
    expect(valueAt(pts, 10)!.v).toBe(1);
    expect(valueAt(pts, 25)!.v).toBe(2);
    expect(valueAt(pts, 99)!.v).toBe(3);
  });

  it('holds a set point until it changes or goes away, dropping repeats', () => {
    expect(holdRuns([p(0, 21), p(10, 21), p(20, 18), p(30, null), p(40, 19), p(50, 19)])).toEqual([
      [
        { t: 0, v: 21 },
        { t: 20, v: 18 },
        { t: 30, v: 18 },
      ],
      [
        { t: 40, v: 19 },
        { t: 50, v: 19 },
      ],
    ]);
    expect(holdRuns([p(0, null)])).toEqual([]);
    expect(holdRuns([p(5, 20)])).toEqual([[{ t: 5, v: 20 }]]);
  });

  it('pairs a heat/cool range and draws the area between its ends', () => {
    const range = rangePoints([p(0, 19), p(10, 18), p(20, null), p(30, 19)], [p(0, 24), p(10, 25), p(30, null)]);
    expect(range.map((x) => x.v)).toEqual([[19, 24], [18, 25], null, null]);
    const d = rangeBandPath(
      range,
      (t) => t,
      (v) => v,
    );
    // Along the top (high) left to right, down, then back along the bottom (low), held between readings.
    expect(d).toBe('M0,24H10V25H20V25V18V18H10V19H0Z');
    expect(
      rangeBandPath(
        [],
        (t) => t,
        (v) => v,
      ),
    ).toBe('');
  });
});

describe('climate options', () => {
  it('fills in defaults from the theme and takes colours and switches', () => {
    const o = climateOptions({ type: 'x' });
    expect(o).toMatchObject({ setPoint: true, shading: true, shadeFan: false });
    expect(o.colors.current).toContain('--primary-color');
    expect(o.colors.setPoint).toContain('--error-color');
    expect(o.colors.heat).toContain('--state-climate-heat-color');
    expect(o.colors.cool).toContain('--state-climate-cool-color');
    const set = climateOptions({ type: 'x', set_point: false, heating_color: 'red', cooling_color: '#00f' });
    expect(set.setPoint).toBe(false);
    expect(set.colors.heat).toContain('--error-color');
    expect(set.colors.cool).toBe('#00f');
  });

  it("names actions with Home Assistant's words, else its own, else as written", () => {
    const entity = { stateObj: { entity_id: 'climate.a', state: 'heat', attributes: {} } } as ResolvedEntity;
    expect(actionLabel(makeHass({}), entity, 'heating')).toBe('Heating');
    expect(actionLabel(makeHass({}), entity, 'boosting')).toBe('boosting');
    const hass = makeHass({}, { formatEntityAttributeValue: (_s, _a, v) => `HA ${String(v)}` });
    expect(actionLabel(hass, entity, 'heating')).toBe('HA heating');
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;

const heatRows = [
  { s: 'heat', a: { current_temperature: 17, temperature: 18, hvac_action: 'heating' }, lu: sec(20 * H) },
  { s: 'heat', a: { current_temperature: 18.5, temperature: 18, hvac_action: 'idle' }, lu: sec(16 * H) },
  { s: 'unavailable', a: {}, lu: sec(12 * H) },
  { s: 'heat', a: { current_temperature: 19, temperature: 21, hvac_action: 'heating' }, lu: sec(8 * H) },
  { s: 'heat', a: { current_temperature: 20.6, temperature: 21, hvac_action: 'fan' }, lu: sec(2 * H) },
];
const rangeRows = [
  {
    s: 'heat_cool',
    a: { current_temperature: 25, target_temp_low: 19, target_temp_high: 24, hvac_action: 'cooling' },
    lu: sec(10 * H),
  },
  {
    s: 'heat_cool',
    a: { current_temperature: 22, target_temp_low: 19, target_temp_high: 24, hvac_action: 'idle' },
    lu: sec(5 * H),
  },
];

function hassWith(history: Record<string, unknown[]>, fail = false) {
  const hass = makeHass({
    'climate.lounge': [
      'heat',
      { friendly_name: 'Lounge', current_temperature: 20.6, temperature: 21, hvac_action: 'heating' },
    ],
    'climate.office': [
      'heat_cool',
      {
        friendly_name: 'Office',
        current_temperature: 22,
        target_temp_low: 19,
        target_temp_high: 24,
        hvac_action: 'idle',
      },
    ],
    'climate.gone': ['unavailable', { friendly_name: 'Gone' }],
    'sensor.temp': ['20', { friendly_name: 'Kitchen', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => {
    if (fail) throw new Error('boom');
    return history;
  }) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, hass = hassWith({ 'climate.lounge': heatRows })) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'climate',
    entities: ['climate.lounge'],
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await flush();
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (e: Element | null) => e!.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('climate chart', () => {
  it('draws the room temperature, a stepped set point and shading while heating, from one history call', async () => {
    const card = await mount({});
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
    const msg = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).toMatchObject({ entity_ids: ['climate.lounge'], no_attributes: false });
    const current = q(card, 'path.current')!;
    expect(current.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(current.getAttribute('stroke')).toContain('--primary-color');
    const target = qa(card, 'path.set-point')[0];
    expect(target.getAttribute('d')).toMatch(/H.*V/);
    expect(target.getAttribute('stroke')).toContain('--error-color');
    const spans = qa(card, 'rect.action-span');
    expect(spans).toHaveLength(2);
    expect(spans.every((r) => r.classList.contains('action-heat'))).toBe(true);
    expect(qa(card, '.series-item').map(text)).toEqual(['Lounge 20.6 °C', 'Set point 21.0 °C', 'Heating']);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Climate chart of Lounge');
  });

  it('draws a heat/cool range as two lines with the area between, and shades cooling', async () => {
    const card = await mount({ entities: ['climate.office'] }, hassWith({ 'climate.office': rangeRows }));
    const lines = qa(card, 'path.set-point').map((e) => e.getAttribute('d'));
    expect(lines[0]).toBe('');
    expect(lines[1]).not.toBe('');
    expect(lines[2]).not.toBe('');
    expect(q(card, 'path.range-band')!.getAttribute('d')).toMatch(/Z$/);
    expect(qa(card, 'rect.action-cool')).toHaveLength(1);
    expect(qa(card, '.series-item').map(text)).toEqual(['Office 22.0 °C', 'Set point 19.0 – 24.0 °C', 'Idle']);
  });

  it('hides the set point, the shading, or shades the fan, as asked', async () => {
    const plain = await mount({ set_point: false, shading: false });
    expect(qa(plain, 'path.set-point')).toHaveLength(0);
    expect(qa(plain, 'rect.action-span')).toHaveLength(0);
    expect(qa(plain, '.series-item').map(text)).toEqual(['Lounge 20.6 °C', 'Heating']);
    const fan = await mount({ shade_fan: true, heating_color: 'green', current_color: 'purple' });
    expect(qa(fan, 'rect.action-fan')).toHaveLength(1);
    expect(q(fan, 'rect.action-heat')!.getAttribute('fill')).toContain('--success-color');
    expect(q(fan, 'path.current')!.getAttribute('stroke')).toContain('--purple-color');
  });

  it('says when an entity is not a thermostat, and shows an unavailable one as such', async () => {
    const card = await mount({ entities: ['sensor.temp'] });
    expect(text(q(card, '.chart-message'))).toBe('Kitchen is not a thermostat. Pick a climate entity.');
    expect(qa(card, '.series-item').map(text)).toEqual(['Kitchen 20.0 °C']);
    const gone = await mount({ entities: ['climate.gone'] }, hassWith({ 'climate.gone': heatRows }));
    expect(qa(gone, '.series-item').map(text)).toEqual(['Gone Unavailable']);
    expect(q(gone, 'path.current')).not.toBeNull();
  });

  it('says when history is loading, failed, or empty', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'climate', entities: ['climate.lounge'] } as CardConfig);
    card.hass = hassWith({});
    document.body.appendChild(card);
    await card.updateComplete;
    expect(text(q(card, '.chart-message'))).toBe('Loading history…');
    const failed = await mount({}, hassWith({}, true));
    expect(text(q(failed, '.chart-message.error'))).toBe("Couldn't load history: boom");
    const empty = await mount({ header: 'over' }, hassWith({}));
    expect(text(q(empty, '.chart-message'))).toBe('No readings in this period.');
  });

  it('shows the temperature, set point and action at the guide', async () => {
    const card = await mount({});
    const area = q(card, '.plot-area')!;
    area.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, bubbles: true }));
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map(text);
    expect(rows).toEqual(['Lounge17.0 °C', 'Set point18.0 °C', 'Heating']);
    expect(q(card, '.hover-dot')).not.toBeNull();
  });

  it('takes new readings live', async () => {
    const hass = hassWith({ 'climate.lounge': heatRows });
    const card = await mount({}, hass);
    expect(qa(card, 'rect.action-span')).toHaveLength(2);
    card.hass = {
      ...hass,
      states: {
        ...hass.states,
        'climate.lounge': {
          ...hass.states['climate.lounge'],
          attributes: { ...hass.states['climate.lounge'].attributes, hvac_action: 'heating', current_temperature: 20 },
          last_updated: new Date(now - H).toISOString(),
        },
      },
    };
    await card.updateComplete;
    expect(qa(card, 'rect.action-span')).toHaveLength(3);
    expect(card.hass.callWS).toHaveBeenCalledTimes(1);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'climate', entities: ['climate.lounge'], ...extra } as CardConfig);
    expect(set({ source: 'statistics' })).toThrow(/"source" must be history/);
    expect(set({ group_by: 'hour' })).toThrow(/group_by/);
    expect(set({ set_point: 'yes' })).toThrow(/"set_point" must be true or false/);
    expect(set({ heating_color: 3 })).toThrow(/heating_color/);
    expect(set({ curve: 'wiggly' })).toThrow(/curve/);
    expect(set({ source: 'history', shade_fan: true })).not.toThrow();
  });
});

describe('climate chart editor', () => {
  it('shows the Chart section without source or grouping, and writes the climate options', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'climate', entities: ['climate.lounge'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      period_calendar: 'rolling',
      period_last: 24,
      period_unit: 'hour',
      period_offset: 0,
      period_until: 'now',
      period_navigate: false,
      set_point: true,
      shading: true,
      shade_fan: false,
      curve: 'smooth',
      line_width: 2.5,
      x_axis: true,
      y_axis: true,
      axis_labels: 'outside',
      grid_horizontal: true,
      grid_vertical: false,
      tooltip: true,
      header: 'above',
      compact: false,
      legend_toggle: false,
    });
    const names = JSON.stringify(form.schema);
    expect(names).not.toMatch(/"source"|"group_by"|"aggregate"/);
    expect(names).toMatch(/"heating_color"/);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), shading: false, heating_color: 'red', shade_fan: true } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, shading: false, heating_color: 'red', shade_fan: true });
    const label = (form.computeLabel as (s: { name: string }) => string)({ name: 'set_point_color' });
    expect(label).toBe('Set point colour');
  });
});
