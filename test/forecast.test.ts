import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  aheadOf,
  extendedEnd,
  forecastEntities,
  forecastOf,
  forecastReach,
  parseForecast,
  stopForecast,
  toTime,
  validateForecast,
  valueAt,
  weatherForecast,
  withForecastFields,
} from '../src/chart/forecast';
import { STYLES } from '../src/styles/index';
import type { ChartStyleModule } from '../src/styles/index';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of ['ha-form', 'ha-expansion-panel', 'ha-selector', 'ha-entity-picker', 'ha-icon-picker', 'ha-switch']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const H = 3_600_000;
const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;
const iso = (t: number) => new Date(t).toISOString();

const cfg = (raw: Partial<CardConfig>) => ({ type: 'custom:chartdeck-card', style: 'line', ...raw }) as CardConfig;

describe('forecast maths', () => {
  it('reads times as ISO text, seconds or ms', () => {
    expect(toTime('2026-11-08T12:00:00Z')).toBe(Date.UTC(2026, 10, 8, 12));
    expect(toTime(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toTime('1700000000')).toBe(1_700_000_000_000);
    expect(toTime(new Date(5000))).toBe(5000);
    expect(toTime(null)).toBeNaN();
  });

  it('parses Solcast lists, weather lists, pairs and time maps, oldest first', () => {
    const solcast = [
      { period_start: '2026-11-08T13:00:00Z', pv_estimate: 2, pv_estimate10: 1 },
      { period_start: '2026-11-08T12:30:00Z', pv_estimate: '1.5' },
      { period_start: 'never', pv_estimate: 9 },
    ];
    expect(parseForecast(solcast, undefined, undefined, 1000)).toEqual([
      { t: Date.UTC(2026, 10, 8, 12, 30), v: 1500 },
      { t: Date.UTC(2026, 10, 8, 13), v: 2000 },
    ]);
    const weather = [{ datetime: '2026-11-08T12:00:00Z', temperature: 7, precipitation: 0 }, { condition: 'rainy' }];
    expect(parseForecast(weather, 'temperature')).toEqual([{ t: Date.UTC(2026, 10, 8, 12), v: 7 }]);
    expect(parseForecast([[1_700_000_000, 4]])).toEqual([{ t: 1_700_000_000_000, v: 4 }]);
    expect(parseForecast({ '2026-11-08T12:00:00Z': 300, '2026-11-08T11:00:00Z': 'x' })).toEqual([
      { t: Date.UTC(2026, 10, 8, 11), v: null },
      { t: Date.UTC(2026, 10, 8, 12), v: 300 },
    ]);
    // Own keys win over the guesses; a repeated time keeps the last value.
    expect(
      parseForecast(
        [
          { at: 1000, kw: 1 },
          { at: 1000, kw: 2 },
        ],
        'kw',
        'at',
      ),
    ).toEqual([{ t: 1_000_000, v: 2 }]);
    expect(parseForecast([{ value: 3 }])).toEqual([]);
    expect(parseForecast('nonsense')).toEqual([]);
  });

  it('reads a value between points, and cuts the forecast to what lies ahead', () => {
    const pts = [
      { t: 0, v: 0 },
      { t: 10, v: 10 },
      { t: 20, v: null },
      { t: 30, v: 30 },
    ];
    expect(valueAt(pts, 5)).toBe(5);
    expect(valueAt(pts, 15)).toBeNull();
    expect(valueAt(pts, -1)).toBeNull();
    expect(valueAt(pts, 40)).toBeNull();
    expect(aheadOf(pts, 5, 25)).toEqual([
      { t: 5, v: 5 },
      { t: 10, v: 10 },
      { t: 20, v: null },
      { t: 30, v: 30 },
    ]);
    expect(aheadOf(pts, 10, 15)).toEqual([
      { t: 10, v: 10 },
      { t: 20, v: null },
    ]);
    // Starting after now, it starts at its first point.
    expect(aheadOf([{ t: 50, v: 1 }], 5, 100)).toEqual([{ t: 50, v: 1 }]);
  });

  it('stretches a span ending now to the last forecast, within reach', () => {
    const range = { start: 0, end: 100_000 };
    expect(extendedEnd(range, true, 100_000, 150_000, 10 * H)).toBe(150_000);
    expect(extendedEnd(range, true, 100_000, 10 * H, 3600)).toBe(103_600);
    expect(extendedEnd(range, true, 100_000, 50_000, 3600)).toBe(100_000);
    expect(extendedEnd(range, false, 100_000, 150_000, 3600)).toBe(100_000);
    expect(extendedEnd(range, true, 100_000, undefined, 3600)).toBe(100_000);
    // A span already running to the end of today is left alone.
    expect(extendedEnd({ start: 0, end: 500_000 }, true, 100_000, 900_000, 10 * H)).toBe(500_000);
  });

  it('checks its options', () => {
    const v = (raw: Partial<CardConfig>) => () => validateForecast(cfg(raw));
    expect(v({ forecast_hours: 0 } as Partial<CardConfig>)).toThrow('"forecast_hours" must be a number above 0');
    expect(v({ entities: [{ entity: 'sensor.a', forecast: 'x' }] } as Partial<CardConfig>)).toThrow(
      '"forecast" of sensor.a must have an "entity"',
    );
    expect(v({ entities: [{ entity: 'sensor.a', forecast: { entity: 'Bad' } }] } as Partial<CardConfig>)).toThrow(
      '"forecast.entity" of sensor.a must be an entity id',
    );
    expect(
      v({ entities: [{ entity: 'sensor.a', forecast: { entity: 'sensor.f', attribute: 3 } }] } as Partial<CardConfig>),
    ).toThrow('"forecast.attribute" of sensor.a must be text');
    expect(
      v({
        entities: [{ entity: 'sensor.a', forecast: { entity: 'weather.h', type: 'weekly' } }],
      } as Partial<CardConfig>),
    ).toThrow('"forecast.type" of sensor.a must be one of: hourly, daily, twice_daily');
    expect(
      v({ entities: [{ entity: 'sensor.a', forecast: { entity: 'sensor.f', multiply: 'x' } }] } as Partial<CardConfig>),
    ).toThrow('"forecast.multiply" of sensor.a must be a number');
    // Half filled in (no entity yet) is not an error: it is ignored.
    expect(
      v({ entities: ['sensor.b', { entity: 'sensor.a', forecast: { type: 'daily' } }] } as Partial<CardConfig>),
    ).not.toThrow();
    expect(forecastOf({ forecast: { type: 'daily' } })).toBeUndefined();
    expect(forecastOf({ forecast: { entity: ' sensor.f ' } })).toEqual({ entity: 'sensor.f' });
    expect(forecastReach(cfg({ forecast_hours: 6 } as Partial<CardConfig>))).toBe(6 * H);
    expect(forecastReach(cfg({}))).toBe(24 * H);
    expect(
      forecastEntities(
        cfg({
          entities: [
            'sensor.x',
            { entity: 'sensor.a', forecast: { entity: 'sensor.f' } },
            { entity: 'sensor.b', forecast: { entity: 'sensor.f' } },
          ],
        } as Partial<CardConfig>),
      ),
    ).toEqual(['sensor.f']);
    expect(forecastEntities(cfg({}))).toEqual([]);
  });
});

describe('weather forecast subscription', () => {
  it('subscribes once per card, redraws as forecasts arrive, and unsubscribes when stopped', async () => {
    const host = document.createElement('div');
    let push: ((m: unknown) => void) | undefined;
    const stop = vi.fn();
    const subscribeMessage = vi.fn(async (cb: (m: unknown) => void) => {
      push = cb;
      return stop;
    });
    const hass = makeHass({}, { connection: { subscribeMessage } } as Partial<HomeAssistant>);
    const redraw = vi.fn();
    expect(weatherForecast(host, hass, 'weather.home', 'hourly', redraw)).toBeUndefined();
    expect(weatherForecast(host, hass, 'weather.home', 'hourly', redraw)).toBeUndefined();
    expect(subscribeMessage).toHaveBeenCalledTimes(1);
    expect(subscribeMessage.mock.calls[0][1]).toEqual({
      type: 'weather/subscribe_forecast',
      entity_id: 'weather.home',
      forecast_type: 'hourly',
    });
    push!({ type: 'hourly', forecast: [{ datetime: iso(now), temperature: 4 }] });
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(weatherForecast(host, hass, 'weather.home', 'hourly', redraw)).toHaveLength(1);
    push!({ type: 'hourly', forecast: null });
    expect(weatherForecast(host, hass, 'weather.home', 'hourly', redraw)).toEqual([]);
    stopForecast(host);
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    // Messages after stopping are ignored.
    push!({ forecast: [] });
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it('goes without when the connection cannot subscribe or refuses', async () => {
    const host = document.createElement('div');
    expect(weatherForecast(host, makeHass({}), 'weather.a', 'daily', () => undefined)).toBeUndefined();
    const refuse = makeHass({}, {
      connection: { subscribeMessage: () => Promise.reject(new Error('no forecast')) },
    } as Partial<HomeAssistant>);
    expect(weatherForecast(host, refuse, 'weather.b', 'daily', () => undefined)).toBeUndefined();
    stopForecast(host);
    await Promise.resolve();
  });
});

const history = {
  'sensor.solar': [
    { s: '100', lu: sec(20 * H) },
    { s: '2000', lu: sec(10 * H) },
    { s: '500', lu: sec(1 * H) },
  ],
};

function hassFor(attributes: Record<string, unknown> = {}, extra: Partial<HomeAssistant> = {}) {
  const hass = makeHass(
    {
      'sensor.solar': ['500', { friendly_name: 'Solar', unit_of_measurement: 'W' }],
      'sensor.solcast': ['3.2', { friendly_name: 'Solcast', ...attributes }],
    },
    extra,
  );
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, hass: HomeAssistant) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig(cfg({ entities: ['sensor.solar'], ...config }));
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

const detailed = [-2, 1, 3, 6, 12, 30].map((h, i) => ({ period_start: iso(now + h * H), pv_estimate: i * 0.5 }));

describe('forecast on the line chart', () => {
  it('draws an attribute forecast dashed after now and stretches the time axis to it', async () => {
    const card = await mount(
      {
        entities: [
          {
            entity: 'sensor.solar',
            color: 'amber',
            forecast: { entity: 'sensor.solcast', attribute: 'detailedForecast', multiply: 1000 },
          },
        ],
      } as Partial<CardConfig>,
      hassFor({ detailedForecast: detailed }),
    );
    const lines = qa(card, 'path.forecast-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('stroke')).toContain('--warning-color');
    // 24 h back plus 24 h ahead: now sits in the middle, and the history line stops there.
    const d = qa(card, 'path.line')[0].getAttribute('d')!;
    const lastX = Number(d.match(/([\d.]+),[\d.]+$/)![1]);
    expect(lastX).toBeGreaterThan(495);
    expect(lastX).toBeLessThan(505);
    const fx = lines[0]
      .getAttribute('d')!
      .match(/[ML]([\d.]+),/g)!
      .map((m) => Number(m.slice(1, -1)));
    expect(Math.min(...fx)).toBeGreaterThan(495);
    expect(qa(card, '.forecast-label')[0].textContent).toBe('Forecast');
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
  });

  it('lists the forecast in the tooltip, as none before it starts', async () => {
    const card = await mount(
      {
        entities: [{ entity: 'sensor.solar', forecast: { entity: 'sensor.solcast', attribute: 'detailedForecast' } }],
      } as Partial<CardConfig>,
      hassFor({ detailedForecast: detailed }),
    );
    const area = card.shadowRoot!.querySelector('.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 180 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { clientX: 800, bubbles: true }));
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toMatch(/^Solar /);
    expect(rows[1]).toMatch(/^Solar forecast [\d.]+ W$/);
    area.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, bubbles: true }));
    await card.updateComplete;
    const early = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(early[1]).toBe('Solar forecast —');
  });

  it("converts the forecast to the series' shown unit", async () => {
    const card = await mount(
      {
        entities: [
          {
            entity: 'sensor.solar',
            unit: 'kW',
            forecast: { entity: 'sensor.solcast', attribute: 'detailedForecast', multiply: 1000 },
          },
        ],
      } as Partial<CardConfig>,
      hassFor({ detailedForecast: detailed }),
    );
    const area = card.shadowRoot!.querySelector('.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 180 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { clientX: 800, bubbles: true }));
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    // multiply makes the forecast W, as the sensor reports; the series shows kW, so does its forecast.
    const match = rows[1].match(/^Solar forecast ([\d.]+) kW$/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThan(3);
  });

  it('subscribes to a weather entity forecast through the websocket', async () => {
    let push: ((m: unknown) => void) | undefined;
    const subscribeMessage = vi.fn(async (cb: (m: unknown) => void) => {
      push = cb;
      return () => undefined;
    });
    const hass = hassFor({}, { connection: { subscribeMessage } } as Partial<HomeAssistant>);
    hass.states['weather.home'] = { entity_id: 'weather.home', state: 'sunny', attributes: {} };
    const card = await mount(
      {
        entities: [{ entity: 'sensor.solar', forecast: { entity: 'weather.home' } }],
        forecast_hours: 12,
      } as Partial<CardConfig>,
      hass,
    );
    expect(qa(card, 'path.forecast-line')).toHaveLength(0);
    expect(subscribeMessage).toHaveBeenCalledTimes(1);
    push!({
      type: 'hourly',
      forecast: [1, 2, 3, 20].map((h) => ({ datetime: iso(now + h * H), temperature: 800 + h })),
    });
    await card.updateComplete;
    expect(qa(card, 'path.forecast-line')).toHaveLength(1);
    // Reach 12 h: the axis spans 36 h, so now sits two thirds along.
    const d = qa(card, 'path.line')[0].getAttribute('d')!;
    const lastX = Number(d.match(/([\d.]+),[\d.]+$/)![1]);
    expect(lastX).toBeGreaterThan(660);
    expect(lastX).toBeLessThan(672);
    // Removing the forecast closes the subscription on the next draw.
    card.setConfig(cfg({ entities: ['sensor.solar'] }));
    await card.updateComplete;
    expect(qa(card, 'path.forecast-line')).toHaveLength(0);
  });

  it("uses a weather entity's old forecast attribute, and draws nothing for a past span", async () => {
    const hass = hassFor();
    hass.states['weather.old'] = {
      entity_id: 'weather.old',
      state: 'rainy',
      attributes: {
        forecast: [
          { datetime: iso(now + H), temperature: 5 },
          { datetime: iso(now + 2 * H), temperature: 6 },
        ],
      },
    };
    const entities = [{ entity: 'sensor.solar', forecast: { entity: 'weather.old' } }];
    const card = await mount({ entities } as Partial<CardConfig>, hass);
    expect(qa(card, 'path.forecast-line')).toHaveLength(1);
    const past = await mount({ entities, period: { last: 24, unit: 'hour', offset: 1 } } as Partial<CardConfig>, hass);
    expect(qa(past, 'path.forecast-line')).toHaveLength(0);
  });

  it('reads a plain "forecast" attribute by default, and ignores one with no readings', async () => {
    const card = await mount(
      { entities: [{ entity: 'sensor.solar', forecast: { entity: 'sensor.solcast' } }] } as Partial<CardConfig>,
      hassFor({ forecast: { [iso(now + H)]: 40, [iso(now + 3 * H)]: 50 } }),
    );
    expect(qa(card, 'path.forecast-line')).toHaveLength(1);
    const none = await mount(
      { entities: [{ entity: 'sensor.solar', forecast: { entity: 'sensor.solcast' } }] } as Partial<CardConfig>,
      hassFor({ forecast: [{ time: iso(now + H), value: 'n/a' }] }),
    );
    expect(qa(none, 'path.forecast-line')).toHaveLength(0);
  });

  it('watches the forecast entity and stops its feed when the card leaves', () => {
    const line = STYLES.line as ChartStyleModule;
    expect(
      line.watch!(cfg({ entities: [{ entity: 'sensor.a', forecast: { entity: 'sensor.f' } }] } as Partial<CardConfig>)),
    ).toEqual(['sensor.f']);
    expect(() => line.disconnect!(document.createElement('div'))).not.toThrow();
  });
});

describe('forecast editor', () => {
  it('adds a folding forecast section to each series, and the reach once one is set', async () => {
    const line = STYLES.line as ChartStyleModule;
    const plain = line.entityFields!(undefined, cfg({}));
    expect(plain.fields.map((f) => f.name).slice(-6)).toEqual([
      'forecast_entity',
      'forecast_attribute',
      'forecast_value_key',
      'forecast_time_key',
      'forecast_type',
      'forecast_multiply',
    ]);
    const section = plain.schema.at(-1) as { type: string; title: string };
    expect(section.type).toBe('expandable');
    expect(section.title).toBe('Forecast');
    // Built once: the same schema and fields come back.
    expect(line.entityFields!(undefined, cfg({}))).toEqual(plain);
    expect(line.entityFields!(undefined, cfg({})).schema).toBe(plain.schema);
    const base = { schema: [{ name: 'x' }], fields: [{ name: 'x', path: ['x'] }] };
    expect(withForecastFields(undefined, base).fields).toBe(withForecastFields(undefined, base).fields);

    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = cfg({ entities: [{ entity: 'sensor.a', forecast: { entity: 'sensor.f' } }] } as Partial<CardConfig>);
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect((form.schema as { name: string }[]).some((f) => f.name === 'forecast_hours')).toBe(true);
    expect((form.data as Record<string, unknown>).forecast_hours).toBe(24);
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), forecast_hours: 48 } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, forecast_hours: 48 });
  });
});
