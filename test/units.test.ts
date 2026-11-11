import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { normalizeConfig } from '../src/config';
import { entityTextSchema } from '../src/editor/schemas';
import { resetLimitWarnings, resolveBands, resolveEntities } from '../src/resolve';
import type { CardConfig, HomeAssistant } from '../src/types';
import { conversion, convertPoints, convertedDecimals, convertibleUnits } from '../src/units';
import { annotationUnit, annotationValues, resolveValue } from '../src/chart/annotations';
import { temps } from '../src/styles/climate';
import { speedUnit } from '../src/styles/wind-rose';
import { makeHass } from './helpers/hass';

const cfg = (entities: unknown[], extra: Record<string, unknown> = {}) =>
  normalizeConfig({ type: 'custom:chartdeck-card', entities, ...extra } as never);

const close = (v: number | undefined, to: number) => expect(v).toBeCloseTo(to, 6);

describe('conversions', () => {
  it('converts within each family', () => {
    close(conversion('Wh', 'kWh')?.apply(18420), 18.42);
    close(conversion('kWh', 'MWh')?.apply(2500), 2.5);
    close(conversion('MWh', 'Wh')?.apply(1), 1e6);
    close(conversion('W', 'kW')?.apply(2460), 2.46);
    close(conversion('°F', '°C')?.apply(46.4), 8);
    close(conversion('°C', '°F')?.apply(100), 212);
    close(conversion('K', '°C')?.apply(273.15), 0);
    close(conversion('m/s', 'km/h')?.apply(10), 36);
    close(conversion('m/s', 'mph')?.apply(11.2), 25.053686);
    close(conversion('km/h', 'kn')?.apply(1.852), 1);
    close(conversion('hPa', 'inHg')?.apply(1013.25), 29.921252);
    close(conversion('hPa', 'mbar')?.apply(1000), 1000);
    close(conversion('mm', 'in')?.apply(25.4), 1);
  });

  it('knows no conversion for the same unit, across families, or for unknown units', () => {
    expect(conversion('W', 'W')).toBeUndefined();
    expect(conversion('W', 'kWh')).toBeUndefined();
    expect(conversion('°C', 'km/h')).toBeUndefined();
    expect(conversion('apples', 'pears')).toBeUndefined();
    expect(conversion(undefined, 'kW')).toBeUndefined();
    expect(conversion('W', undefined)).toBeUndefined();
  });

  it('lists the units a unit converts to, itself first', () => {
    expect(convertibleUnits('W')).toEqual(['W', 'kW', 'MW']);
    expect(convertibleUnits('°F')).toEqual(['°F', '°C', 'K']);
    expect(convertibleUnits('%')).toEqual([]);
    expect(convertibleUnits(undefined)).toEqual([]);
  });

  it('chooses decimals for the new unit', () => {
    expect(convertedDecimals(0, conversion('W', 'kW')!.slope)).toBe(3);
    expect(convertedDecimals(1, conversion('m/s', 'km/h')!.slope)).toBe(0);
    expect(convertedDecimals(1, conversion('°F', '°C')!.slope)).toBe(1);
    expect(convertedDecimals(0, conversion('hPa', 'inHg')!.slope)).toBe(2);
    expect(convertedDecimals(5, conversion('Wh', 'GWh')!.slope)).toBe(6);
    expect(convertedDecimals(0, conversion('kWh', 'Wh')!.slope)).toBe(0);
  });

  it('converts history points, statistics min and max included, gaps kept', () => {
    const c = conversion('W', 'kW');
    expect(
      convertPoints(
        [
          { t: 1, v: 1500, min: 1000, max: 2000 },
          { t: 2, v: null, min: null },
          { t: 3, v: 500, carried: true },
        ],
        c,
      ),
    ).toEqual([
      { t: 1, v: 1.5, min: 1, max: 2 },
      { t: 2, v: null, min: null },
      { t: 3, v: 0.5, carried: true },
    ]);
    const same = [{ t: 1, v: 1 }];
    expect(convertPoints(same, undefined)).toBe(same);
  });
});

describe('resolving a converted entity', () => {
  beforeEach(() => {
    resetLimitWarnings();
    vi.restoreAllMocks();
  });

  it('converts the value, with decimals to suit, when the unit is a known pair', () => {
    const hass = makeHass({ 'sensor.p': ['2460', { unit_of_measurement: 'W', friendly_name: 'Grid' }] });
    hass.entities = { 'sensor.p': { entity_id: 'sensor.p', display_precision: 0 } } as never;
    const [r] = resolveEntities(cfg([{ entity: 'sensor.p', unit: 'kW', max: 5 }]), hass);
    expect(r.value).toBeCloseTo(2.46);
    expect(r.unit).toBe('kW');
    expect(r.display).toBe('2.460 kW');
    expect(r.position).toBeCloseTo(0.492);
    expect(r.conversion?.to).toBe('kW');
  });

  it("uses the shown unit's default decimals when the sensor has no precision", () => {
    const hass = makeHass({ 'sensor.p': ['1734', { unit_of_measurement: 'W' }] });
    expect(resolveEntities(cfg([{ entity: 'sensor.p', unit: 'kW' }]), hass)[0].display).toBe('1.7 kW');
  });

  it('keeps set decimals, and converts the card-wide unit too', () => {
    const hass = makeHass({ 'sensor.t': ['46.4', { unit_of_measurement: '°F' }] });
    const [r] = resolveEntities(cfg(['sensor.t'], { unit: '°C', decimals: 2 }), hass);
    expect(r.display).toBe('8.00 °C');
  });

  it('only shows a unit it cannot convert to, as before', () => {
    const hass = makeHass({
      'sensor.p': ['1500', { unit_of_measurement: 'W' }],
      'sensor.n': ['7', {}],
    });
    const [p, n] = resolveEntities(
      cfg([
        { entity: 'sensor.p', unit: 'apples' },
        { entity: 'sensor.n', unit: 'kW' },
      ]),
      hass,
    );
    expect(p.display).toBe('1,500.0 apples');
    expect(p.conversion).toBeUndefined();
    expect(n.display).toBe('7.0 kW');
  });

  it('never converts an attribute, which has no unit', () => {
    const hass = makeHass({ 'sensor.p': ['1', { unit_of_measurement: 'W', load: 1500 }] });
    const [r] = resolveEntities(cfg([{ entity: 'sensor.p', attribute: 'load', unit: 'kW' }]), hass);
    expect(r.value).toBe(1500);
    expect(r.conversion).toBeUndefined();
  });

  it('reads limit and band entities in their own unit, typed numbers in the shown unit', () => {
    const hass = makeHass({
      'sensor.p': ['1500', { unit_of_measurement: 'W' }],
      'input_number.cap': ['3000', { unit_of_measurement: 'W' }],
      'input_number.goal': ['2', { unit_of_measurement: 'kW' }],
      'input_number.warn': ['1000', { unit_of_measurement: 'W' }],
      'input_number.plain': ['4', {}],
    });
    const [r] = resolveEntities(
      cfg([
        {
          entity: 'sensor.p',
          unit: 'kW',
          min: 'input_number.plain',
          max: 'input_number.cap',
          target: 'input_number.goal',
          severity: [
            { from: 0, color: 'green' },
            { from: 'input_number.warn', color: 'red' },
          ],
        },
      ]),
      hass,
    );
    expect(r.min).toBe(4);
    expect(r.max).toBe(3);
    expect(r.target).toBe(2);
    expect(r.bands.map((b) => b.from)).toEqual([0, 1]);
    expect(r.band.color).toBe('red');
    expect(resolveBands([{ from: 'input_number.warn', color: 'red' }], hass, 'kW')[0].from).toBe(1);
    expect(resolveBands([{ from: 'input_number.warn', color: 'red' }], hass)[0].from).toBe(1000);
  });
});

describe('editor', () => {
  it('offers the units a sensor converts to, and plain text otherwise', () => {
    type Grid = { schema: { name: string; selector: Record<string, unknown> }[] }[];
    const unitOf = (schema: unknown) => (schema as Grid)[0].schema.find((f) => f.name === 'unit')!.selector;
    expect(unitOf(entityTextSchema())).toEqual({ text: {} });
    expect(unitOf(entityTextSchema('%'))).toEqual({ text: {} });
    expect(unitOf(entityTextSchema('W'))).toEqual({
      select: { mode: 'dropdown', custom_value: true, options: ['W', 'kW', 'MW'] },
    });
    expect(entityTextSchema('W')).toBe(entityTextSchema('W'));
  });
});

describe('a line chart with a converted unit', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('converts the history and the header', async () => {
    const now = Date.now();
    const H = 3_600_000;
    const hass = makeHass({ 'sensor.p': ['2000', { friendly_name: 'Grid', unit_of_measurement: 'W' }] });
    hass.callWS = vi.fn(async () => ({
      'sensor.p': [
        { s: '1000', lu: (now - 5 * H) / 1000 },
        { s: '3000', lu: (now - 3 * H) / 1000 },
        { s: '2000', lu: (now - 1 * H) / 1000 },
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
      labels: true,
      decimals: 1,
      entities: [{ entity: 'sensor.p', unit: 'kW' }],
    } as CardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    const root = card.shadowRoot!;
    expect(root.querySelector('.series-item')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Grid 2.0 kW');
    const labels = [...root.querySelectorAll('.point-label')].map((e) => e.textContent);
    expect(labels).toContain('3.0');
    expect(labels).not.toContain('3,000.0');
  });
});

/* ------------------------------------------------------------- charts that read units their own way */

type Mounted = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

async function mountCard(config: Record<string, unknown>, hass: HomeAssistant) {
  const card = document.createElement('chartdeck-card') as Mounted;
  card.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const historyOf = (rows: Record<string, unknown[]>) =>
  vi.fn(async (msg: { entity_ids?: string[] }) => {
    const out: Record<string, unknown[]> = {};
    for (const id of msg.entity_ids ?? []) if (rows[id]) out[id] = rows[id];
    return out;
  }) as unknown as HomeAssistant['callWS'];

const squash = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

describe('wind rose speeds', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const D = 86_400_000;

  function windHass(extra: Record<string, [string, Record<string, unknown>]> = {}) {
    const now = Date.now();
    const sec = (ago: number) => (now - ago) / 1000;
    const hass = makeHass({
      'sensor.dir': ['270', { unit_of_measurement: '°' }],
      'sensor.speed': ['5', { unit_of_measurement: 'm/s' }],
      ...extra,
    });
    hass.callWS = historyOf({
      'sensor.dir': [
        { s: '270', lu: sec(14 * D) },
        { s: '90', lu: sec(4 * D) },
      ],
      'sensor.speed': [
        { s: '10', lu: sec(14 * D) },
        { s: '5', lu: sec(4 * D) },
      ],
    });
    return hass;
  }
  const stats = (card: Mounted) =>
    Object.fromEntries(
      [...card.shadowRoot!.querySelectorAll('.stat')].map((e) => [
        squash(e.querySelector('.stat-label')),
        squash(e.querySelector('.stat-value')),
      ]),
    );
  const keys = (card: Mounted) => [...card.shadowRoot!.querySelectorAll('.key-label')].map((e) => e.textContent);

  it('works out the shown unit and its conversion from the speed entity', () => {
    const hass = makeHass({ 'sensor.speed': ['5', { unit_of_measurement: 'm/s', gust: 7 }] });
    const role = (entity: Record<string, unknown>) => ({ id: 'sensor.speed', index: 1, entity: entity as never });
    expect(speedUnit(role({ entity: 'sensor.speed' }), { hass })).toEqual({ unit: 'm/s' });
    const kmh = speedUnit(role({ entity: 'sensor.speed', unit: 'km/h' }), { hass });
    expect(kmh.unit).toBe('km/h');
    close(kmh.conversion?.apply(10), 36);
    expect(speedUnit(role({ entity: 'sensor.speed', unit: 'Beaufort' }), { hass })).toEqual({ unit: 'Beaufort' });
    expect(speedUnit(role({ entity: 'sensor.speed', attribute: 'gust', unit: 'km/h' }), { hass })).toEqual({
      unit: 'km/h',
    });
  });

  it('converts the speeds, and picks the default bands and calm for the shown unit', async () => {
    const plain = await mountCard({ style: 'wind_rose', entities: ['sensor.dir', 'sensor.speed'] }, windHass());
    expect(stats(plain)['Mean speed']).toBe('8.6 m/s');
    expect(keys(plain)).toEqual(['0–3', '3–6', '6–9', '9–12', '12+']);
    document.body.innerHTML = '';
    const card = await mountCard(
      { style: 'wind_rose', entities: ['sensor.dir', { entity: 'sensor.speed', unit: 'km/h', decimals: 0 }] },
      windHass(),
    );
    // 10 m/s for 10 days and 5 m/s for 4: 31 km/h on average, 36 at the most.
    expect(stats(card)['Mean speed']).toBe('31 km/h');
    expect(stats(card).Strongest).toBe('36 km/h');
    expect(keys(card)).toEqual(['0–12', '12–20', '20–29', '29–39', '39+']);
    expect(squash(card.shadowRoot!.querySelector('.speed-legend .stat-label'))).toBe('Speed (km/h)');
    // The 18 km/h readings (5 m/s) land in the 12–20 band, the 36 km/h ones in 29–39: two colours.
    const colours = new Set(
      [...card.shadowRoot!.querySelectorAll('.petal path')].map((p) => (p as SVGElement).style.fill),
    );
    expect(colours.size).toBe(2);
  });

  it('reads a band start from an entity in its own unit', async () => {
    const hass = windHass({ 'input_number.gale': ['20', { unit_of_measurement: 'mph' }] });
    const card = await mountCard(
      {
        style: 'wind_rose',
        entities: [
          'sensor.dir',
          {
            entity: 'sensor.speed',
            unit: 'km/h',
            severity: [
              { from: 0, color: 'green' },
              { from: 'input_number.gale', color: 'red' },
            ],
          },
        ],
      },
      hass,
    );
    // 20 mph is 32.2 km/h.
    expect(keys(card)).toEqual(['0–32.2', '32.2+']);
  });
});

describe('climate temperatures', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const H = 3_600_000;

  function climateHass() {
    const now = Date.now();
    const hass = makeHass(
      {
        'climate.lounge': [
          'heat',
          { friendly_name: 'Lounge', current_temperature: 68, temperature: 71.6, hvac_action: 'heating' },
        ],
      },
      { config: { unit_system: { temperature: '°F' } } } as never,
    );
    hass.callWS = historyOf({
      'climate.lounge': [
        { s: 'heat', a: { current_temperature: 50, temperature: 68, hvac_action: 'idle' }, lu: (now - 10 * H) / 1000 },
        {
          s: 'heat',
          a: { current_temperature: 68, temperature: 71.6, hvac_action: 'heating' },
          lu: (now - 5 * H) / 1000,
        },
      ],
    });
    return hass;
  }

  it("converts from Home Assistant's unit when the card's unit is a known pair", () => {
    const hass = makeHass({}, { config: { unit_system: { temperature: '°F' } } } as never);
    const entity = (unit?: string) => ({ config: { entity: 'climate.x', ...(unit ? { unit } : {}) } }) as never;
    const c = temps(entity('°C'), hass);
    expect(c.unit).toBe('°C');
    close(c.convert(212) as number, 100);
    expect(c.convert('idle')).toBe('idle');
    const f = temps(entity(), hass);
    expect(f.unit).toBe('°F');
    expect(f.conversion).toBeUndefined();
    expect(f.convert(70)).toBe(70);
    expect(temps(entity('degrees'), hass).convert(70)).toBe(70);
  });

  it('shows the header and the history in the converted unit', async () => {
    const card = await mountCard(
      { style: 'climate', entities: [{ entity: 'climate.lounge', unit: '°C' }] },
      climateHass(),
    );
    const items = [...card.shadowRoot!.querySelectorAll('.series-item')].map(squash);
    expect(items[0]).toBe('Lounge 20.0 °C');
    expect(items[1]).toBe('Set point 22.0 °C');
    // The value axis spans the converted readings (10–22 °C), not the °F ones (50–71.6).
    const ticks = [...card.shadowRoot!.querySelectorAll('.y-axis .axis-label')].map((e) => Number(squash(e)));
    expect(ticks.length).toBeGreaterThan(1);
    expect(Math.max(...ticks)).toBeLessThan(30);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(10);
  });
});

describe('annotation lines read from an entity', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it("convert from the entity's unit to the chart's", () => {
    const hass = makeHass({
      'input_number.cap_f': ['212', { unit_of_measurement: '°F' }],
      'input_number.plain': ['40', {}],
      'input_number.odd': ['5', { unit_of_measurement: 'apples' }],
      'input_number.off': ['unavailable', { unit_of_measurement: '°F' }],
    });
    close(resolveValue('input_number.cap_f', hass, '°C'), 100);
    expect(resolveValue('input_number.cap_f', hass)).toBe(212);
    expect(resolveValue('input_number.plain', hass, '°C')).toBe(40);
    expect(resolveValue('input_number.odd', hass, '°C')).toBe(5);
    expect(resolveValue('input_number.off', hass, '°C')).toBeUndefined();
    // Typed numbers are in the chart's unit already.
    expect(resolveValue(30, hass, '°F')).toBe(30);
    expect(resolveValue('30', hass, '°F')).toBe(30);
    const raw = {
      type: 'x',
      annotations: [
        { type: 'line', value: 'input_number.cap_f' },
        { type: 'band', from: 'input_number.cap_f' },
      ],
    } as unknown as CardConfig;
    expect(annotationValues(raw, hass, '°C').map((v) => Math.round(v))).toEqual([100]);
    expect(annotationUnit({ series: [] })).toBeUndefined();
    expect(annotationUnit({ series: [{ entity: { unit: 'kW' } }] } as never)).toBe('kW');
  });

  it('draw a threshold from a °F helper at the right height on a °C line chart', async () => {
    const now = Date.now();
    const H = 3_600_000;
    const hass = makeHass({
      'sensor.t': ['20', { friendly_name: 'Room', unit_of_measurement: '°C' }],
      'input_number.limit': ['77', { unit_of_measurement: '°F' }],
    });
    hass.callWS = historyOf({
      'sensor.t': [
        { s: '15', lu: (now - 5 * H) / 1000 },
        { s: '20', lu: (now - 1 * H) / 1000 },
      ],
    });
    const card = await mountCard(
      {
        style: 'line',
        entities: ['sensor.t'],
        annotations: [{ type: 'line', value: 'input_number.limit', label: 'Too hot' }],
      },
      hass,
    );
    // 77 °F is 25 °C: the axis reaches it, rather than 77.
    const ticks = [...card.shadowRoot!.querySelectorAll('.y-axis .axis-label')].map((e) => Number(squash(e)));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...ticks)).toBeLessThan(40);
    expect(card.shadowRoot!.querySelector('line.threshold')).not.toBeNull();
  });
});

describe('day clock numbers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('are converted before they are folded into the day', async () => {
    const now = Date.now();
    const H = 3_600_000;
    const hass = makeHass({ 'sensor.p': ['2000', { friendly_name: 'Grid', unit_of_measurement: 'W' }] });
    hass.callWS = historyOf({
      'sensor.p': [
        { s: '1000', lu: (now - 30 * H) / 1000 },
        { s: '4000', lu: (now - 2 * H) / 1000 },
        { s: '2000', lu: (now - 1 * H) / 1000 },
      ],
    });
    const card = await mountCard(
      { style: 'day_clock', aggregate: 'max', entities: [{ entity: 'sensor.p', unit: 'kW', decimals: 1 }] },
      hass,
    );
    const label = card.shadowRoot!.querySelector('.dc-ring')!.getAttribute('aria-label')!;
    expect(label).toMatch(/peak 4\.0 kW at/);
  });
});
