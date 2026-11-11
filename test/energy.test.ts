import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  DEFAULT_ENERGY_FLOWS,
  PREFS_REFRESH_MS,
  belowAxis,
  defaultFlows,
  energyCardRaw,
  energyEntities,
  energyPrefs,
  energyStatistics,
  energyValueText,
  periodTotal,
  shownValue,
  validateEnergy,
  withEnergyDefaults,
} from '../src/history/energy';
import type { EnergyPrefs } from '../src/history/energy';
import { sankeyItems, totalsGrouping, withTotal } from '../src/history/energy-totals';
import { resolveEntities } from '../src/resolve';
import { normalizeConfig } from '../src/config';
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

const PREFS: EnergyPrefs = {
  energy_sources: [
    {
      type: 'grid',
      flow_from: [{ stat_energy_from: 'sensor.grid_in' }, { stat_energy_from: 'sensor.grid_in_night' }],
      flow_to: [{ stat_energy_to: 'sensor.grid_out' }],
    },
    { type: 'solar', stat_energy_from: 'sensor.solar' },
    { type: 'battery', stat_energy_from: 'sensor.batt_out', stat_energy_to: 'sensor.batt_in' },
    { type: 'gas', stat_energy_from: 'sensor.gas' },
    { type: 'water', stat_energy_from: 'sensor.water' },
    { type: 'unknown' },
  ],
  device_consumption: [{ stat_consumption: 'sensor.kettle', name: 'Kettle' }, { stat_consumption: null }],
};

describe('energy settings', () => {
  it('finds each flow, old and new grid layouts, each statistic once, in the order asked', () => {
    const all = energyStatistics(PREFS, ['solar', 'grid_import', 'grid_export', 'devices', 'gas', 'water']);
    expect(all.map((s) => s.id)).toEqual([
      'sensor.solar',
      'sensor.grid_in',
      'sensor.grid_in_night',
      'sensor.grid_out',
      'sensor.kettle',
      'sensor.gas',
      'sensor.water',
    ]);
    expect(all.find((s) => s.id === 'sensor.kettle')!.name).toBe('Kettle');
    const flat = energyStatistics(
      {
        energy_sources: [
          { type: 'grid', stat_energy_from: 'sensor.a', stat_energy_to: 'sensor.b' },
          { type: 'grid', stat_energy_from: 'sensor.a' },
        ],
      },
      DEFAULT_ENERGY_FLOWS,
    );
    expect(flat.map((s) => [s.id, s.flow])).toEqual([
      ['sensor.a', 'grid_import'],
      ['sensor.b', 'grid_export'],
    ]);
    expect(energyStatistics({}, DEFAULT_ENERGY_FLOWS)).toEqual([]);
  });

  it('names a lone flow after it, several by their own names, in the dashboard colours', () => {
    const hass = makeHass({ 'sensor.grid_in': ['5', { friendly_name: 'Day rate' }] });
    const entities = energyEntities(energyStatistics(PREFS, ['grid_import', 'solar', 'battery_in', 'gas']), hass);
    const none = { action: 'none' };
    const stat = { statistic: true, tap_action: none, hold_action: none, double_tap_action: none };
    expect(entities).toEqual([
      {
        entity: 'sensor.grid_in',
        name: 'Day rate',
        energy_flow: 'grid_import',
        color: 'var(--energy-grid-consumption-color, #488fc2)',
      },
      {
        entity: 'sensor.grid_in_night',
        name: 'Grid import',
        energy_flow: 'grid_import',
        color: expect.any(String),
        unit: 'kWh',
        ...stat,
      },
      {
        entity: 'sensor.solar',
        name: 'Solar',
        energy_flow: 'solar',
        color: 'var(--energy-solar-color, #ff9800)',
        unit: 'kWh',
        ...stat,
      },
      {
        entity: 'sensor.batt_in',
        name: 'Battery in',
        energy_flow: 'battery_in',
        color: expect.any(String),
        unit: 'kWh',
        ...stat,
      },
      // Gas comes in m³ or kWh: only the sensor (or its statistic) knows, so no unit is guessed.
      { entity: 'sensor.gas', name: 'Gas', energy_flow: 'gas', color: expect.any(String), ...stat },
    ]);
    const devices = energyEntities(energyStatistics(PREFS, ['devices']), hass);
    expect(devices[0]).toEqual({
      entity: 'sensor.kettle',
      name: 'Kettle',
      energy_flow: 'devices',
      unit: 'kWh',
      ...stat,
    });
  });

  it('names and measures a statistic that is no entity from its metadata', () => {
    const prefs: EnergyPrefs = {
      energy_sources: [{ type: 'gas', stat_energy_from: 'tibber:gas' }],
      device_consumption: [{ stat_consumption: 'tibber:energy_dryer' }, { stat_consumption: 'sensor.unknown' }],
    };
    const meta = {
      'tibber:gas': { name: 'Tibber gas', unit: 'm³' },
      'tibber:energy_dryer': { name: 'Dryer', unit: 'Wh' },
    };
    const [gas, dryer, unknown] = energyEntities(energyStatistics(prefs, ['gas', 'devices']), undefined, meta);
    // A lone flow is still called after the flow; its unit comes from the statistic.
    expect(gas).toMatchObject({ entity: 'tibber:gas', name: 'Gas', unit: 'm³', statistic: true });
    expect(dryer).toMatchObject({ name: 'Dryer', unit: 'Wh', statistic: true, tap_action: { action: 'none' } });
    // Nothing known at all: the flow's name and kWh.
    expect(unknown).toMatchObject({ name: 'Devices', unit: 'kWh', statistic: true });
  });

  it('marks export and charging to draw below the axis when asked', () => {
    const below = energyEntities(energyStatistics(PREFS, DEFAULT_ENERGY_FLOWS), undefined, {}, true);
    expect(below.filter((e) => (e as { energy_below?: boolean }).energy_below).map((e) => e.entity)).toEqual([
      'sensor.grid_out',
      'sensor.batt_in',
    ]);
    const flat = energyEntities(energyStatistics(PREFS, DEFAULT_ENERGY_FLOWS), undefined);
    expect(flat.some((e) => (e as { energy_below?: boolean }).energy_below)).toBe(false);
  });

  it('draws the statistics as hourly change, the card’s own entities after', () => {
    const raw = { type: 'x', style: 'line', source: 'energy', entities: ['sensor.temp'] } as CardConfig;
    const out = energyCardRaw(raw, PREFS, undefined);
    expect(out).toMatchObject({ source: 'statistics', group_by: 'hour', aggregate: 'change' });
    expect(out.show).toBeUndefined();
    expect((out.entities as unknown[]).at(-1)).toBe('sensor.temp');
    expect(out.entities).toHaveLength(7);
    // A line doesn't split; a column does unless told not to.
    const below = (c: CardConfig) =>
      (c.entities as { entity: string; energy_below?: boolean }[]).filter((e) => e.energy_below).map((e) => e.entity);
    expect(below(out)).toEqual([]);
    expect(below(energyCardRaw({ type: 'x', style: 'column', source: 'energy' }, PREFS, undefined))).toEqual([
      'sensor.grid_out',
      'sensor.batt_in',
    ]);
    expect(
      below(energyCardRaw({ type: 'x', style: 'area', source: 'energy', energy_split: false }, PREFS, undefined)),
    ).toEqual([]);
    // A pie or Sankey reads its own totals: no grouping is set for it.
    const pie = energyCardRaw({ type: 'x', style: 'pie', source: 'energy' }, PREFS, undefined);
    expect(pie.group_by).toBeUndefined();
    expect((pie.entities as { entity: string }[]).map((e) => e.entity)).toEqual([
      'sensor.grid_in',
      'sensor.grid_in_night',
      'sensor.solar',
      'sensor.batt_out',
    ]);
    expect(defaultFlows('sankey')).toContain('devices');
    expect(defaultFlows('line')).toEqual(DEFAULT_ENERGY_FLOWS);
    const column = energyCardRaw(
      { type: 'x', style: 'column', source: 'energy', aggregate: 'auto', show: { value: true } } as CardConfig,
      PREFS,
      undefined,
    );
    expect(column.group_by).toBeUndefined();
    expect(column.aggregate).toBe('change');
    expect(column.show).toEqual({ value: true });
    const own = energyCardRaw(
      {
        type: 'x',
        style: 'area',
        source: 'energy',
        group_by: 'day',
        aggregate: 'max',
        energy_flows: ['gas'],
      } as CardConfig,
      PREFS,
      undefined,
    );
    expect(own).toMatchObject({ group_by: 'day', aggregate: 'max', entities: [{ entity: 'sensor.gas' }] });
  });

  it('checks the options', () => {
    const check = (raw: Record<string, unknown>) => () => validateEnergy({ type: 'x', ...raw } as CardConfig);
    expect(check({ style: 'line', source: 'energy' })).not.toThrow();
    expect(check({ style: 'pie', source: 'energy' })).not.toThrow();
    expect(check({ style: 'sankey', source: 'energy', energy_flows: ['solar', 'devices'] })).not.toThrow();
    expect(check({ style: 'sankey', source: 'energy', energy_flows: ['solar', 'gas'] })).toThrow(
      /"energy_flows" on a Sankey must be a list of/,
    );
    expect(check({ style: 'radar', source: 'energy' })).toThrow(
      '"source: energy" works with these styles: line, column, area, pie, sankey',
    );
    expect(check({ source: 'energy' })).toThrow(/works with/);
    expect(check({ style: 'column', source: 'energy', energy_split: 'yes' })).toThrow(
      '"energy_split" must be true or false',
    );
    expect(check({ style: 'column', energy_split: false })).toThrow('"energy_split" needs "source: energy"');
    expect(check({ style: 'line', source: 'energy', energy_flows: ['solar', 'wind'] })).toThrow(
      /"energy_flows" must be a list of/,
    );
    expect(check({ style: 'line', source: 'energy', energy_flows: 'solar' })).toThrow(/energy_flows/);
    expect(check({ style: 'line', energy_flows: ['solar'] })).toThrow('"energy_flows" needs "source: energy"');
    expect(check({ style: 'line' })).not.toThrow();
  });

  it('sets hourly change in the editor when the source is first switched to energy', () => {
    const before = { type: 'x', style: 'line' } as CardConfig;
    expect(withEnergyDefaults(before, { ...before, source: 'energy' })).toMatchObject({
      group_by: 'hour',
      aggregate: 'change',
    });
    const column = { type: 'x', style: 'column' } as CardConfig;
    expect(withEnergyDefaults(column, { ...column, source: 'energy' }).group_by).toBeUndefined();
    const already = { ...before, source: 'energy', group_by: 'none' } as CardConfig;
    expect(withEnergyDefaults(already, { ...already, curve: 'step' })).toEqual({ ...already, curve: 'step' });
    expect(withEnergyDefaults(before, { ...before, curve: 'step' })).toEqual({ ...before, curve: 'step' });
    // A pie or Sankey opens on today.
    const pie = { type: 'x', style: 'pie' } as CardConfig;
    expect(withEnergyDefaults(pie, { ...pie, source: 'energy' })).toEqual({
      ...pie,
      source: 'energy',
      period: { calendar: 'day' },
    });
    const week = { ...pie, period: { last: 7, unit: 'day' } } as CardConfig;
    expect(withEnergyDefaults(week, { ...week, source: 'energy' })).toEqual({ ...week, source: 'energy' });
    // Leaving the Energy dashboard drops its options, which would otherwise make the card refuse.
    const energy = { ...before, source: 'energy', energy_flows: ['solar'], energy_split: false } as CardConfig;
    expect(withEnergyDefaults(energy, { ...energy, source: 'history' })).toEqual({ ...before, source: 'history' });
    const plain = { ...before, source: 'energy' } as CardConfig;
    expect(withEnergyDefaults(plain, { ...plain, source: 'history' })).toEqual({ ...before, source: 'history' });
  });
});

describe('energy values', () => {
  const H = 3_600_000;
  it('turns points over for below the axis, and reads them back positive', () => {
    expect(
      belowAxis([
        { t: 0, v: 2, min: 1, max: 3 },
        { t: 1, v: null },
      ]),
    ).toEqual([
      { t: 0, v: -2, min: -3, max: -1 },
      { t: 1, v: null },
    ]);
    expect(belowAxis([{ t: 0, v: 1, min: null, max: null }])).toEqual([{ t: 0, v: -1, min: null, max: null }]);
    expect(shownValue({ config: { energy_below: true } }, -2)).toBe(2);
    expect(shownValue({ config: {} }, -2)).toBe(-2);
    expect(
      periodTotal([
        { t: 0, v: 1 },
        { t: 1, v: null },
        { t: 2, v: 2.5 },
      ]),
    ).toBe(3.5);
    expect(periodTotal([{ t: 0, v: null }])).toBeNull();
  });

  it('heads an energy series with its total over the span, any other with its value', () => {
    const hass = makeHass({ 'sensor.meter': ['1200', { unit_of_measurement: 'kWh' }] });
    const [meter, stat, export_, other] = resolveEntities(
      normalizeConfig({
        type: 'x',
        entities: [
          { entity: 'sensor.meter', energy_flow: 'grid_import' },
          { entity: 'tibber:x', energy_flow: 'devices', statistic: true, unit: 'kWh' },
          { entity: 'sensor.out', energy_flow: 'grid_export', energy_below: true, statistic: true, unit: 'kWh' },
          'sensor.meter',
        ],
      } as CardConfig),
      hass,
    );
    const pts = [
      { t: 0, v: 1.25 },
      { t: H, v: 0.75 },
    ];
    const change = { unit: 'hour', aggregate: 'change' } as const;
    expect(energyValueText(meter, pts, change, hass)).toBe('2.0 kWh');
    expect(energyValueText(export_, belowAxis(pts), change, hass)).toBe('2.0 kWh');
    expect(energyValueText(stat, [], change, hass)).toBe('');
    // Not read as change: a meter shows its reading, a statistic nothing.
    expect(energyValueText(meter, pts, { unit: 'hour', aggregate: 'mean' }, hass)).toBeUndefined();
    expect(energyValueText(stat, pts, undefined, hass)).toBe('');
    expect(energyValueText(other, pts, change, hass)).toBeUndefined();
  });

  it('never calls a statistic with no entity missing', () => {
    const hass = makeHass({});
    const [stat, gone] = resolveEntities(
      normalizeConfig({
        type: 'x',
        hide_unavailable: true,
        entities: [{ entity: 'tibber:x', name: 'Dryer', statistic: true }, 'sensor.gone'],
      } as CardConfig),
      hass,
    );
    expect(stat).toMatchObject({ display: '', label: 'Dryer', available: false });
    // hide_unavailable keeps it (it has no state to be unavailable), and drops a missing entity.
    expect(gone).toBeUndefined();
  });

  it('reads a span’s totals by the hour, by the day past a month', () => {
    expect(totalsGrouping({ type: 'x', period: { calendar: 'day' } }, undefined)).toBe('hour');
    expect(totalsGrouping({ type: 'x', period: { calendar: 'month' } }, undefined)).toBe('hour');
    expect(totalsGrouping({ type: 'x', period: { last: 3, unit: 'month' } }, undefined)).toBe('day');
  });

  it('runs a Sankey from the sources through the house, balancing it with untracked use', () => {
    const hass = makeHass({});
    const resolved = resolveEntities(
      normalizeConfig({
        type: 'x',
        entities: [
          { entity: 'a', energy_flow: 'grid_import', name: 'Grid import', statistic: true, unit: 'kWh' },
          { entity: 'b', energy_flow: 'solar', name: 'Solar', statistic: true, unit: 'kWh' },
          { entity: 'c', energy_flow: 'grid_export', name: 'Grid export', statistic: true, unit: 'kWh' },
          { entity: 'd', energy_flow: 'devices', name: 'Kettle', statistic: true, unit: 'kWh' },
          { entity: 'e', name: 'Own', from: 'X', to: 'Y' },
        ],
      } as CardConfig),
      hass,
    );
    const items = sankeyItems(
      resolved.map((e, i) => withTotal(e, [4, 6, 3, 2, 1][i], hass)),
      hass,
    );
    const ends = items.map((e) => [(e.config as { from?: string }).from, (e.config as { to?: string }).to]);
    expect(ends).toEqual([
      ['Grid import', 'Home'],
      ['Solar', 'Home'],
      ['Home', 'Grid export'],
      ['Home', 'Kettle'],
      ['X', 'Y'],
      ['Home', 'Untracked use'],
    ]);
    expect(items[5]).toMatchObject({
      value: 5,
      display: '5.0 kWh',
      entityId: '',
      config: { tap_action: { action: 'none' } },
    });
    // No devices drawn: the rest is simply used at home. Nothing left over: no extra flow.
    const noDevices = sankeyItems([withTotal(resolved[0], 4, hass), withTotal(resolved[2], 1, hass)], hass);
    expect(noDevices.at(-1)!.name).toBe('Used at home');
    expect(sankeyItems([withTotal(resolved[0], 4, hass), withTotal(resolved[2], 4, hass)], hass)).toHaveLength(2);
    expect(sankeyItems([resolved[4]], hass)).toHaveLength(1);
    expect(withTotal(resolved[0], null, hass)).toMatchObject({ available: false, display: '', label: 'Grid import' });
  });
});

describe('loading the energy settings', () => {
  it('asks once for every card, tells each when they land, and reads them again later', async () => {
    const hass = makeHass({});
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) =>
      msg.type === 'energy/get_prefs'
        ? PREFS
        : [{ statistic_id: 'sensor.gas', name: 'Gas meter', statistics_unit_of_measurement: 'm³' }, null],
    ) as HomeAssistant['callWS'];
    const a = vi.fn();
    const b = vi.fn();
    expect(energyPrefs(hass, a, 0).status).toBe('loading');
    expect(energyPrefs(hass, b, 0).status).toBe('loading');
    await new Promise((r) => setTimeout(r, 0));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    const ready = energyPrefs(hass, a, Date.now());
    expect(ready).toEqual({ status: 'ready', prefs: PREFS, meta: { 'sensor.gas': { name: 'Gas meter', unit: 'm³' } } });
    // The settings, then every statistic's metadata, once.
    expect(hass.callWS).toHaveBeenCalledTimes(2);
    expect((hass.callWS as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({
      type: 'recorder/get_statistics_metadata',
      statistic_ids: expect.arrayContaining(['sensor.grid_in', 'sensor.kettle', 'sensor.water']),
    });
    // Stale: the old settings draw while they load again.
    expect(energyPrefs(hass, a, Date.now() + PREFS_REFRESH_MS + 1).status).toBe('ready');
    expect(hass.callWS).toHaveBeenCalledTimes(3);
  });

  it('carries on without metadata it cannot read, and asks none for empty settings', async () => {
    const hass = makeHass({});
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      if (msg.type === 'energy/get_prefs') return PREFS;
      throw new Error('Unknown command');
    }) as HomeAssistant['callWS'];
    energyPrefs(hass, () => {}, 0);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(energyPrefs(hass, () => {}, Date.now())).toEqual({ status: 'ready', prefs: PREFS, meta: {} });
    const empty = makeHass({});
    empty.callWS = vi.fn(async () => null) as HomeAssistant['callWS'];
    energyPrefs(empty, () => {}, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(energyPrefs(empty, () => {}, Date.now())).toEqual({ status: 'ready', prefs: {}, meta: {} });
    expect(empty.callWS).toHaveBeenCalledOnce();
  });

  it('reports a failure, tries again later, and needs a connection', async () => {
    const hass = makeHass({});
    hass.callWS = vi.fn(async () => {
      throw new Error('Unknown command');
    }) as HomeAssistant['callWS'];
    energyPrefs(hass, () => {}, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(energyPrefs(hass, () => {}, Date.now())).toEqual({ status: 'error', error: 'Unknown command' });
    expect(energyPrefs(hass, () => {}, Date.now() + 120_000).status).toBe('loading');
    expect(energyPrefs(makeHass({}), () => {}).status).toBe('error');
  });
});

describe('a card drawing the Energy dashboard', () => {
  const H = 3_600_000;
  function hassWith(prefs: EnergyPrefs | Error = PREFS) {
    const hass = makeHass({
      'sensor.grid_in': [
        '1200',
        { friendly_name: 'Grid meter', unit_of_measurement: 'kWh', state_class: 'total_increasing' },
      ],
      'sensor.solar': [
        '800',
        { friendly_name: 'Solar meter', unit_of_measurement: 'kWh', state_class: 'total_increasing' },
      ],
    });
    const calls: Record<string, unknown>[] = [];
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      calls.push(msg);
      if (msg.type === 'energy/get_prefs') {
        if (prefs instanceof Error) throw prefs;
        return prefs;
      }
      if (msg.type === 'recorder/get_statistics_metadata') {
        return [{ statistic_id: 'sensor.kettle', name: 'Kettle meter', statistics_unit_of_measurement: 'kWh' }];
      }
      const start = Date.parse(msg.start_time as string);
      const out: Record<string, unknown[]> = {};
      for (const id of msg.statistic_ids as string[]) {
        out[id] = Array.from({ length: 24 }, (_, i) => ({
          start: start + i * H,
          change: id.includes('solar') ? Math.max(0, 6 - Math.abs(i - 12)) / 2 : 0.5,
        }));
      }
      return out;
    }) as HomeAssistant['callWS'];
    return { hass, calls };
  }

  async function mount(config: Partial<CardConfig>, hass: HomeAssistant) {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'column', source: 'energy', ...config } as CardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    for (let i = 0; i < 4; i++) {
      await card.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
    }
    await card.updateComplete;
    return card;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

  it('loads the settings, then the hourly change of each flow, and draws them named and coloured', async () => {
    const { hass, calls } = hassWith();
    const card = await mount({ period: { last: 24, unit: 'hour' } } as Partial<CardConfig>, hass);
    expect(calls[0]).toEqual({ type: 'energy/get_prefs' });
    const stats = calls.find((c) => c.type === 'recorder/statistics_during_period')!;
    expect(stats.statistic_ids).toEqual([
      'sensor.grid_in',
      'sensor.grid_in_night',
      'sensor.grid_out',
      'sensor.solar',
      'sensor.batt_out',
      'sensor.batt_in',
    ]);
    expect(stats.types).toEqual(['change']);
    const names = qa(card, '.series-name').map((n) => n.textContent);
    expect(names).toEqual(['Grid meter', 'Grid import', 'Grid export', 'Solar', 'Battery out', 'Battery in']);
    // Each heads with its total over the span, statistics with no entity too: never "Entity not found".
    const values = qa(card, '.series-value').map((n) => n.textContent);
    expect(values).toHaveLength(6);
    for (const v of values) expect(v).toMatch(/^\d+\.\d kWh$/);
    expect(card.shadowRoot!.textContent).not.toContain('Entity not found');
    // A statistic with no entity has nothing to open.
    const items = qa(card, '.series-item');
    expect(items[0].getAttribute('tabindex')).toBe('0');
    expect(items[1].getAttribute('tabindex')).toBeNull();
    expect(items[1].classList.contains('inert')).toBe(true);
    expect(qa(card, '.swatch')[3].getAttribute('style')).toContain('--energy-solar-color');
    expect(qa(card, '.col').length).toBeGreaterThan(0);
    // Export and charging go below the axis; import above it.
    const cols = (series: string) => qa(card, `.col[data-series="${series}"]`);
    expect(cols('2').length).toBeGreaterThan(0);
    expect(cols('2').every((c) => c.classList.contains('down'))).toBe(true);
    expect(cols('5').every((c) => c.classList.contains('down'))).toBe(true);
    expect(cols('0').some((c) => c.classList.contains('down'))).toBe(false);
  });

  it('keeps every flow above the axis with energy_split off', async () => {
    const { hass } = hassWith();
    const card = await mount({ energy_split: false } as Partial<CardConfig>, hass);
    expect(qa(card, '.col').length).toBeGreaterThan(0);
    expect(qa(card, '.col.down')).toHaveLength(0);
  });

  it('shares out the day’s totals in a pie, statistics named from their metadata', async () => {
    const { hass, calls } = hassWith();
    const card = await mount(
      { style: 'pie', period: { last: 24, unit: 'hour' }, energy_flows: ['devices', 'solar'] } as Partial<CardConfig>,
      hass,
    );
    const stats = calls.find((c) => c.type === 'recorder/statistics_during_period')!;
    expect(stats).toMatchObject({
      statistic_ids: ['sensor.kettle', 'sensor.solar'],
      period: 'hour',
      types: ['change'],
    });
    expect(qa(card, '.part-name').map((n) => n.textContent)).toEqual(['Kettle', 'Solar']);
    const values = qa(card, '.part-value').map((n) => n.textContent);
    expect(values.every((v) => /kWh$/.test(v!))).toBe(true);
    expect(qa(card, '.slice')).toHaveLength(2);
    expect(card.shadowRoot!.textContent).not.toContain('Entity not found');
  });

  it('exports what each chart drew: hourly flows read positive, a pie its totals', async () => {
    const copied: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => void copied.push(t) } });
    const csv = async (card: Card) => {
      (card.shadowRoot!.querySelector('.export-button') as HTMLElement).click();
      await card.updateComplete;
      (card.shadowRoot!.querySelector('.export-item[data-action="csv"]') as HTMLElement).click();
      for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
      return copied.at(-1)!.trim().split('\r\n').slice(1);
    };
    const { hass } = hassWith();
    const column = await mount(
      { export: true, period: { last: 24, unit: 'hour' }, energy_flows: ['grid_export'] } as Partial<CardConfig>,
      hass,
    );
    const rows = await csv(column);
    expect(rows.length).toBeGreaterThan(0);
    // Drawn below the axis, but grid export is energy sent out: positive in the CSV.
    for (const r of rows) expect(Number(r.split(',')[2])).toBeGreaterThan(0);
    const pie = await mount(
      {
        export: true,
        style: 'pie',
        period: { last: 24, unit: 'hour' },
        energy_flows: ['solar'],
      } as Partial<CardConfig>,
      hassWith().hass,
    );
    // One row: the pie's total for the flow, not the hourly readings that added up to it.
    expect((await csv(pie)).map((r) => r.split(',').slice(1).join(','))).toEqual(['sensor.solar,18,kWh']);
    vi.unstubAllGlobals();
  });

  it('sorts a pie by its totals', async () => {
    const { hass } = hassWith();
    const card = await mount(
      { style: 'pie', sort: 'descending', energy_flows: ['grid_import', 'solar'] } as Partial<CardConfig>,
      hass,
    );
    expect(qa(card, '.part-name')[0].textContent).toBe('Solar');
  });

  it('follows the day’s energy through the house in a Sankey', async () => {
    const { hass } = hassWith();
    const card = await mount({ style: 'sankey', period: { last: 24, unit: 'hour' } } as Partial<CardConfig>, hass);
    const flows = qa(card, '.flow').map((f) => f.querySelector('title')!.textContent!);
    expect(flows).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Solar to Home \d/),
        expect.stringMatching(/^Home to Grid export \d/),
        expect.stringMatching(/^Home to Kettle \d/),
        expect.stringMatching(/^Home to Untracked use \d/),
      ]),
    );
  });

  it('says while a pie’s totals load, and when they can’t', async () => {
    const { hass } = hassWith();
    const callWS = hass.callWS!;
    hass.callWS = vi.fn((msg: Record<string, unknown>) =>
      msg.type === 'recorder/statistics_during_period' ? new Promise(() => {}) : callWS(msg),
    ) as HomeAssistant['callWS'];
    const card = await mount({ style: 'pie' } as Partial<CardConfig>, hass);
    expect(card.shadowRoot!.querySelector('.chart-message')!.textContent).toBe('Loading history…');
    const failing = hassWith().hass;
    const ok = failing.callWS!;
    failing.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      if (msg.type === 'recorder/statistics_during_period') throw new Error('boom');
      return ok(msg);
    }) as HomeAssistant['callWS'];
    const failed = await mount({ style: 'sankey' } as Partial<CardConfig>, failing);
    const message = failed.shadowRoot!.querySelector('.chart-message')!;
    expect(message.textContent).toContain('boom');
    expect(message.classList.contains('error')).toBe(true);
  });

  it('draws a line of the chosen flows', async () => {
    const { hass, calls } = hassWith();
    const card = await mount({ style: 'line', energy_flows: ['solar'] } as Partial<CardConfig>, hass);
    expect(calls.find((c) => c.type === 'recorder/statistics_during_period')!.statistic_ids).toEqual(['sensor.solar']);
    expect(qa(card, 'path.line')).toHaveLength(1);
  });

  it('says when the settings are loading, unreadable, or empty', async () => {
    const empty = await mount({}, hassWith({ energy_sources: [] }).hass);
    expect(empty.shadowRoot!.querySelector('.hint')!.textContent).toBe(
      'The Energy dashboard has none of these flows set up yet.',
    );
    const failed = await mount({}, hassWith(new Error('Unknown command')).hass);
    expect(failed.shadowRoot!.querySelector('.hint')!.textContent).toBe(
      "Couldn't read the Energy dashboard settings: Unknown command",
    );
    const { hass } = hassWith();
    hass.callWS = vi.fn(() => new Promise(() => {})) as HomeAssistant['callWS'];
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'line', source: 'energy' } as CardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('.hint')!.textContent).toBe('Loading the Energy dashboard settings…');
  });

  it('refuses a style that cannot draw it', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() => card.setConfig({ type: 'x', style: 'radar', source: 'energy' } as CardConfig)).toThrow(/works with/);
  });
});

describe('energy in the editor', () => {
  const names = (schema: unknown[]): string[] =>
    schema.flatMap((s) => {
      const item = s as { name: string; schema?: unknown[] };
      return item.schema ? names(item.schema) : [item.name];
    });
  const sources = (schema: unknown[]) => {
    const field = schema.find((s) => (s as { name: string }).name === 'source') as {
      selector: { select: { options: { value: string }[] } };
    };
    return field.selector.select.options.map((o) => o.value);
  };

  async function form(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', entities: [], ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { events, form: ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('offers the Energy dashboard as a source on line, column and area only', async () => {
    for (const style of ['line', 'column', 'area']) {
      const { form: f } = await form({ style } as Partial<CardConfig>);
      expect(sources(f.schema as unknown[]), style).toEqual(['history', 'statistics', 'energy']);
      expect(names(f.schema as unknown[]), style).not.toContain('energy_flows');
    }
    const { form: f } = await form({ style: 'streamgraph' } as Partial<CardConfig>);
    expect(sources(f.schema as unknown[])).toEqual(['history', 'statistics']);
  });

  it('offers the split on column and area, not on a line', async () => {
    for (const style of ['column', 'area']) {
      const { form: f } = await form({ style, source: 'energy' } as Partial<CardConfig>);
      expect(names(f.schema as unknown[]), style).toContain('energy_split');
      expect((f.data as Record<string, unknown>).energy_split, style).toBe(true);
    }
    const { events, form: f } = await form({ style: 'column', source: 'energy' } as Partial<CardConfig>);
    f.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(f.data as object), energy_split: false } } }),
    );
    expect(events.at(-1)!.energy_split).toBe(false);
    const { form: line } = await form({ style: 'line', source: 'energy' } as Partial<CardConfig>);
    expect(names(line.schema as unknown[])).not.toContain('energy_split');
  });

  it('gives the pie and Sankey a source, then a span and flows for the Energy dashboard', async () => {
    for (const style of ['pie', 'sankey']) {
      const { events, form: f } = await form({ style } as Partial<CardConfig>);
      expect(sources(f.schema as unknown[]), style).toEqual(['current', 'energy']);
      expect(names(f.schema as unknown[]), style).not.toContain('energy_flows');
      expect((f.data as Record<string, unknown>).source).toBe('current');
      f.dispatchEvent(
        new CustomEvent('value-changed', { detail: { value: { ...(f.data as object), source: 'energy' } } }),
      );
      expect(events.at(-1), style).toMatchObject({ source: 'energy', period: { calendar: 'day' } });
    }
    const { events, form: pie } = await form({
      style: 'pie',
      source: 'energy',
      period: { calendar: 'day' },
    } as Partial<CardConfig>);
    const fields = names(pie.schema as unknown[]);
    expect(fields).toEqual(
      expect.arrayContaining(['period_calendar', 'period_until', 'period_offset', 'energy_flows']),
    );
    expect(fields).not.toContain('period_navigate');
    const flowOptions = (schema: unknown[]) =>
      (
        schema.find((s) => (s as { name: string }).name === 'energy_flows') as {
          selector: { select: { options: { value: string }[] } };
        }
      ).selector.select.options.map((o) => o.value);
    expect(flowOptions(pie.schema as unknown[])).toContain('gas');
    pie.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(pie.data as object), source: 'current' } } }),
    );
    expect(events.at(-1)!.source).toBeUndefined();
    const { form: sankey } = await form({ style: 'sankey', source: 'energy' } as Partial<CardConfig>);
    expect(names(sankey.schema as unknown[])).toContain('period_last');
    expect(flowOptions(sankey.schema as unknown[])).not.toContain('gas');
  });

  it('switches to it with hourly change, then picks the flows', async () => {
    const { events, form: f } = await form({ style: 'line' });
    f.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(f.data as object), source: 'energy' } } }),
    );
    expect(events.at(-1)).toMatchObject({ source: 'energy', group_by: 'hour', aggregate: 'change' });
    const { events: later, form: g } = await form({
      style: 'line',
      source: 'energy',
      group_by: 'hour',
    } as Partial<CardConfig>);
    expect(names(g.schema as unknown[])).toContain('energy_flows');
    g.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(g.data as object), energy_flows: ['solar', 'gas'] } },
      }),
    );
    expect(later.at(-1)!.energy_flows).toEqual(['solar', 'gas']);
  });
});

describe('an energy column chart on a real install', () => {
  // `recorder/statistics_during_period` for an imported meter on a test install (HA 2026.11):
  // daily change, with negative sums, then the meter flat at 12.5 kWh since 7 Nov.
  const DAY = 86_400_000;
  const DAILY: [day: number, change: number, sum: number][] = [
    [1, 13.83, -83.71],
    [2, 13.95, -69.76],
    [3, 14.18, -55.58],
    [4, 13.83, -41.75],
    [5, 13.76, -27.99],
    [6, 13.88, -14.11],
    [7, 14.11, 0],
    [8, 0, 0],
    [9, 0, 0],
  ];
  const at = (day: number) => Date.UTC(2026, 10, day);

  function realHass(locale: 'server' | 'local') {
    const hass = makeHass(
      {
        'sensor.dcp30_energy_kwh': [
          '12.5',
          { friendly_name: 'dcp30 energy kwh', unit_of_measurement: 'kWh', state_class: 'total_increasing' },
        ],
        'sensor.dcp30_energy_wh': [
          '12500',
          { friendly_name: 'dcp30 energy wh', unit_of_measurement: 'Wh', state_class: 'total_increasing' },
        ],
      },
      {
        config: { time_zone: 'Europe/London' },
        locale: { language: 'en', number_format: 'language', time_zone: locale },
      } as Partial<HomeAssistant>,
    );
    const asked: Record<string, unknown>[] = [];
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      if (msg.type === 'energy/get_prefs') {
        return {
          energy_sources: [
            { type: 'grid', stat_energy_from: 'sensor.dcp30_energy_kwh', stat_energy_to: null },
            { type: 'solar', stat_energy_from: 'sensor.dcp30_energy_wh' },
          ],
          device_consumption: [{ stat_consumption: 'sensor.dcp30_energy_kwh', name: 'Kettle' }],
        };
      }
      if (msg.type === 'recorder/get_statistics_metadata') return [];
      asked.push(msg);
      const from = Date.parse(msg.start_time as string);
      const to = Date.parse(msg.end_time as string);
      // Days as HA sends them, or each day's change spread over its hours (what it sends by the hour).
      const rows =
        msg.period === 'day'
          ? DAILY.map(([d, change, sum]) => ({ start: at(d), end: at(d) + DAY, change, sum }))
          : DAILY.flatMap(([d, change]) =>
              Array.from({ length: 24 }, (_, h) => ({
                start: at(d) + h * 3_600_000,
                end: at(d) + (h + 1) * 3_600_000,
                change: change / 24,
              })),
            );
      const inRange = rows.filter((r) => r.end > from && r.start < to);
      return {
        'sensor.dcp30_energy_kwh': inRange,
        'sensor.dcp30_energy_wh': inRange.map((r) => ({ ...r, change: 0 })),
      };
    }) as HomeAssistant['callWS'];
    return { hass, asked };
  }

  async function settle(card: Card) {
    for (let i = 0; i < 4; i++) {
      await card.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  for (const locale of ['server', 'local'] as const) {
    it(`draws each day's import as a column, and keeps them when masonry moves the card (${locale} time)`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
      const { hass, asked } = realHass(locale);
      const card = document.createElement('chartdeck-card') as Card;
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'column',
        source: 'energy',
        energy_flows: ['grid_import', 'solar'],
      } as CardConfig);
      card.hass = hass;
      document.body.appendChild(card);
      await settle(card);
      const root = card.shadowRoot!;
      expect(root.querySelector('.series-value')!.textContent).toBe('83.7 kWh');
      const heights = () =>
        [...root.querySelectorAll('.col[data-series="0"]')].map((c) =>
          Number(/height:([\d.]+)%/.exec(c.getAttribute('style')!)![1]),
        );
      // Mon 2 Nov to Mon 9 Nov on a 0–20 axis: each day's change, then the flat meter's nothing.
      const expected = [13.95, 14.18, 13.83, 13.76, 13.88, 14.11, 0, 0].map((v) => (v / 20) * 100);
      expect(heights()).toHaveLength(8);
      heights().forEach((h, i) => expect(h).toBeCloseTo(expected[i], 1));
      const drawn = root.querySelector('.col');
      // A masonry view moves its cards about as it lays them out: the card leaves the page and
      // comes straight back. Its statistics are read again, but what it drew stays drawn (the
      // same columns, so they don't grow in from nothing again) rather than "Loading…".
      card.remove();
      document.body.appendChild(card);
      await card.updateComplete;
      expect(root.querySelector('.chart-message')).toBeNull();
      expect(root.querySelector('.col')).toBe(drawn);
      await settle(card);
      expect(asked).toHaveLength(2);
      expect(root.querySelector('.col')).toBe(drawn);
      heights().forEach((h, i) => expect(h).toBeCloseTo(expected[i], 1));
    });
  }

  it('says nothing flowed in the period when the day’s totals are all zero, in a Sankey and a pie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    const { hass } = realHass('server');
    for (const style of ['sankey', 'pie']) {
      const card = document.createElement('chartdeck-card') as Card;
      // Today: the meter has stood still since 7 Nov.
      card.setConfig({
        type: 'custom:chartdeck-card',
        style,
        source: 'energy',
        period: { calendar: 'day' },
      } as CardConfig);
      card.hass = hass;
      document.body.appendChild(card);
      await settle(card);
      const text = card.shadowRoot!.querySelector('.chart-message')?.textContent?.trim();
      expect(text, style).toBe('Nothing flowed in this period.');
    }
  });
});
