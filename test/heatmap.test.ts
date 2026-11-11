import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { calendarCells, colorExtent, fraction, hexPath, shade, weekCells } from '../src/chart/heatmap-grid';
import { heatmapRaw } from '../src/styles/heatmap';
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

describe('heatmap maths', () => {
  it('folds hours into weekday rows and hour columns, averaging across weeks', () => {
    const mon14 = Date.UTC(2024, 0, 1, 14);
    const cells = weekCells(
      [
        { t: mon14, v: 10 },
        { t: mon14 + 7 * D, v: 20 },
        { t: mon14 + D, v: null },
        { t: mon14 + D + H, v: 4 },
      ],
      utc,
    );
    expect(cells).toHaveLength(168);
    expect(cells[14]).toEqual({ row: 0, hour: 14, v: 15, count: 2 });
    expect(cells[24 + 14].v).toBeNull();
    expect(cells[24 + 15].v).toBe(4);
    // Weeks from Sunday: Monday is the second row.
    expect(weekCells([{ t: mon14, v: 1 }], { timeZone: 'UTC', firstDay: 7 })[24 + 14].v).toBe(1);
    // The wall clock in the zone decides the hour: 14:00 UTC is 15:00 in Paris in winter.
    expect(weekCells([{ t: mon14, v: 1 }], { timeZone: 'Europe/Paris', firstDay: 1 })[15].v).toBe(1);
  });

  it('lays days out in week columns from the first weekday, naming each month where it starts', () => {
    const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ t: from + i * D, v: i }));
    const jan = calendarCells(days(Date.UTC(2024, 0, 1), 70), utc);
    expect(jan.cells[0]).toEqual({ t: Date.UTC(2024, 0, 1), col: 0, row: 0, v: 0 });
    expect(jan.cells[9]).toMatchObject({ col: 1, row: 2 });
    expect(jan.weeks).toBe(10);
    // 1 Feb 2024 was a Thursday, in the week of Monday 29 January: column 4.
    expect(jan.months.map((m) => m.col)).toEqual([0, 4, 8]);
    // Opening on 31 January: no room to name January before February starts.
    const late = calendarCells(days(Date.UTC(2024, 0, 31), 10), utc);
    expect(late.cells[0]).toMatchObject({ col: 0, row: 2 });
    expect(late.months).toEqual([{ col: 0, t: Date.UTC(2024, 1, 1) }]);
    expect(calendarCells([], utc)).toEqual({ cells: [], weeks: 0, months: [] });
  });

  it('sets the colour scale from the values or fixed ends', () => {
    expect(colorExtent([null, 3, 9])).toEqual([3, 9]);
    expect(colorExtent([null])).toBeUndefined();
    expect(colorExtent([5, 5])).toEqual([5, 6]);
    expect(colorExtent([5, 8], { max: 2 })).toEqual([1, 2]);
    expect(colorExtent([], { min: 0, max: 10 })).toEqual([0, 10]);
    expect(fraction(15, [0, 10])).toBe(1);
    expect(fraction(-1, [0, 10])).toBe(0);
    expect(fraction(5, [0, 10])).toBe(0.5);
    expect(shade('red', 1)).toBe('red');
    expect(shade('red', 0)).toBe('color-mix(in srgb, red 12%, var(--card-background-color, #fff))');
    expect(hexPath(5, 5, 10).match(/[ML]/g)).toHaveLength(6);
  });

  it('fills in each layout’s grouping, span and source', () => {
    expect(heatmapRaw({ type: 'x' })).toMatchObject({
      group_by: 'hour',
      source: 'history',
      period: { last: 4, unit: 'week' },
    });
    expect(heatmapRaw({ type: 'x', grid: 'calendar', group_by: 'week' })).toMatchObject({
      group_by: 'day',
      source: 'statistics',
      period: { last: 12, unit: 'month' },
    });
    expect(heatmapRaw({ type: 'x', grid: 'calendar', source: 'history', period: { calendar: 'year' } })).toMatchObject({
      source: 'history',
      period: { calendar: 'year' },
    });
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

function hassWithData() {
  const hass = makeHass({
    'sensor.power': ['300', { friendly_name: 'Power', unit_of_measurement: 'W' }],
    'sensor.down': ['unavailable', { friendly_name: 'Down' }],
  });
  // The server's zone is the browser's: statistics come as whole days.
  hass.config = { time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const now = Date.now();
  hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    if (msg.type === 'history/history_during_period') {
      const rows = [];
      for (let t = now - 30 * D; t < now; t += H) rows.push({ s: String(Math.round(t / H) % 24), lu: t / 1000 });
      return { 'sensor.power': rows };
    }
    const rows = [];
    for (let t = Math.floor((now - 400 * D) / D) * D; t < now; t += D) {
      rows.push({ start: t, end: t + D, mean: (t / D) % 10, state: 1, change: 2 });
    }
    return { 'sensor.power': rows };
  }) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, hass = hassWithData()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'heatmap',
    entities: ['sensor.power'],
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('heatmap card', () => {
  it('draws an hour-by-weekday grid of rounded cells with a gradient legend', async () => {
    const card = await mount({});
    expect(qa(card, '.hm')).toHaveLength(1);
    expect(qa(card, 'rect.cell')).toHaveLength(168);
    expect(q(card, 'rect.cell')!.getAttribute('rx')).toBe('2');
    expect(q(card, 'svg.hm-svg')!.getAttribute('role')).toBe('img');
    expect(q(card, 'svg.hm-svg')!.getAttribute('aria-label')).toBe('Heatmap of Power');
    expect(qa(card, '.hm-rows .hm-label').length).toBeGreaterThan(0);
    expect(qa(card, '.hm-cols .hm-label').length).toBeGreaterThan(0);
    expect(q(card, '.hm-gradient')).not.toBeNull();
    const ends = qa(card, '.hm-legend .hm-end').map((e) => e.textContent);
    expect(ends).toHaveLength(2);
    expect(ends[1]).toMatch(/ W$/);
    // History asked for, from four weeks back.
    const call = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.type).toBe('history/history_during_period');
    expect(Date.now() - Date.parse(call.start_time)).toBeGreaterThan(27 * D);
  });

  it('shows a cell’s value on hover and opens the entity from its name', async () => {
    const card = await mount({});
    const plot = q(card, '.hm-plot') as HTMLElement;
    plot.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0 }));
    await card.updateComplete;
    expect(q(card, '.tooltip')).not.toBeNull();
    expect(q(card, '.cell.picked')).not.toBeNull();
    expect(qa(card, '.tooltip-row')).toHaveLength(2);
    plot.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.tooltip')).toBeNull();
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const item = q(card, '.series-item') as HTMLElement;
    item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.power']);
  });

  it('draws a calendar from daily statistics, in hexagons coloured by band, one grid per entity', async () => {
    const card = await mount({
      grid: 'calendar',
      cell_shape: 'hexagon',
      color_by: 'bands',
      severity: [
        { from: 0, color: 'blue' },
        { from: 5, color: 'red' },
      ],
      entities: ['sensor.power', 'sensor.down', 'sensor.missing'],
    } as Partial<CardConfig>);
    expect(qa(card, '.hm')).toHaveLength(3);
    const call = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.type).toBe('recorder/statistics_during_period');
    expect(call.period).toBe('day');
    const first = q(card, '.hm')!;
    const cells = [...first.querySelectorAll('path.cell')];
    expect(cells.length).toBeGreaterThan(360);
    expect(cells.some((c) => (c as SVGElement).style.fill.includes('--error-color'))).toBe(true);
    expect(first.querySelectorAll('.hm-key')).toHaveLength(2);
    expect(first.querySelectorAll('.hm-cols .hm-label').length).toBeGreaterThan(3);
    // The entities with no statistics draw empty grids rather than breaking the card.
    const missing = qa(card, '.hm')[2];
    expect(missing.querySelectorAll('.cell:not(.empty)')).toHaveLength(0);
  });

  it('uses square cells, fixed colour ends, and hides the legend and tooltip when asked', async () => {
    const card = await mount({
      cell_shape: 'square',
      color_min: 0,
      color_max: 100,
      legend: false,
      tooltip: false,
    } as Partial<CardConfig>);
    expect(q(card, 'rect.cell')!.getAttribute('rx')).toBe('0.4');
    expect(q(card, '.hm-legend')).toBeNull();
    expect(q(card, '.hm-plot.hoverable')).toBeNull();
    const fills = qa(card, 'rect.cell').map((c) => (c as SVGElement).style.fill);
    // Every value is under 24 of 100: nothing reaches the full colour.
    expect(fills.every((f) => f.includes('color-mix'))).toBe(true);
  });

  it('says when there is nothing to draw', async () => {
    const hass = hassWithData();
    hass.callWS = vi.fn(async () => ({})) as HomeAssistant['callWS'];
    const card = await mount({}, hass);
    expect(q(card, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'heatmap', entities: ['sensor.power'], ...extra } as CardConfig);
    expect(set({ grid: 'year' })).toThrow('"grid" must be one of: hours, calendar');
    expect(set({ color_by: 'series' })).toThrow('"color_by" must be one of: scale, bands');
    expect(set({ cell_shape: 'circle' })).toThrow(/cell_shape/);
    expect(set({ color_min: 'low' })).toThrow('"color_min" must be a number');
    expect(set({ color_min: 5, color_max: 1 })).toThrow('"color_min" must be below "color_max"');
    expect(set({ legend: 'yes' })).toThrow(/legend/);
    expect(set({ aggregate: 'median' })).toThrow(/aggregate/);
    expect(set({ tooltip: 1 })).toThrow(/tooltip/);
    expect(
      set({ grid: 'calendar', cell_shape: 'hexagon', color_by: 'bands', color_min: 0, color_max: 1 }),
    ).not.toThrow();
  });
});

describe('heatmap editor', () => {
  it('shows the layout, span, combining, colour and cell options, with each layout’s defaults', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'heatmap', entities: ['sensor.power'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      grid: 'hours',
      period_calendar: 'rolling',
      period_last: 4,
      period_unit: 'week',
      period_offset: 0,
      period_until: 'now',
      period_navigate: false,
      source: 'history',
      aggregate: 'mean',
      color_by: 'scale',
      cell_shape: 'rounded',
      legend: true,
      tooltip: true,
    });
    const names = JSON.stringify(form.schema);
    expect(names).not.toContain('group_by');
    for (const n of ['grid', 'aggregate', 'cell_shape', 'color_min', 'color_max', 'legend'])
      expect(names).toContain(`"${n}"`);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), grid: 'calendar', cell_shape: 'hexagon', color_max: 50 } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, grid: 'calendar', cell_shape: 'hexagon', color_max: 50 });
    ed.setConfig(events.at(-1)!);
    await ed.updateComplete;
    const cal = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(cal.data).toMatchObject({ grid: 'calendar', period_last: 12, period_unit: 'month', source: 'statistics' });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name);
    expect(fields).toEqual(['series_color']);
  });
});
