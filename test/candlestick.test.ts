import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { candleExtent, historyCandles, statisticsCandles, underValues } from '../src/chart/candles';
import { candlePeriod, candleQuery, periodTitle } from '../src/styles/candlestick';
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

describe('candle maths', () => {
  const bounds = [0, 100, 200, 300];

  it('takes open, high, low and close from history, carrying the value in at each start', () => {
    const points = [
      { t: -10, v: 5, carried: true },
      { t: 20, v: 9 },
      { t: 60, v: 3 },
      { t: 80, v: 4 },
      { t: 150, v: null },
    ];
    const candles = historyCandles(points, bounds, 250);
    expect(candles[0]).toEqual({ t: 0, end: 100, open: 5, high: 9, low: 3, close: 4 });
    // Unavailable from 150: the second period still had 4 until then.
    expect(candles[1]).toEqual({ t: 100, end: 200, open: 4, high: 4, low: 4, close: 4 });
    // Nothing known in the third, which also starts after now.
    expect(candles[2]).toBeNull();
  });

  it('takes candles from statistics rows, with their min and max', () => {
    const rows = [
      { t: -50, v: 1, carried: true },
      { t: 0, v: 10, min: 8, max: 12 },
      { t: 50, v: 11, min: 7, max: 13 },
      { t: 100, v: 20 },
      { t: 150, v: null },
      { t: 210, v: 5 },
    ];
    const candles = statisticsCandles(rows, bounds, 195);
    expect(candles[0]).toEqual({ t: 0, end: 100, open: 10, high: 13, low: 7, close: 11 });
    expect(candles[1]).toEqual({ t: 100, end: 200, open: 20, high: 20, low: 20, close: 20 });
    expect(candles[2]).toBeNull();
    expect(candleExtent(candles)).toEqual([7, 20]);
    expect(candleExtent([null])).toBeUndefined();
  });

  it('groups the series underneath like the line chart, meters by how far they rose', () => {
    const meter = [
      { t: 0, v: 100 },
      { t: 50, v: 103 },
      { t: 150, v: 110 },
    ];
    expect(underValues(meter, [0, 100, 200], 'change', 'statistics', 300).map((p) => p.v)).toEqual([3, 7]);
    expect(underValues(meter, [0, 100, 200], 'max', 'statistics', 300).map((p) => p.v)).toEqual([103, 110]);
    expect(underValues(meter, [0, 100, 200], 'last', 'history', 300).map((p) => p.v)).toEqual([103, 110]);
  });

  it('asks for rows fine enough to have an open and a close', () => {
    const zone = { timeZone: 'Europe/London', firstDay: 1 };
    expect(candleQuery('hour', zone, 'Europe/London').period).toBe('5minute');
    expect(candleQuery('day', zone, 'Europe/London').period).toBe('hour');
    expect(candleQuery('week', zone, 'Europe/London').period).toBe('day');
    expect(candleQuery('month', zone, 'America/New_York').period).toBe('hour');
    expect(candleQuery('day', zone, undefined).types).toEqual(['mean', 'min', 'max', 'state']);
  });

  it('defaults to the last 14 days, keeping what the card sets', () => {
    expect(candlePeriod({} as CardConfig)).toEqual({ last: 14, unit: 'day' });
    expect(candlePeriod({ period: { last: 30 } } as CardConfig)).toEqual({ last: 30, unit: 'day' });
    expect(candlePeriod({ period: { calendar: 'month' } } as CardConfig)).toMatchObject({ calendar: 'month' });
  });

  it('names a period for the tooltip', () => {
    const zone = { timeZone: 'UTC', firstDay: 1 };
    const t = Date.UTC(2026, 9, 26);
    const gb = { locale: { language: 'en-GB' } } as unknown as HomeAssistant;
    expect(periodTitle(t, 'day', gb, zone)).toBe('Mon 26 Oct');
    expect(periodTitle(t, 'week', gb, zone)).toBe('Week of 26 Oct');
    expect(periodTitle(t, 'month', gb, zone)).toBe('October 2026');
    expect(periodTitle(t, 'hour', undefined, zone)).toMatch(/26/);
    expect(periodTitle(t, 'day', { language: 'not a language!' } as unknown as HomeAssistant, zone)).toMatch(/26/);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const H = 3_600_000;
const DAY = 24 * H;

/** Statistics rows: a price that rises on even days and falls on odd ones, and a usage meter. */
function hassWith(fail = false) {
  const hass = makeHass({
    'sensor.price': ['25.3', { friendly_name: 'Price', unit_of_measurement: 'p' }],
    'sensor.usage': ['1200', { friendly_name: 'Usage', unit_of_measurement: 'kWh' }],
  });
  hass.config = { time_zone: 'UTC' } as HomeAssistant['config'];
  hass.callWS = vi.fn(async (msg: { type: string; start_time: string; statistic_ids?: string[] }) => {
    if (fail) throw new Error('boom');
    const start = Date.parse(msg.start_time);
    const out: Record<string, unknown[]> = {};
    if (msg.type === 'recorder/statistics_during_period') {
      const price = [];
      const usage = [];
      for (let t = start; t < Date.now(); t += H) {
        const day = Math.floor(t / DAY);
        const hour = (t % DAY) / H;
        const v = 20 + (day % 2 === 0 ? hour : 24 - hour) / 4;
        price.push({ start: t, mean: v, min: v - 1, max: v + 1 });
        usage.push({ start: t, state: (t - start) / H });
      }
      out['sensor.price'] = price;
      out['sensor.usage'] = usage;
    } else {
      out['sensor.price'] = [
        { s: '20', lu: (Date.now() - 3 * DAY) / 1000 },
        { s: '24', lu: (Date.now() - 2 * DAY) / 1000 },
      ];
    }
    return out;
  }) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, hass = hassWith()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'candlestick',
    entities: ['sensor.price'],
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

function point(el: Element, type: string, frac: number) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: frac * 1000 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('candlestick chart', () => {
  it('draws a candle per day for the last 14 days from hourly statistics, rising and falling', async () => {
    const card = await mount({});
    const call = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatchObject({ type: 'recorder/statistics_during_period', period: 'hour' });
    const candles = qa(card, 'g.candle');
    expect(candles.length).toBeGreaterThanOrEqual(14);
    expect(candles.length).toBeLessThanOrEqual(15);
    const ups = qa(card, 'g.candle.up');
    const downs = qa(card, 'g.candle.down');
    expect(ups.length).toBeGreaterThan(0);
    expect(downs.length).toBeGreaterThan(0);
    expect(ups[0].querySelector('rect')!.getAttribute('fill')).toContain('--success-color');
    expect(downs[0].querySelector('line')!.getAttribute('stroke')).toContain('--error-color');
    expect(q(card, '.under-columns')).toBeNull();
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Candlestick chart of Price');
  });

  it('draws the other entities underneath as columns or a line, in their own colours', async () => {
    const card = await mount({
      entities: ['sensor.price', 'sensor.usage'],
      aggregate: 'change',
      up_color: 'blue',
    } as Partial<CardConfig>);
    const columns = q(card, '.under-columns')!;
    expect(columns.getAttribute('fill')).toContain('--grey-color');
    expect(columns.getAttribute('data-index')).toBe('1');
    expect(columns.querySelectorAll('rect').length).toBeGreaterThanOrEqual(14);
    expect(q(card, 'g.candle.up rect')!.getAttribute('fill')).toContain('--info-color');
    const line = await mount({ entities: ['sensor.price', 'sensor.usage'], underneath: 'line' } as Partial<CardConfig>);
    expect(q(line, 'path.under-line')!.getAttribute('d')).toMatch(/^M.*L/);
  });

  it('makes hourly candles from history', async () => {
    const card = await mount({
      source: 'history',
      group_by: 'hour',
      period: { last: 4, unit: 'day' },
    } as Partial<CardConfig>);
    const call = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.type).toBe('history/history_during_period');
    // 20 until two days ago, then 24: hours before the first reading have no candle.
    expect(qa(card, 'g.candle').length).toBeGreaterThan(40);
    expect(qa(card, 'g.candle.up').length).toBe(qa(card, 'g.candle').length);
  });

  it('lists open, high, low, close and the values underneath on hover', async () => {
    const card = await mount({
      entities: ['sensor.price', 'sensor.usage'],
      aggregate: 'change',
    } as Partial<CardConfig>);
    point(q(card, '.plot-area')!, 'pointermove', 0.5);
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows.map((r) => r.split(' ')[0])).toEqual(['Open', 'High', 'Low', 'Close', 'Usage']);
    expect(rows[1]).toMatch(/ p$/);
    expect(rows[4]).toMatch(/kWh$/);
    expect(q(card, '.tooltip-time')!.textContent).toMatch(/\d/);
  });

  it('opens the price entity from a candle', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const candle = q(card, 'g.candle')!;
    candle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    candle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.price']);
  });

  it('says when history failed or is empty', async () => {
    const failed = await mount({}, hassWith(true));
    expect(q(failed, '.chart-message.error')!.textContent!.trim()).toBe("Couldn't load history: boom");
    const hass = hassWith();
    hass.callWS = vi.fn(async () => ({})) as HomeAssistant['callWS'];
    const empty = await mount({}, hass);
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'candlestick', entities: ['sensor.price'], ...extra } as CardConfig);
    expect(set({ underneath: 'area' })).toThrow(/"underneath" must be one of: columns, line/);
    expect(set({ up_color: 3 })).toThrow(/up_color/);
    expect(set({ down_color: '' })).toThrow(/down_color/);
    expect(set({ group_by: 'year' })).toThrow(/group_by/);
    expect(set({ period: { last: 0 } })).toThrow(/period/);
    expect(set({ group_by: 'week', underneath: 'line', up_color: '#0f0' })).not.toThrow();
  });
});

describe('candlestick editor', () => {
  it('shows candle fields with their own defaults and writes them', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'candlestick', entities: ['sensor.price'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({
      period_last: 14,
      period_unit: 'day',
      source: 'statistics',
      candle_by: 'day',
      under_aggregate: 'mean',
      up_color: 'green',
      down_color: 'red',
      underneath: 'columns',
    });
    const names = JSON.stringify(form.schema);
    expect(names).toContain('candle_by');
    expect(names).not.toContain('"group_by"');
    expect(names).not.toContain('"none"');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...(form.data as object),
            period_last: 30,
            candle_by: 'week',
            underneath: 'line',
            down_color: 'amber',
          },
        },
      }),
    );
    expect(events.at(-1)).toEqual({
      ...raw,
      period: { last: 30 },
      group_by: 'week',
      underneath: 'line',
      down_color: 'amber',
    });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect((list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual(['fill_color']);
  });
});
