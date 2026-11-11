import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  derivativeSeries,
  parseWindow,
  rateUnit,
  rates,
  validateDerivative,
  withDerivativeFields,
} from '../src/history/transform-derivative';
import type { Point } from '../src/history/types';
import type { ResolvedEntity } from '../src/resolve';
import type { CardConfig, HomeAssistant } from '../src/types';
import { isMeter } from '../src/chart/columns';
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('rates', () => {
  it('gives the change per hour since the reading before, at the later reading', () => {
    expect(values(rates(pts([0, 10], [1, 12], [3, 18]), H))).toEqual([
      [1, 2],
      [3, 3],
    ]);
  });

  it('reads per second, minute or day as asked', () => {
    expect(values(rates(pts([0, 0], [1, 3600]), 1000))).toEqual([[1, 1]]);
    expect(values(rates(pts([0, 0], [1, 60]), 60_000))).toEqual([[1, 1]]);
    expect(values(rates(pts([0, 0], [1, 1]), 86_400_000))).toEqual([[1, 24]]);
  });

  it('drops a fall on a meter that only counts up, and measures on from the new reading', () => {
    expect(values(rates(pts([0, 100], [1, 103], [2, 1], [3, 4]), H, true))).toEqual([
      [1, 3],
      [3, 3],
    ]);
    // Not a meter: a fall is a negative rate.
    expect(values(rates(pts([0, 100], [1, 98]), H))).toEqual([[1, -2]]);
  });

  it('keeps a gap as a gap, starting a new run after it', () => {
    expect(values(rates(pts([0, 1], [1, 2], [2, null], [3, 5], [4, 7]), H))).toEqual([
      [1, 1],
      [2, null],
      [4, 2],
    ]);
    expect(rates(pts([0, null], [1, 2]), H)).toEqual([]);
  });

  it('never measures from a reading carried in from before the span', () => {
    const points: Point[] = [{ t: 0, v: 5, carried: true }, ...pts([1, 7], [2, 9])];
    expect(values(rates(points, H))).toEqual([[2, 2]]);
  });

  it('measures from the later of two readings at the same time', () => {
    expect(values(rates(pts([0, 1], [0, 3], [1, 5]), H))).toEqual([[1, 2]]);
  });

  it('smooths over the last n rates in the run', () => {
    expect(values(rates(pts([0, 0], [1, 2], [2, 6], [3, 12]), H, false, 2))).toEqual([
      [1, 2],
      [2, 3],
      [3, 5],
    ]);
  });

  it('smooths over a trailing time window, each rate weighted by the time it covers there', () => {
    const p = pts([0, 0], [1, 2], [2, 6], [3, 12]);
    expect(values(rates(p, H, false, 1, 2 * H))).toEqual([
      [1, 2],
      [2, 3],
      [3, 5],
    ]);
    // 90 minutes back from 3 h: half of the 4/h step and all of the 6/h one.
    expect(values(rates(p, H, false, 1, 1.5 * H))[2]).toEqual([3, 5.333]);
    // A window shorter than the last step is that step's rate.
    expect(values(rates(p, H, false, 1, 0.25 * H))).toEqual(values(rates(p, H)));
  });

  it('covers the same time whatever the reading interval, and the window wins over a count', () => {
    // Readings 10 minutes apart, then one 40 minutes later: 45 minutes back takes 5 of the 6/h step
    // and all 40 of the 9/h one; three readings back would be (6 + 6 + 9) / 3 = 7.
    const uneven = pts([0, 0], [1 / 6, 1], [2 / 6, 2], [1, 8]);
    expect(values(rates(uneven, H, false, 3)).at(-1)).toEqual([1, 7]);
    expect(values(rates(uneven, H, false, 3, 0.75 * H)).at(-1)).toEqual([1, 8.667]);
  });

  it('starts the window again after a gap, and skips a meter reset', () => {
    const p = pts([0, 0], [1, 4], [2, null], [3, 10], [4, 12], [5, 1], [6, 3]);
    expect(values(rates(p, H, true, 1, 3 * H))).toEqual([
      [1, 4],
      [2, null],
      [4, 2],
      [6, 2],
    ]);
  });

  it('reads a smoothing window', () => {
    expect(parseWindow('15min')).toBe(15 * 60_000);
    expect(parseWindow(' 1.5 h ')).toBe(1.5 * H);
    expect(parseWindow('90s')).toBe(90_000);
    expect(parseWindow('7d')).toBe(7 * 24 * H);
    for (const bad of ['8d', '0min', '15', 'soon', '', 15, undefined]) expect(parseWindow(bad)).toBeUndefined();
  });

  it('names the unit of a rate, energy per hour as power', () => {
    expect(rateUnit('kWh', 'h')).toBe('kW');
    expect(rateUnit('Wh', 'h')).toBe('W');
    expect(rateUnit('MWh', 'h')).toBe('MW');
    expect(rateUnit('kWh', 'min')).toBe('kWh/min');
    expect(rateUnit('°C', 'h')).toBe('°C/h');
    expect(rateUnit('', 's')).toBe('/s');
  });
});

describe('validation', () => {
  const card = (e: Record<string, unknown>) => ({ type: '', entities: [{ entity: 'sensor.a', ...e }] }) as CardConfig;
  it('accepts both transforms, the time units and smoothing, and says what is allowed otherwise', () => {
    expect(() =>
      validateDerivative(card({ transform: 'derivative', transform_unit_time: 'min', transform_smoothing: 3 })),
    ).not.toThrow();
    expect(() => validateDerivative(card({ transform: 'cumulative' }))).not.toThrow();
    expect(() => validateDerivative({ type: '', entities: ['sensor.a'] } as CardConfig)).not.toThrow();
    expect(() => validateDerivative(card({ transform: 'rate' }))).toThrow(
      '"transform" must be one of: cumulative, derivative',
    );
    expect(() => validateDerivative(card({ transform_unit_time: 'week' }))).toThrow(
      '"transform_unit_time" must be one of: s, min, h, d',
    );
    for (const bad of [0, 1.5, 101, '3']) {
      expect(() => validateDerivative(card({ transform_smoothing: bad }))).toThrow(
        '"transform_smoothing" must be a whole number from 1 to 100',
      );
    }
    for (const ok of ['15min', '1h', '', undefined]) {
      expect(() => validateDerivative(card({ transform_smoothing_time: ok }))).not.toThrow();
    }
    for (const bad of ['15', '2w', 15, '8d']) {
      expect(() => validateDerivative(card({ transform_smoothing_time: bad }))).toThrow(
        '"transform_smoothing_time" must be a time up to 7 days, like 90s, 15min, 1h or 1d',
      );
    }
  });
});

function entity(attrs: Record<string, unknown>, config: Record<string, unknown>, unit = 'kWh'): ResolvedEntity {
  return {
    entityId: 'sensor.m',
    config: { entity: 'sensor.m', ...config },
    stateObj: { entity_id: 'sensor.m', state: '1', attributes: attrs },
    available: true,
    value: 1,
    name: 'Meter',
    unit,
    decimals: 1,
    display: '1 kWh',
    label: 'Meter, 1 kWh',
    valueText: '1',
  } as unknown as ResolvedEntity;
}

describe('derivativeSeries', () => {
  const hass = makeHass({});

  it('leaves a series without the transform alone', () => {
    const e = entity({}, {});
    const points = pts([0, 1]);
    const out = derivativeSeries(e, points, hass);
    expect(out.entity).toBe(e);
    expect(out.points).toBe(points);
  });

  it("turns a meter's kWh into kW, dropping its reset, and shows the latest rate", () => {
    const e = entity({ state_class: 'total_increasing' }, { transform: 'derivative' });
    const out = derivativeSeries(e, pts([0, 10], [1, 12.5], [2, 0.5], [3, 2]), hass);
    expect(values(out.points)).toEqual([
      [1, 2.5],
      [3, 1.5],
    ]);
    expect(out.entity.unit).toBe('kW');
    expect(out.entity.display).toBe('1.5 kW');
    expect(out.entity.label).toBe('Meter, 1.5 kW');
  });

  it('is no longer a meter, so columns average its rate', () => {
    expect(isMeter(entity({ state_class: 'total_increasing' }, {}))).toBe(true);
    expect(isMeter(entity({ state_class: 'total_increasing' }, { transform: 'derivative' }))).toBe(false);
  });

  it('uses the time unit and smoothing asked for', () => {
    const e = entity({}, { transform: 'derivative', transform_unit_time: 'min', transform_smoothing: 2 }, '°C');
    const out = derivativeSeries(e, pts([0, 0], [1, 60], [2, 180]), hass);
    expect(values(out.points)).toEqual([
      [1, 1],
      [2, 1.5],
    ]);
    expect(out.entity.unit).toBe('°C/min');
  });

  it('smooths over time when a window is set, instead of over readings', () => {
    const e = entity(
      {},
      { transform: 'derivative', transform_unit_time: 'min', transform_smoothing: 2, transform_smoothing_time: '3h' },
      '°C',
    );
    const out = derivativeSeries(e, pts([0, 0], [1, 60], [2, 180], [3, 180]), hass);
    expect(values(out.points)).toEqual([
      [1, 1],
      [2, 1.5],
      [3, 1],
    ]);
  });

  it('reads an attribute as never a meter, and keeps the entity when there is no rate', () => {
    const e = entity({ state_class: 'total_increasing' }, { transform: 'derivative', attribute: 'x' }, '');
    expect(values(derivativeSeries(e, pts([0, 5], [1, 3]), hass).points)).toEqual([[1, -2]]);
    // One reading held all span: a rate of 0 to now. No reading at all: nothing.
    expect(values(derivativeSeries(e, pts([0, 5]), hass, 2 * H).points)).toEqual([
      [0, 0],
      [2, 0],
    ]);
    const none = derivativeSeries(e, pts([0, null]), hass);
    expect(none.points).toEqual([]);
    expect(none.entity.display).toBe('1 kWh');
    expect(none.entity.unit).toBe('/h');
  });
});

describe('editor fields', () => {
  const config = (transform?: string) =>
    ({
      type: '',
      style: 'line',
      entities: [{ entity: 'sensor.a', ...(transform ? { transform } : {}) }],
    }) as CardConfig;

  it('adds the transform dropdown to history charts only, and the time and smoothing while one entity uses it', () => {
    expect(withDerivativeFields('pie', undefined, config(), undefined)).toBeUndefined();
    const plain = withDerivativeFields('line', undefined, config(), undefined)!;
    expect(plain.fields).toEqual([{ name: 'derivative_transform', path: ['transform'], default: 'none' }]);
    expect(JSON.stringify(plain.schema)).toContain('Rate of change');
    expect(withDerivativeFields('line', undefined, config(), undefined)).toBe(plain);
    const on = withDerivativeFields('area', undefined, config('derivative'), undefined)!;
    expect(on.fields.map((f) => f.name)).toEqual([
      'derivative_transform',
      'derivative_unit_time',
      'derivative_smoothing',
      'derivative_smoothing_time',
    ]);
    expect(JSON.stringify(on.schema)).toContain('Minute');
    expect(JSON.stringify(on.schema)).toContain('"derivative_smoothing_time","selector":{"text":{}}');
  });

  it('is offered on box plot, candlestick and 24-hour clock, and not on climate or wind rose', () => {
    for (const style of ['box', 'candlestick', 'day_clock']) {
      expect(withDerivativeFields(style, undefined, config(), undefined)).toBeDefined();
    }
    for (const style of ['climate', 'wind_rose', 'timeline']) {
      expect(withDerivativeFields(style, undefined, config(), undefined)).toBeUndefined();
    }
  });

  it('adds its choice to a transform dropdown another transform made', () => {
    const select = {
      name: 'other_transform',
      selector: { select: { mode: 'dropdown', options: [{ value: 'cumulative', label: 'Total' }] } },
    };
    const base = { schema: [{ name: 'x' }, select], fields: [{ name: 'other_transform', path: ['transform'] }] };
    const out = withDerivativeFields('column', undefined, config(), base)!;
    expect(out.fields).toBe(base.fields);
    expect(out.schema[0]).toBe(base.schema[0]);
    const options = (out.schema[1] as typeof select).selector.select.options.map((o) => o.value);
    expect(options).toEqual(['cumulative', 'derivative']);
    expect(select.selector.select.options).toHaveLength(1);
  });

  it("shows in each entity's options in the card editor and writes the transform and its options", async () => {
    type Ed = HTMLElement & { hass?: HomeAssistant; setConfig(c: CardConfig): void; updateComplete: Promise<boolean> };
    const ed = document.createElement('chartdeck-card-editor') as Ed;
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'line',
      entities: [{ entity: 'sensor.in', transform: 'derivative' }],
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub & { updateComplete: Promise<boolean> };
    (list.shadowRoot!.querySelector('.expand') as HTMLElement).click();
    await list.updateComplete;
    const form = list.shadowRoot!.querySelector('ha-form[data-section="entity-transform"]') as Stub;
    // With the running total merged in, its dropdown carries both transforms (derivative extends it).
    expect(form.data).toEqual({
      cumulative_transform: 'derivative',
      derivative_unit_time: 'h',
      derivative_smoothing: 1,
    });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), derivative_unit_time: 'min', derivative_smoothing: 4 } },
      }),
    );
    expect(events.at(-1)!.entities).toEqual([
      { entity: 'sensor.in', transform: 'derivative', transform_unit_time: 'min', transform_smoothing: 4 },
    ]);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), derivative_smoothing_time: '15min' } },
      }),
    );
    expect(events.at(-1)!.entities).toEqual([
      { entity: 'sensor.in', transform: 'derivative', transform_smoothing_time: '15min' },
    ]);
  });
});

describe('line chart with a rate of change', () => {
  it('draws the rate and shows it in the header', async () => {
    const now = Date.now();
    const sec = (ago: number) => (now - ago) / 1000;
    const hass = makeHass({
      'sensor.meter': ['16', { friendly_name: 'Meter', unit_of_measurement: 'kWh', state_class: 'total_increasing' }],
    });
    hass.callWS = vi.fn(async () => ({
      'sensor.meter': [
        { s: '10', lu: sec(6 * H) },
        { s: '13', lu: sec(4 * H) },
        { s: '16', lu: sec(1 * H) },
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
      decimals: 1,
      entities: [{ entity: 'sensor.meter', transform: 'derivative' }],
    } as CardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    const header = card.shadowRoot!.querySelector('.series-item')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(header).toBe('Meter 1.0 kW');
    expect(card.shadowRoot!.querySelectorAll('path.line')).toHaveLength(1);
  });

  it('draws a meter that has not moved all span at 0, and still says when there is no reading', async () => {
    const now = Date.now();
    type Card = HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: HomeAssistant;
      updateComplete: Promise<boolean>;
    };
    async function mount(history: Record<string, unknown>) {
      const hass = makeHass({
        'sensor.meter': [
          '12.5',
          { friendly_name: 'Meter', unit_of_measurement: 'kWh', state_class: 'total_increasing' },
        ],
      });
      hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
      const card = document.createElement('chartdeck-card') as Card;
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'line',
        entities: [{ entity: 'sensor.meter', transform: 'derivative', transform_unit_time: 'h' }],
      } as CardConfig);
      card.hass = hass;
      document.body.appendChild(card);
      await card.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      await card.updateComplete;
      return card.shadowRoot!;
    }
    // Unchanged for days: the last 24 hours' history is only the state carried in to their start.
    const flat = await mount({ 'sensor.meter': [{ s: '12.5', lu: (now - 72 * H) / 1000 }] });
    expect(flat.querySelector('.chart-message')).toBeNull();
    expect(flat.querySelectorAll('path.line')).toHaveLength(1);
    expect(flat.querySelector('.series-item')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Meter 0.0 kW');
    const empty = await mount({ 'sensor.meter': [] });
    expect(empty.querySelector('.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('rejects a bad time unit with a readable error', () => {
    type Card = HTMLElement & { setConfig(c: CardConfig): void };
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'line',
        entities: [{ entity: 'sensor.meter', transform: 'derivative', transform_unit_time: 'year' }],
      } as CardConfig),
    ).toThrow('"transform_unit_time" must be one of');
  });
});

describe('charts that load their own history', () => {
  type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

  function meterHass() {
    const now = Date.now();
    const sec = (ago: number) => (now - ago) / 1000;
    const hass = makeHass({
      'sensor.meter': ['16', { friendly_name: 'Meter', unit_of_measurement: 'kWh', state_class: 'total_increasing' }],
    });
    hass.callWS = vi.fn(async () => ({
      'sensor.meter': [
        { s: '10', lu: sec(6 * H) },
        { s: '13', lu: sec(4 * H) },
        { s: '16', lu: sec(1 * H) },
      ],
    })) as unknown as HomeAssistant['callWS'];
    return hass;
  }

  async function mount(config: Record<string, unknown>) {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({
      type: 'custom:chartdeck-card',
      decimals: 1,
      entities: [{ entity: 'sensor.meter', transform: 'derivative' }],
      ...config,
    } as CardConfig);
    card.hass = meterHass();
    document.body.appendChild(card);
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    return card;
  }
  const header = (card: Card) =>
    card.shadowRoot!.querySelector('.series-item')?.textContent?.replace(/\s+/g, ' ').trim();

  it('draws the rate on a box plot', async () => {
    const card = await mount({ style: 'box' });
    expect(header(card)).toBe('Meter 1.0 kW');
  });

  it('draws candles of the rate', async () => {
    const card = await mount({
      style: 'candlestick',
      source: 'history',
      period: { last: 1, unit: 'day' },
      group_by: 'hour',
    });
    expect(header(card)).toBe('Meter 1.0 kW');
  });

  it("averages the rate into a 24-hour clock's number ring, not as a meter's change", async () => {
    const card = await mount({ style: 'day_clock' });
    const label = card.shadowRoot!.querySelector('.dc-ring')!.getAttribute('aria-label')!;
    expect(label).toMatch(/kW/);
    expect(label).not.toMatch(/kWh/);
  });

  it('leaves climate and wind rose charts as they were', async () => {
    const card = await mount({
      style: 'wind_rose',
      entities: ['sensor.meter', { entity: 'sensor.meter', transform: 'derivative' }],
    });
    expect(card.shadowRoot!.querySelector('.error, hui-error-card')).toBeNull();
  });
});
