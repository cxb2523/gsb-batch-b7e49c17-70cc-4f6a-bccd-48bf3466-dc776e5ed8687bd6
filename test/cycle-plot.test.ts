import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { cycleColumns, cycleData, panelMean } from '../src/chart/cycle';
import { STYLES } from '../src/styles';
import { cycleOptions, cycleRaw } from '../src/styles/cycle-plot';
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
const mon = Date.UTC(2024, 0, 1);

describe('cycle maths', () => {
  it('folds hours into a panel per weekday, averaging each hour across weeks', () => {
    const data = cycleData(
      [
        { t: mon + 8 * H, v: 10 },
        { t: mon + 7 * D + 8 * H, v: 20 },
        { t: mon + D + 9 * H, v: 4 },
        { t: mon + D + 10 * H, v: null },
      ],
      'day_of_week',
      utc,
      { start: mon, end: mon + 14 * D },
    );
    expect(data.slots).toBe(24);
    expect(data.panels.map((p) => p.key)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(data.panels[0].values[8]).toBe(15);
    expect(data.panels[1].values[9]).toBe(4);
    expect(data.panels[1].values[10]).toBeNull();
    expect(data.panels[2].values.every((v) => v === null)).toBe(true);
  });

  it('runs each hour of the day across the days of the span', () => {
    const points = Array.from({ length: 3 * 24 }, (_, i) => ({ t: mon + i * H, v: i }));
    const data = cycleData(points, 'hour_of_day', utc, { start: mon, end: mon + 3 * D });
    expect(data.slots).toBe(3);
    expect(data.panels).toHaveLength(24);
    expect(data.panels[7].values).toEqual([7, 31, 55]);
    expect(data.first).toBe(Math.round(mon / D));
    // A span starting part way through a day still counts that day.
    expect(cycleData(points, 'hour_of_day', utc, { start: mon + 12 * H, end: mon + 3 * D }).slots).toBe(3);
  });

  it('runs each day of the month across the months of the span', () => {
    const points = [
      { t: Date.UTC(2024, 0, 5), v: 1 },
      { t: Date.UTC(2024, 1, 5), v: 2 },
      { t: Date.UTC(2024, 2, 31), v: 3 },
    ];
    const data = cycleData(points, 'day_of_month', utc, { start: Date.UTC(2024, 0, 1), end: Date.UTC(2024, 3, 1) });
    expect(data.slots).toBe(3);
    expect(data.panels).toHaveLength(31);
    expect(data.panels[4]).toEqual({ key: 5, values: [1, 2, null] });
    expect(data.panels[30].values).toEqual([null, null, 3]);
    expect(data.first).toBe(2024 * 12);
  });

  it('averages a panel and fits panels into columns', () => {
    expect(panelMean([1, null, 3])).toBe(2);
    expect(panelMean([null])).toBeUndefined();
    expect(cycleColumns(7, 450, 34)).toBe(7);
    expect(cycleColumns(7, 200, 34)).toBe(4);
    expect(cycleColumns(24, 450, 34)).toBe(8);
    expect(cycleColumns(24, 250, 34)).toBe(6);
    expect(cycleColumns(31, 250, 34)).toBe(6);
  });

  it('reads its options and sets the span, grouping and source from the cycle', () => {
    expect(cycleOptions({} as CardConfig)).toEqual({ cycle: 'day_of_week', weeks: 8 });
    expect(cycleOptions({ cycle: 'hour_of_day' } as CardConfig)).toEqual({ cycle: 'hour_of_day', weeks: 2 });
    const raw = cycleRaw({ weeks: 4, period: { calendar: 'week', offset: 1 } } as unknown as CardConfig);
    expect(raw).toMatchObject({ group_by: 'hour', source: 'history', period: { offset: 1, last: 4, unit: 'week' } });
    expect((raw.period as Record<string, unknown>).calendar).toBeUndefined();
    expect(cycleRaw({ cycle: 'day_of_month' } as CardConfig)).toMatchObject({ group_by: 'day', source: 'statistics' });
    expect(cycleRaw({ cycle: 'day_of_month', source: 'history' } as CardConfig).source).toBe('history');
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();

function hassWith(history: Record<string, unknown>) {
  const hass = makeHass({
    'sensor.power': ['300', { friendly_name: 'Power', unit_of_measurement: 'W' }],
    'sensor.other': ['20', { friendly_name: 'Other', unit_of_measurement: 'W' }],
    'sensor.gone': ['unavailable', { friendly_name: 'Gone' }],
  });
  hass.config = { time_zone: 'UTC' } as HomeAssistant['config'];
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

// A reading every hour for 8 weeks: 500 W from 7 to 9 in the morning, 100 W otherwise.
const power = Array.from({ length: 8 * 7 * 24 }, (_, i) => {
  const t = now - 8 * 7 * D + i * H;
  const h = new Date(t).getUTCHours();
  return { s: String(h >= 7 && h < 9 ? 500 : 100), lu: t / 1000 };
});
const history = { 'sensor.power': power, 'sensor.gone': [{ s: 'unavailable', lu: (now - 2 * D) / 1000 }] };

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'cycle_plot',
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

describe('cycle plot chart', () => {
  it('draws a panel per weekday with each series line and a dashed panel average', async () => {
    const card = await mount({});
    expect(qa(card, '.cy-panel')).toHaveLength(7);
    expect(qa(card, '.cy-title').map(text)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    // Power has a line and an average in every panel; Gone has neither.
    expect(qa(card, '.cy-series[data-series="0"] .cy-line')).toHaveLength(7);
    expect(qa(card, '.cy-series[data-series="0"] .cy-mean')).toHaveLength(7);
    expect(qa(card, '.cy-series[data-series="1"] .cy-mean')).toHaveLength(0);
    expect(q(card, '.cy-mean')!.classList.contains('multi')).toBe(true);
    expect(q(card, '.cy')!.getAttribute('aria-label')).toBe('Cycle plot chart of Power, Gone');
    expect(text(q(card, '.cy-legend')!)).toContain('Average of each hour over 8 weeks');
    expect(text(q(card, '.cy-legend')!)).toContain('Panel average');
    expect(text(q(card, '.cy-ends')!)).toBe('12 AM – 11 PM');
    expect(qa(card, '.cy-tick').length).toBeGreaterThan(1);
  });

  it('draws one panel per hour across the days, wrapping onto rows', async () => {
    const card = await mount({ cycle: 'hour_of_day', entities: ['sensor.power'] } as Partial<CardConfig>);
    expect(qa(card, '.cy-panel')).toHaveLength(24);
    expect(q(card, '.cy-titles')).toBeNull();
    expect(qa(card, '.cy-inline-title').map(text).slice(0, 2)).toEqual(['12 AM', '1 AM']);
    expect(q(card, '.cy-mean.multi')).toBeNull();
    expect(text(q(card, '.cy-legend')!)).toContain('Each hour, day by day, over 2 weeks');
    expect(text(q(card, '.cy-ends')!)).toMatch(/^\w{3} \d+ – \w{3} \d+$/);
  });

  it('shows the point and panel average under the pointer', async () => {
    const card = await mount({ entities: ['sensor.power'] });
    const grid = q(card, '.cy-grid')!;
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 280, height: 120, right: 280, bottom: 120 }) as DOMRect;
    // The first panel (weeks start on Sunday in English), a third of the way along: 8 in the morning.
    grid.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 12, clientY: 60 }));
    await card.updateComplete;
    expect(text(q(card, '.tooltip-time')!)).toMatch(/^Sunday 8:00 AM – 9:00 AM$/);
    const rows = qa(card, '.tooltip-row').map(text);
    expect(rows[0]).toBe('Power 500.0 W');
    expect(rows[1]).toMatch(/^Sun average [\d.]+ W$/);
    expect(q(card, '.cy-guide')).not.toBeNull();
    grid.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
  });

  it('opens an entity from its legend entry', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const el = q(card, '.cy-key.entity')!;
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
      card.setConfig({ type: 'x', style: 'cycle_plot', entities: ['sensor.power'], ...extra } as CardConfig);
    expect(set({ cycle: 'year' })).toThrow(/"cycle" must be one of: day_of_week, hour_of_day, day_of_month/);
    expect(set({ weeks: 30 })).toThrow(/"weeks" must be a whole number from 1 to 26/);
    expect(set({ cycle: 'hour_of_day', weeks: 14 })).toThrow(/from 1 to 13/);
    expect(set({ weeks: 1.5 })).toThrow(/weeks/);
    expect(set({ tooltip: 'no' })).toThrow(/tooltip/);
    expect(set({ cycle: 'day_of_month', weeks: 52, aggregate: 'change' })).not.toThrow();
  });

  it('has a thumbnail', () => {
    const style = STYLES.cycle_plot;
    expect(style.layout).toBe('chart');
    if (style.layout === 'chart') expect(style.thumbnail().values[0] as unknown[]).toHaveLength(5);
  });
});

describe('cycle plot editor', () => {
  it('writes the cycle and weeks, and shows the source the cycle reads', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'cycle_plot', entities: ['sensor.power'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({ cycle_plot_cycle: 'day_of_week', source: 'history', tooltip: true });
    expect(JSON.stringify(form.schema)).toContain('"max":26');
    expect((form.computeLabel as (s: { name: string }) => string)({ name: 'cycle_plot_cycle' })).toBe('One panel per');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), cycle_plot_cycle: 'day_of_month', cycle_plot_weeks: 52 } },
      }),
    );
    expect(events.at(-1)).toMatchObject({ ...raw, cycle: 'day_of_month', weeks: 52 });
    ed.setConfig({ ...raw, cycle: 'day_of_month' } as CardConfig);
    await ed.updateComplete;
    const monthly = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(monthly.data).toMatchObject({ source: 'statistics' });
    expect(JSON.stringify(monthly.schema)).toContain('"max":104');
  });
});
