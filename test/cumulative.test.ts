import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  cumulativeSeries,
  integral,
  integralUnit,
  meterKind,
  meterTotal,
  resetTimes,
  validateCumulative,
  withCumulativeFields,
} from '../src/history/transform-cumulative';
import type { Point } from '../src/history/types';
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
const pts = (...rows: [number, number | null][]): Point[] => rows.map(([t, v]) => ({ t: t * H, v }));
const values = (points: Point[]) => points.map((p) => [p.t / H, p.v === null ? null : Math.round(p.v * 1000) / 1000]);
const zone = { timeZone: 'UTC', firstDay: 1 };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('meter totals', () => {
  it('adds up a rising meter from zero, counting a reset as what was used since', () => {
    const out = meterTotal(pts([0, 100], [1, 102], [2, 105], [3, 1], [4, 3]), [], 'increasing');
    expect(values(out)).toEqual([
      [0, 0],
      [1, 2],
      [2, 5],
      [3, 6],
      [4, 8],
    ]);
  });

  it('starts again at zero at each reset boundary, dropping straight down', () => {
    const out = meterTotal(pts([0, 10], [1, 12], [3, 15], [4, 16]), [2 * H], 'increasing');
    expect(values(out)).toEqual([
      [0, 0],
      [1, 2],
      [2, 2],
      [2, 0],
      [3, 3],
      [4, 4],
    ]);
  });

  it('keeps a gap as a gap and counts what the meter rose across it', () => {
    const out = meterTotal(pts([0, 10], [1, null], [2, 14]), [], 'increasing');
    expect(values(out)).toEqual([
      [0, 0],
      [1, null],
      [2, 4],
    ]);
  });

  it('leaves out what the meter rose while a condition hid it', () => {
    // Shown only while a condition held: hidden from 1 h to 2 h, back from 2 h with the value then.
    const points: Point[] = [...pts([0, 10], [1, 12], [1, null]), { t: 2 * H, v: 20, carried: true }, ...pts([3, 21])];
    expect(values(meterTotal(points, [], 'increasing'))).toEqual([
      [0, 0],
      [1, 2],
      [1, null],
      [2, 2],
      [3, 3],
    ]);
  });

  it('lets a total (net) meter go down', () => {
    const out = meterTotal(pts([0, 10], [1, 12], [2, 9]), [], 'total');
    expect(values(out)).toEqual([
      [0, 0],
      [1, 2],
      [2, -1],
    ]);
  });
});

describe('time integral', () => {
  it('counts each reading for as long as it held, up to the end', () => {
    // 2000 W for an hour, then 0 W for an hour, then 500 W until the end at 4 h.
    const out = integral(pts([0, 2000], [1, 0], [2, 500]), [], 4 * H);
    expect(values(out)).toEqual([
      [0, 0],
      [1, 2000],
      [2, 2000],
      [4, 3000],
    ]);
  });

  it('adds nothing across a gap and draws the gap', () => {
    const out = integral(pts([0, 100], [1, null], [3, 100]), [], 4 * H);
    expect(values(out)).toEqual([
      [0, 0],
      [1, null],
      [3, 100],
      [4, 200],
    ]);
  });

  it('splits a held reading at a reset boundary', () => {
    const out = integral(pts([0, 100]), [2 * H], 3 * H);
    expect(values(out)).toEqual([
      [0, 0],
      [2, 200],
      [2, 0],
      [3, 100],
    ]);
  });

  it('marks a reset that falls in a gap as a gap', () => {
    const out = integral(pts([0, null], [3, 10]), [1 * H], 4 * H);
    expect(values(out)).toEqual([
      [0, null],
      [1, null],
      [1, null],
      [3, 0],
      [4, 10],
    ]);
  });

  it('names the unit of the total', () => {
    expect(integralUnit('W', 'W')).toEqual({ unit: 'Wh', factor: 1 });
    expect(integralUnit('kW', 'kW')).toEqual({ unit: 'kWh', factor: 1 });
    expect(integralUnit('kWh', 'W')).toEqual({ unit: 'kWh', factor: 0.001 });
    expect(integralUnit('MWh', 'kW')).toEqual({ unit: 'MWh', factor: 0.001 });
    expect(integralUnit('L/min', 'L/min')).toEqual({ unit: 'L/min·h', factor: 1 });
    expect(integralUnit('', undefined)).toEqual({ unit: '', factor: 1 });
    expect(integralUnit('kWh', '°C')).toEqual({ unit: 'kWh·h', factor: 1 });
  });
});

describe('validation', () => {
  const card = (e: Record<string, unknown>) => ({ type: '', entities: [{ entity: 'sensor.a', ...e }] }) as CardConfig;
  it('accepts both transforms and the resets, and says what is allowed otherwise', () => {
    expect(() => validateCumulative(card({ transform: 'cumulative', transform_reset: 'day' }))).not.toThrow();
    expect(() => validateCumulative(card({ transform: 'derivative' }))).not.toThrow();
    expect(() => validateCumulative({ type: '', entities: ['sensor.a'] } as CardConfig)).not.toThrow();
    expect(() => validateCumulative(card({ transform: 'sum' }))).toThrow(
      '"transform" must be one of: cumulative, derivative',
    );
    expect(() => validateCumulative(card({ transform_reset: 'year' }))).toThrow(
      '"transform_reset" must be one of: none, day, week, month, billing',
    );
  });

  it('takes a billing day from 1 to 28', () => {
    for (const day of [1, 15, 28, undefined]) {
      expect(() =>
        validateCumulative(card({ transform: 'cumulative', transform_reset: 'billing', transform_reset_day: day })),
      ).not.toThrow();
    }
    for (const bad of [0, 29, 31, 1.5, '5']) {
      expect(() => validateCumulative(card({ transform_reset_day: bad }))).toThrow(
        '"transform_reset_day" must be a whole number from 1 to 28',
      );
    }
  });
});

describe('billing-day resets', () => {
  const at = (iso: string) => Date.parse(iso);

  it('falls at midnight on the billing day of each month inside the readings', () => {
    const times = resetTimes('billing', at('2026-01-10T00:00:00Z'), at('2026-04-20T00:00:00Z'), zone, 15);
    expect(times.map((t) => new Date(t).toISOString())).toEqual([
      '2026-01-15T00:00:00.000Z',
      '2026-02-15T00:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
      '2026-04-15T00:00:00.000Z',
    ]);
    // Day 1 is the start of each month.
    expect(resetTimes('billing', at('2026-01-10T00:00:00Z'), at('2026-03-20T00:00:00Z'), zone, 1)).toEqual(
      resetTimes('month', at('2026-01-10T00:00:00Z'), at('2026-03-20T00:00:00Z'), zone),
    );
    // The 28th is in every month, February included.
    const feb = resetTimes('billing', at('2026-02-01T00:00:00Z'), at('2026-03-01T00:00:00Z'), zone, 28);
    expect(feb.map((t) => new Date(t).toISOString())).toEqual(['2026-02-28T00:00:00.000Z']);
  });

  it("follows the card's time zone across a clock change", () => {
    const london = { timeZone: 'Europe/London', firstDay: 1 };
    const times = resetTimes('billing', at('2026-03-01T00:00:00Z'), at('2026-04-30T00:00:00Z'), london, 30);
    // Midnight on 30 March in London is 23:00 UTC the day before (summer time began on the 29th).
    expect(times.map((t) => new Date(t).toISOString())).toEqual([
      '2026-03-29T23:00:00.000Z',
      '2026-04-29T23:00:00.000Z',
    ]);
  });

  it("starts a meter's running total again on the billing day", () => {
    const e = entity(
      { state_class: 'total_increasing' },
      { transform: 'cumulative', transform_reset: 'billing', transform_reset_day: 2 },
      'kWh',
    );
    const D = 24;
    const out = cumulativeSeries(
      e,
      pts([0, 100], [D - 1, 110], [D + 12, 115], [2 * D, 120]),
      { start: 0, end: 3 * D * H },
      3 * D * H,
      zone,
      hass0,
    );
    // The readings start on 1 January 1970 (UTC): the 2nd is the billing day.
    expect(values(out.points)).toEqual([
      [0, 0],
      [D - 1, 10],
      [D, 10],
      [D, 0],
      [D + 12, 5],
      [2 * D, 10],
    ]);
  });
});

const hass0 = makeHass({});

function entity(attrs: Record<string, unknown>, config: Record<string, unknown>, unit = 'W'): ResolvedEntity {
  return {
    entityId: 'sensor.p',
    config: { entity: 'sensor.p', ...config },
    stateObj: { entity_id: 'sensor.p', state: '1', attributes: attrs },
    available: true,
    value: 1,
    name: 'Power',
    unit,
    decimals: 1,
    display: '1 W',
    label: 'Power, 1 W',
    valueText: '1',
  } as unknown as ResolvedEntity;
}

describe('cumulativeSeries', () => {
  const hass = makeHass({});
  const range = { start: 0, end: 4 * H };

  it('leaves a series without the transform alone', () => {
    const e = entity({}, {});
    const points = pts([0, 1]);
    const out = cumulativeSeries(e, points, range, 4 * H, zone, hass);
    expect(out.entity).toBe(e);
    expect(out.points).toBe(points);
  });

  it('integrates a power sensor into energy and shows the total', () => {
    const e = entity({ unit_of_measurement: 'W' }, { transform: 'cumulative' });
    const out = cumulativeSeries(e, pts([0, 1000], [2, 0]), range, 4 * H, zone, hass);
    expect(values(out.points)).toEqual([
      [0, 0],
      [2, 2000],
      [4, 2000],
    ]);
    expect(out.entity.unit).toBe('Wh');
    expect(out.entity.display).toBe('2,000.0 Wh');
    expect(out.entity.label).toBe('Power, 2,000.0 Wh');
  });

  it('scales to the energy unit the card names', () => {
    const e = entity({ unit_of_measurement: 'W' }, { transform: 'cumulative' }, 'kWh');
    const out = cumulativeSeries(e, pts([0, 1000]), range, 3 * H, zone, hass);
    expect(out.entity.display).toBe('3.0 kWh');
  });

  it("adds up a meter's rises, resetting each day", () => {
    const e = entity({ state_class: 'total_increasing' }, { transform: 'cumulative', transform_reset: 'day' }, 'kWh');
    expect(meterKind(e)).toBe('increasing');
    const out = cumulativeSeries(e, pts([20, 5], [23, 7], [25, 8]), { start: 20 * H, end: 26 * H }, 26 * H, zone, hass);
    expect(values(out.points)).toEqual([
      [20, 0],
      [23, 2],
      [24, 2],
      [24, 0],
      [25, 1],
    ]);
    expect(out.entity.unit).toBe('kWh');
    expect(out.entity.display).toBe('1.0 kWh');
  });

  it('reads an attribute as a measurement, never a meter', () => {
    const e = entity({ state_class: 'total_increasing' }, { transform: 'cumulative', attribute: 'x' }, '');
    expect(meterKind(e)).toBeUndefined();
    const out = cumulativeSeries(e, pts([0, 2]), range, 1 * H, zone, hass);
    expect(out.entity.unit).toBe('');
    expect(values(out.points)).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it('keeps the entity as it was when every reading is a gap', () => {
    const e = entity({ unit_of_measurement: 'W' }, { transform: 'cumulative' });
    const out = cumulativeSeries(e, pts([0, null]), range, 1 * H, zone, hass);
    expect(out.entity.display).toBe('1 W');
    expect(out.entity.unit).toBe('Wh');
    expect(cumulativeSeries(e, [], range, 1 * H, zone, hass).points).toEqual([]);
  });
});

describe('editor fields', () => {
  const config = (transform?: string) =>
    ({
      type: '',
      style: 'line',
      entities: [{ entity: 'sensor.a', ...(transform ? { transform } : {}) }],
    }) as CardConfig;

  it('adds the transform dropdown to history charts only, and the reset while one entity uses it', () => {
    expect(withCumulativeFields('bar', undefined, config(), undefined)).toBeUndefined();
    const base = { schema: [{ name: 'curve' }], fields: [{ name: 'curve', path: ['curve'] }] };
    const plain = withCumulativeFields('line', undefined, config(), base)!;
    expect(plain.fields.map((f) => f.name)).toEqual(['curve', 'cumulative_transform']);
    expect(plain.fields[1]).toEqual({ name: 'cumulative_transform', path: ['transform'], default: 'none' });
    expect(JSON.stringify(plain.schema)).toContain('Running total');
    expect(withCumulativeFields('line', undefined, config(), base)).toBe(plain);
    const on = withCumulativeFields('line', undefined, config('cumulative'), base)!;
    expect(on.fields.map((f) => f.name)).toEqual(['curve', 'cumulative_transform', 'cumulative_reset']);
    expect(JSON.stringify(on.schema)).toContain('Every week');
    expect(withCumulativeFields('dumbbell', undefined, config(), undefined)!.fields).toHaveLength(1);
  });

  it('shows the billing day only while a running total starts again on one', () => {
    const with_ = (reset?: string, transform = 'cumulative') =>
      ({
        type: '',
        style: 'line',
        entities: [{ entity: 'sensor.a', transform, ...(reset ? { transform_reset: reset } : {}) }],
      }) as CardConfig;
    const names = (c: CardConfig) => withCumulativeFields('line', undefined, c, undefined)!.fields.map((f) => f.name);
    expect(names(with_('month'))).toEqual(['cumulative_transform', 'cumulative_reset']);
    expect(names(with_('billing'))).toEqual(['cumulative_transform', 'cumulative_reset', 'cumulative_billing_day']);
    // A leftover billing reset on an entity that no longer adds up doesn't count.
    expect(names(with_('billing', 'derivative'))).toEqual(['cumulative_transform']);
    const fields = withCumulativeFields('line', undefined, with_('billing'), undefined)!;
    expect(fields.fields[2]).toEqual({ name: 'cumulative_billing_day', path: ['transform_reset_day'], default: 1 });
    expect(JSON.stringify(fields.schema)).toContain('Every month on a billing day');
    expect(JSON.stringify(fields.schema)).toContain('"min":1,"max":28');
  });

  it('is offered on box plot, candlestick and 24-hour clock, and not on climate or wind rose', () => {
    for (const style of ['box', 'candlestick', 'day_clock']) {
      expect(withCumulativeFields(style, undefined, config(), undefined)).toBeDefined();
    }
    for (const style of ['climate', 'wind_rose', 'timeline']) {
      expect(withCumulativeFields(style, undefined, config(), undefined)).toBeUndefined();
    }
  });

  it('adds its choice to a transform dropdown another transform made', () => {
    const select = {
      name: 'other_transform',
      selector: { select: { mode: 'dropdown', options: [{ value: 'derivative', label: 'Rate' }] } },
    };
    const base = { schema: [select], fields: [{ name: 'other_transform', path: ['transform'] }] };
    const out = withCumulativeFields('column', undefined, config(), base)!;
    expect(out.fields).toBe(base.fields);
    const options = (out.schema[0] as typeof select).selector.select.options.map((o) => o.value);
    expect(options).toEqual(['derivative', 'cumulative']);
    expect(base.schema[0].selector.select.options).toHaveLength(1);
  });

  it("shows in each entity's options in the card editor and writes transform", async () => {
    type Ed = HTMLElement & { hass?: HomeAssistant; setConfig(c: CardConfig): void; updateComplete: Promise<boolean> };
    const ed = document.createElement('chartdeck-card-editor') as Ed;
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: [{ entity: 'sensor.in' }] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub & { updateComplete: Promise<boolean> };
    (list.shadowRoot!.querySelector('.expand') as HTMLElement).click();
    await list.updateComplete;
    const form = list.shadowRoot!.querySelector('ha-form[data-section="entity-transform"]') as Stub;
    expect(form.data).toEqual({ cumulative_transform: 'none' });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), cumulative_transform: 'cumulative' } },
      }),
    );
    expect(events.at(-1)!.entities).toEqual([{ entity: 'sensor.in', transform: 'cumulative' }]);
  });
});

describe('line chart with a running total', () => {
  it('draws the total and shows it in the header', async () => {
    const now = Date.now();
    const sec = (ago: number) => (now - ago) / 1000;
    const hass = makeHass({
      'sensor.power': ['500', { friendly_name: 'Power', unit_of_measurement: 'W' }],
    });
    hass.callWS = vi.fn(async () => ({
      'sensor.power': [
        { s: '1000', lu: sec(30 * H) },
        { s: '500', lu: sec(2 * H) },
      ],
    })) as HomeAssistant['callWS'];
    type Card = HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: HomeAssistant;
      updateComplete: Promise<boolean>;
    };
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({
      type: 'custom:chartdeck-card',
      style: 'line',
      decimals: 0,
      entities: [{ entity: 'sensor.power', transform: 'cumulative' }],
    } as CardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    const header = card.shadowRoot!.querySelector('.series-item')!.textContent!.replace(/\s+/g, ' ').trim();
    // 22 h at 1000 W and 2 h at 500 W since the left edge, 24 h ago.
    expect(header).toBe('Power 23,000 Wh');
    expect(card.shadowRoot!.querySelectorAll('path.line')).toHaveLength(1);
  });

  it('rejects an unknown transform with a readable error', () => {
    type Card = HTMLElement & { setConfig(c: CardConfig): void };
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'line',
        entities: [{ entity: 'sensor.power', transform: 'nope' }],
      } as CardConfig),
    ).toThrow('"transform" must be one of');
  });
});

describe('charts that load their own history', () => {
  type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

  function powerHass() {
    const now = Date.now();
    const sec = (ago: number) => (now - ago) / 1000;
    const hass = makeHass({ 'sensor.p': ['0', { friendly_name: 'Heater', unit_of_measurement: 'W' }] });
    hass.callWS = vi.fn(async () => ({
      'sensor.p': [
        { s: '2000', lu: sec(5 * H) },
        { s: '0', lu: sec(3 * H) },
      ],
    })) as unknown as HomeAssistant['callWS'];
    return hass;
  }

  async function mount(config: Record<string, unknown>) {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({
      type: 'custom:chartdeck-card',
      decimals: 1,
      source: 'history',
      period: { last: 12, unit: 'hour' },
      entities: [{ entity: 'sensor.p', transform: 'cumulative', unit: 'kWh' }],
      ...config,
    } as CardConfig);
    card.hass = powerHass();
    document.body.appendChild(card);
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    return card;
  }
  const header = (card: Card) =>
    card.shadowRoot!.querySelector('.series-item')?.textContent?.replace(/\s+/g, ' ').trim();

  it('draws the running total on a box plot', async () => {
    // 2000 W for two hours: 4 kWh.
    expect(header(await mount({ style: 'box' }))).toBe('Heater 4.0 kWh');
  });

  it('draws candles of the running total', async () => {
    expect(header(await mount({ style: 'candlestick', group_by: 'hour' }))).toBe('Heater 4.0 kWh');
  });

  it("averages the running total into a 24-hour clock's number ring", async () => {
    const card = await mount({ style: 'day_clock', period: undefined });
    const label = card.shadowRoot!.querySelector('.dc-ring')!.getAttribute('aria-label')!;
    expect(label).toMatch(/peak 4\.0 kWh at/);
  });
});
