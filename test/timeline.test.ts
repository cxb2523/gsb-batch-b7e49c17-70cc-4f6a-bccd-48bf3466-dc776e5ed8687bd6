import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  DEFAULT_STATE_COLORS,
  formatDuration,
  isGap,
  isMeasurement,
  labelWidth,
  spanAt,
  spanBox,
  stateColor,
  stateSpans,
  timelineRows,
  wordHash,
} from '../src/chart/timeline';
import { key, loadHistory, parseHistory } from '../src/history/fetch';
import { HistoryStore } from '../src/history/store';
import { suggestState, timelineEntityFields, withStateColors } from '../src/editor/timeline-editor';
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

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const H = 3_600_000;
const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;

const pts = (...rows: [number, string | undefined][]) => rows.map(([t, s]) => ({ t, v: null, s }));

describe('state spans', () => {
  it('lasts each state until the next, joins repeats, and stops at the present', () => {
    expect(stateSpans(pts([0, 'off'], [10, 'on'], [20, 'on'], [30, 'off'], [50, 'on']), 40)).toEqual([
      { start: 0, end: 10, state: 'off' },
      { start: 10, end: 30, state: 'on' },
      { start: 30, end: 40, state: 'off' },
    ]);
    expect(stateSpans(pts([0, 'on'], [0, 'off']), 5)).toEqual([{ start: 0, end: 5, state: 'off' }]);
    expect(stateSpans([], 5)).toEqual([]);
  });

  it('finds the span at a time, the last one including its end', () => {
    const spans = stateSpans(pts([0, 'off'], [10, 'on']), 20);
    expect(spanAt(spans, 5)?.state).toBe('off');
    expect(spanAt(spans, 10)?.state).toBe('on');
    expect(spanAt(spans, 20)?.state).toBe('on');
    expect(spanAt(spans, 25)).toBeUndefined();
  });

  it('places a span across the range, clamped to it', () => {
    expect(spanBox({ start: 0, end: 50, state: 'on' }, { start: 0, end: 100 })).toEqual({ left: 0, width: 0.5 });
    expect(spanBox({ start: -50, end: 150, state: 'on' }, { start: 0, end: 100 })).toEqual({ left: 0, width: 1 });
    expect(spanBox({ start: 0, end: 5, state: 'on' }, { start: 10, end: 10 })).toEqual({ left: 0, width: 0 });
  });

  it('treats unavailable, unknown and nothing as gaps', () => {
    expect(['unavailable', 'unknown', '', undefined].every(isGap)).toBe(true);
    expect(isGap('off')).toBe(false);
  });

  it('spots a measurement: many different numbers, and nothing else', () => {
    const many = stateSpans(
      pts(...Array.from({ length: 12 }, (_, i): [number, string] => [i, String(20 + i / 10)])),
      12,
    );
    expect(isMeasurement(many)).toBe(true);
    expect(isMeasurement(stateSpans(pts([0, '1'], [1, '2'], [2, '3']), 3))).toBe(false);
    expect(isMeasurement([...many, { start: 12, end: 13, state: 'on' }])).toBe(false);
    expect(isMeasurement([...many, { start: 12, end: 13, state: 'unavailable' }])).toBe(true);
  });
});

describe('state colours', () => {
  it('follows the theme for a known state, falling back to its default', () => {
    expect(stateColor('heat', 'climate', undefined)).toEqual({
      color: 'var(--state-climate-heat-color, #ff8100)',
      quiet: false,
      text: 'light',
    });
    expect(stateColor('on', 'switch', undefined).color).toBe(
      'var(--state-switch-on-color, var(--warning-color, #f59e0b))',
    );
    expect(stateColor('on', 'switch', undefined).text).toBe('dark');
  });

  it('draws quiet states faint, and the card’s own colours win', () => {
    expect(stateColor('off', 'light', undefined)).toMatchObject({ quiet: true, text: 'theme' });
    expect(stateColor('off', 'light', { off: 'red' })).toEqual({
      color: 'var(--error-color, #ef3b5a)',
      quiet: false,
      text: 'light',
    });
  });

  it('gives an unknown word a stable colour of its own, and skips the theme lookup for odd words', () => {
    const a = stateColor('rinse', 'sensor', undefined);
    expect(a).toEqual(stateColor('rinse', 'sensor', undefined));
    expect(a.quiet).toBe(false);
    expect(wordHash('rinse')).toBe(wordHash('rinse'));
    expect(stateColor('Mode 2', 'sensor', undefined).color).not.toContain('--state-');
    expect(Object.keys(DEFAULT_STATE_COLORS)).toContain('home');
  });
});

describe('durations and rows', () => {
  it('writes a length of time short', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(3.5 * H)).toBe('3 h 30');
    expect(formatDuration(2 * H)).toBe('2 h');
    expect(formatDuration(52 * H)).toBe('2 d 4 h');
    expect(formatDuration(48 * H)).toBe('2 d');
    expect(formatDuration(-5)).toBe('0 s');
    expect(labelWidth('Heat')).toBeGreaterThan(30);
  });

  it('brings a group together under a heading where it is first listed', () => {
    const items = [
      { id: 'a' },
      { id: 'b', g: 'People' },
      { id: 'c' },
      { id: 'd', g: 'People' },
      { id: 'e', g: 'Cars' },
    ];
    const rows = timelineRows(items, (i) => i.g).map((r) => ('heading' in r ? `#${r.heading}` : r.item.id));
    expect(rows).toEqual(['a', '#People', 'b', 'd', 'c', '#Cars', 'e']);
  });
});

describe('loading states as words', () => {
  it('keeps the words for a text series and numbers for the rest, in one call', async () => {
    const hass = makeHass({});
    hass.callWS = vi.fn(async () => ({
      'switch.a': [
        { s: 'on', lu: 1 },
        { s: 'off', lu: 2 },
      ],
      'sensor.t': [{ s: '21.5', lu: 1 }],
    })) as HomeAssistant['callWS'];
    const out = await loadHistory(hass, [{ entity: 'switch.a', text: true }, { entity: 'sensor.t' }], {
      start: 0,
      end: 5000,
    });
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    expect(out.get('switch.a|text')).toEqual([
      { t: 1000, v: null, s: 'on' },
      { t: 2000, v: null, s: 'off' },
    ]);
    expect(out.get('sensor.t')).toEqual([{ t: 1000, v: 21.5 }]);
    expect(key({ entity: 'switch.a', text: true })).toBe('switch.a|text');
    // A number series reads on/off as 1/0 (see toReading), a text series keeps the words.
    expect(parseHistory([{ s: 'on', lu: 1 }])).toEqual([{ t: 1000, v: 1 }]);
  });

  it('appends live states as words', async () => {
    const hass = makeHass({ 'switch.a': 'on' });
    hass.states['switch.a'].last_updated = new Date(now - H).toISOString();
    hass.callWS = vi.fn(async () => ({ 'switch.a': [{ s: 'off', lu: sec(5 * H) }] })) as HomeAssistant['callWS'];
    const store = new HistoryStore(() => undefined);
    const req = [{ entity: 'switch.a', text: true }];
    const range = { start: now - 24 * H, end: now };
    store.get(hass, req, range, 'history');
    await new Promise((r) => setTimeout(r, 0));
    hass.states = { ...hass.states, 'switch.a': { ...hass.states['switch.a'], state: 'on' } };
    const points = store.get(hass, req, range, 'history').data.get('switch.a|text')!;
    expect(points.map((p) => p.s)).toEqual(['off', 'on']);
  });
});

/* ------------------------------------------------------------------ card ------------------------------------------------------------------ */

const history = {
  'switch.heater': [
    { s: 'off', lu: sec(20 * H) },
    { s: 'on', lu: sec(12 * H) },
    { s: 'off', lu: sec(8 * H) },
  ],
  'person.alex': [
    { s: 'home', lu: sec(30 * H) },
    { s: 'not_home', lu: sec(10 * H) },
    { s: 'unavailable', lu: sec(6 * H) },
    { s: 'home', lu: sec(2 * H) },
  ],
  'sensor.temp': Array.from({ length: 20 }, (_, i) => ({ s: String(18 + i / 10), lu: sec((20 - i) * H) })),
};

function hassWith(rows: Record<string, unknown[]> = history, fail = false) {
  const hass = makeHass({
    'switch.heater': ['off', { friendly_name: 'Heater' }],
    'person.alex': ['home', { friendly_name: 'Alex' }],
    'sensor.temp': ['19.9', { friendly_name: 'Temp', unit_of_measurement: '°C' }],
  });
  hass.formatEntityState = (s, state) => {
    const v = state ?? s.state;
    return (
      ({ on: 'On', off: 'Off', home: 'Home', not_home: 'Away', unavailable: 'Unavailable' } as Record<string, string>)[
        v
      ] ?? v
    );
  };
  hass.callWS = vi.fn(async () => {
    if (fail) throw new Error('boom');
    return rows;
  }) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig> = {}, hass = hassWith()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'timeline',
    entities: ['switch.heater', 'person.alex'],
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
const text = (e: Element | null) => e!.textContent!.replace(/\s+/g, ' ').trim();

function point(el: Element, type: string, frac: number) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: frac * 1000 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('state timeline', () => {
  it('draws a row of state bars per entity, with names, a legend and time labels', async () => {
    const card = await mount();
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
    expect(qa(card, '.tl-name').map(text)).toEqual(['Heater', 'Alex']);
    const rows = qa(card, '.tl-row');
    expect(rows).toHaveLength(2);
    // Heater: off (carried in), on, off. Alex: away, a gap while unavailable, home.
    expect(rows[0].querySelectorAll('.tl-bar')).toHaveLength(3);
    expect(rows[1].querySelectorAll('.tl-bar')).toHaveLength(3);
    const on = rows[0].querySelectorAll('.tl-bar')[1] as HTMLElement;
    expect(on.getAttribute('style')).toContain('--state-switch-on-color');
    expect(on.classList.contains('quiet')).toBe(false);
    expect(rows[0].querySelector('.tl-bar')!.classList.contains('quiet')).toBe(true);
    expect(qa(card, '.tl-key').map(text)).toEqual(['On', 'Home', 'Off', 'Away']);
    expect(qa(card, '.x-axis .axis-label').length).toBeGreaterThan(1);
    expect(qa(card, '.tl-grid').length).toBeGreaterThan(1);
    expect(q(card, '.tl-plot')!.getAttribute('aria-label')).toBe('State timeline chart of Heater, Alex');
    expect(q(card, '.tl-plot')!.getAttribute('role')).toBe('img');
  });

  it('labels the bars that have room with the state, how long, or both', async () => {
    const labels = async (bar_labels?: string) =>
      Array.from(qa(await mount(bar_labels ? { bar_labels } : {}), '.tl-row')[0].querySelectorAll('.tl-label')).map(
        text,
      );
    expect(await labels()).toContain('On');
    expect(await labels('duration')).toContain('4 h');
    expect(await labels('both')).toContain('Off · 8 h');
    expect(await labels('none')).toEqual([]);
  });

  it('groups rows under headings, and uses the card’s own colours', async () => {
    const card = await mount({
      state_colors: { on: 'red' },
      entities: ['switch.heater', { entity: 'person.alex', group: 'People' }],
    } as Partial<CardConfig>);
    expect(qa(card, '.tl-heading').map(text)).toEqual(['People']);
    expect(qa(card, '.tl-gap')).toHaveLength(1);
    expect(qa(card, '.tl-bar')[1].getAttribute('style')).toContain('--tl-color:var(--error-color');
  });

  it('shows a hint for a measurement, and hides names and legend when asked', async () => {
    const card = await mount({
      entities: ['switch.heater', 'sensor.temp'],
      header: 'hidden',
      show: { name: false },
      compact: true,
      x_axis: false,
      gridlines: { vertical: false },
    } as Partial<CardConfig>);
    expect(text(q(card, '.tl-hint'))).toBe('Readings, not states: a line chart suits this one');
    expect(q(card, '.tl-legend')).toBeNull();
    expect(q(card, '.tl-names')).toBeNull();
    expect(q(card, '.tl-wrap')!.classList.contains('no-names')).toBe(true);
    expect(q(card, '.x-axis')).toBeNull();
    expect(qa(card, '.tl-grid')).toHaveLength(0);
    expect(q(card, '.frame.compact')).not.toBeNull();
  });

  it('marks now when the period runs on past it', async () => {
    const card = await mount({ period: { calendar: 'day', until: 'end' } } as Partial<CardConfig>);
    expect(q(card, '.tl-now')).not.toBeNull();
    const rolling = await mount();
    expect(q(rolling, '.tl-now')).toBeNull();
  });

  it('shows each row’s state, and for how long, under the pointer', async () => {
    const card = await mount();
    const area = q(card, '.tl-plot')!;
    expect(area.classList.contains('hoverable')).toBe(true);
    // 18 hours ago: the heater was on (12 h to 8 h ago is 4 h), Alex home.
    point(area, 'pointermove', 1 - 10 / 24);
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map(text);
    expect(rows).toEqual(['Heater On for 4 h', 'Alex Away for 4 h']);
    point(area, 'pointermove', 1 - 4 / 24);
    await card.updateComplete;
    expect(qa(card, '.tooltip-row').map(text)[1]).toBe('Alex Unavailable');
    area.dispatchEvent(Object.assign(new MouseEvent('pointerleave', { bubbles: true }), { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
    const off = await mount({ tooltip: false });
    expect(q(off, '.tl-plot')!.classList.contains('hoverable')).toBe(false);
  });

  it('says when history is loading, failed, or holds no states', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'timeline', entities: ['switch.heater'] } as CardConfig);
    card.hass = hassWith();
    document.body.appendChild(card);
    await card.updateComplete;
    expect(text(q(card, '.chart-message'))).toBe('Loading history…');
    const failed = await mount({}, hassWith(history, true));
    expect(text(q(failed, '.chart-message.error'))).toBe("Couldn't load history: boom");
    const empty = await mount({}, hassWith({ 'switch.heater': [{ s: 'unavailable', lu: sec(H) }] }));
    expect(text(q(empty, '.chart-message'))).toBe('No states recorded in this period.');
  });

  it('opens more-info from a name or a row', async () => {
    const card = await mount();
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    for (const el of [qa(card, '.tl-name')[1], qa(card, '.tl-row')[0]] as HTMLElement[]) {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    }
    expect(fired).toEqual(['person.alex', 'switch.heater']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'timeline', entities: ['switch.heater'], ...extra } as CardConfig);
    expect(set({ source: 'statistics' })).toThrow(/source/);
    expect(set({ group_by: 'day' })).toThrow(/group_by/);
    expect(set({ bar_labels: 'loud' })).toThrow(/bar_labels/);
    expect(set({ x_axis: 'yes' })).toThrow(/x_axis/);
    expect(set({ gridlines: 'yes' })).toThrow(/gridlines/);
    expect(set({ gridlines: { vertical: 1 } })).toThrow(/gridlines.vertical/);
    expect(set({ state_colors: ['red'] })).toThrow(/state_colors/);
    expect(set({ state_colors: { on: 3 } })).toThrow(/"on"/);
    expect(set({ entities: [{ entity: 'switch.heater', group: 3 }] })).toThrow(/group/);
    expect(set({ tooltip: 'no' })).toThrow(/tooltip/);
    expect(set({ compact: 'no' })).toThrow(/compact/);
    expect(set({ state_colors: { on: 'red' }, bar_labels: 'both', source: 'history' })).not.toThrow();
  });
});

/* ----------------------------------------------------------------- editor ----------------------------------------------------------------- */

describe('state timeline editor', () => {
  async function editor(config: Partial<CardConfig> = {}) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({ 'switch.heater': 'on' });
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'timeline',
      entities: ['switch.heater'],
      ...config,
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events, raw };
  }

  it('writes the Chart section, without source or grouping', async () => {
    const { ed, events, raw } = await editor();
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      period_calendar: 'rolling',
      period_last: 24,
      period_unit: 'hour',
      period_offset: 0,
      period_until: 'now',
      period_navigate: false,
      bar_labels: 'state',
      x_axis: true,
      grid_vertical: true,
      tooltip: true,
      timeline_legend: 'above',
      compact: false,
    });
    const names = JSON.stringify(form.schema);
    expect(names).not.toContain('"source"');
    expect(names).not.toContain('"group_by"');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: { ...(form.data as object), bar_labels: 'both', grid_vertical: false, timeline_legend: 'hidden' },
        },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, bar_labels: 'both', gridlines: { vertical: false }, header: 'hidden' });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect((list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual(['timeline_group']);
  });

  it('adds, renames, recolours and removes state colours', async () => {
    const { ed, events, raw } = await editor();
    const section = () => ed.shadowRoot!.querySelector('.state-colors')!;
    (section().querySelector('.sc-add') as HTMLElement).click();
    expect(events.at(-1)).toEqual({ ...raw, state_colors: { on: 'primary' } });

    const { ed: ed2, events: ev2, raw: raw2 } = await editor({ state_colors: { on: 'amber', off: 'grey' } });
    const rows = [...ed2.shadowRoot!.querySelectorAll('.state-colors .sc-row')];
    expect(rows).toHaveLength(2);
    const fire = (el: Element, value: string) =>
      el.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: true }));
    fire(rows[0].querySelector('[data-role="color"]')!, 'red');
    expect(ev2.at(-1)).toEqual({ ...raw2, state_colors: { on: 'red', off: 'grey' } });
    fire(rows[1].querySelector('[data-role="state"]')!, 'idle');
    expect(ev2.at(-1)).toEqual({ ...raw2, state_colors: { on: 'amber', idle: 'grey' } });
    const count = ev2.length;
    fire(rows[1].querySelector('[data-role="color"]')!, '');
    expect(ev2).toHaveLength(count);
    (rows[0].querySelector('.sc-remove') as HTMLElement).click();
    expect(ev2.at(-1)).toEqual({ ...raw2, state_colors: { off: 'grey' } });
  });

  it('suggests a state for a new colour, and drops the key when the list empties', () => {
    const hass = makeHass({ 'switch.a': 'on', 'person.b': 'not_home' });
    const config = { type: 'x', entities: ['switch.a', { entity: 'person.b' }] } as CardConfig;
    expect(suggestState(config, hass)).toBe('on');
    expect(suggestState({ ...config, state_colors: { on: 'red' } }, hass)).toBe('not_home');
    const all = Object.fromEntries(['on', 'off', 'home', 'not_home', 'heat', 'idle'].map((s) => [s, 'red']));
    expect(suggestState({ type: 'x', state_colors: all }, undefined)).toBe('state_7');
    expect(withStateColors({ type: 'x', state_colors: { on: 'red' } }, [])).toEqual({ type: 'x' });
    expect(
      withStateColors({ type: 'x' }, [
        [' on ', 'red'],
        ['', 'blue'],
      ]),
    ).toEqual({ type: 'x', state_colors: { on: 'red' } });
    expect(timelineEntityFields(undefined).schema).toBe(timelineEntityFields(undefined).schema);
  });
});
