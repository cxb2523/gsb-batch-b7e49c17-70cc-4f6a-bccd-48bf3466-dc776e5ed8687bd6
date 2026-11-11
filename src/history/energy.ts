import { normalizeConfig } from '../config';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ActionConfig, CardConfig, EntityConfig, HomeAssistant, NormalizedConfig, StyleName } from '../types';
import type { Grouping } from './group';
import type { Point } from './types';

/*
 * `source: energy` draws what Home Assistant's Energy dashboard is set up with, without listing
 * entities. The card asks once for the dashboard's settings (`energy/get_prefs`), picks the
 * statistic of each flow it wants (grid import and export, solar, battery out and in, gas, water,
 * each device), and draws those as long-term statistics: by default the hourly change, which is
 * what the Energy dashboard's own charts show. Statistic ids that aren't entities (an
 * integration's external statistics, or a meter whose entity is gone) still load; they take their
 * name and unit from the statistic's metadata and are never shown as a missing entity.
 *
 * Column and area charts draw the energy that leaves the house (grid export, battery charging)
 * below the axis unless `energy_split: false`. Pie and Sankey draw each flow's total over the
 * card's period (see energy-totals.ts).
 */

export const ENERGY_FLOWS = [
  'grid_import',
  'grid_export',
  'solar',
  'battery_out',
  'battery_in',
  'gas',
  'water',
  'devices',
] as const;
export type EnergyFlow = (typeof ENERGY_FLOWS)[number];

/** Flows drawn when the card doesn't list its own: the electricity ones, which share a unit. */
export const DEFAULT_ENERGY_FLOWS: EnergyFlow[] = ['grid_import', 'grid_export', 'solar', 'battery_out', 'battery_in'];

/** Styles that draw the Energy dashboard over time, as long-term statistics. */
export const ENERGY_TIME_STYLES: StyleName[] = ['line', 'column', 'area'];
/** Styles that draw each flow's total over the card's period. */
export const ENERGY_TOTAL_STYLES: StyleName[] = ['pie', 'sankey'];
/** Styles that can draw the Energy dashboard. */
export const ENERGY_STYLES: StyleName[] = [...ENERGY_TIME_STYLES, ...ENERGY_TOTAL_STYLES];
/** Styles that draw energy leaving the house below the axis (`energy_split`). */
export const ENERGY_SPLIT_STYLES: StyleName[] = ['column', 'area'];

/** Energy that leaves the house: drawn below the axis on a split chart. */
export const OUT_FLOWS: EnergyFlow[] = ['grid_export', 'battery_in'];
/** Flows measured in electricity, so in kWh when the statistic doesn't say. */
const ELECTRIC_FLOWS: EnergyFlow[] = ['grid_import', 'grid_export', 'solar', 'battery_out', 'battery_in', 'devices'];
/** A Sankey runs through the house's electricity: gas and water have no place in it. */
export const SANKEY_FLOWS: EnergyFlow[] = ELECTRIC_FLOWS;

/** The flows a style draws when the card lists none. */
export function defaultFlows(style: StyleName | undefined): EnergyFlow[] {
  // A pie shares out where the energy came from; a Sankey follows it to the devices.
  if (style === 'pie') return ['grid_import', 'solar', 'battery_out'];
  if (style === 'sankey') return [...DEFAULT_ENERGY_FLOWS, 'devices'];
  return DEFAULT_ENERGY_FLOWS;
}

/** What the card adds to each entity it makes from the Energy dashboard. */
export interface EnergyMarks {
  /** The flow this series is. */
  energy_flow?: EnergyFlow;
  /** A long-term statistic with no entity: no state, no more-info. */
  statistic?: boolean;
  /** Draw this series below the axis (energy leaving the house on a split chart). */
  energy_below?: boolean;
}

const marks = (e: { config: unknown }) => e.config as EnergyMarks;

/** Home Assistant's own colours for each flow (its theme can change them), with its defaults. */
const FLOW_COLORS: Record<EnergyFlow, string> = {
  grid_import: 'var(--energy-grid-consumption-color, #488fc2)',
  grid_export: 'var(--energy-grid-return-color, #8353d1)',
  solar: 'var(--energy-solar-color, #ff9800)',
  battery_out: 'var(--energy-battery-out-color, #4db6ac)',
  battery_in: 'var(--energy-battery-in-color, #f06292)',
  gas: 'var(--energy-gas-color, #8e021b)',
  water: 'var(--energy-water-color, #00bcd4)',
  devices: '',
};

/** The parts of the Energy dashboard's settings this reads (older and newer grid layouts both). */
interface GridFlow {
  stat_energy_from?: string | null;
  stat_energy_to?: string | null;
}
interface EnergySource extends GridFlow {
  type?: string;
  flow_from?: GridFlow[];
  flow_to?: GridFlow[];
}
export interface EnergyPrefs {
  energy_sources?: EnergySource[];
  device_consumption?: { stat_consumption?: string | null; name?: string | null }[];
}

/** What `recorder/get_statistics_metadata` says of a statistic: its name and unit. */
export interface StatisticMeta {
  name?: string | null;
  unit?: string | null;
}
export type StatisticsMeta = Record<string, StatisticMeta>;

/** One statistic to draw: its id, which flow it is, and a name when the settings give one. */
export interface EnergyStatistic {
  id: string;
  flow: EnergyFlow;
  name?: string;
}

export function validateEnergy(raw: CardConfig): void {
  if (raw.source !== 'energy') {
    for (const key of ['energy_flows', 'energy_split']) {
      if (raw[key] !== undefined) throw new Error(`"${key}" needs "source: energy"`);
    }
    return;
  }
  const style = (raw.style ?? 'bar') as StyleName;
  if (!ENERGY_STYLES.includes(style)) {
    throw new Error(`"source: energy" works with these styles: ${ENERGY_STYLES.join(', ')}`);
  }
  if (raw.energy_split !== undefined && typeof raw.energy_split !== 'boolean') {
    throw new Error('"energy_split" must be true or false');
  }
  const flows = raw.energy_flows;
  if (flows === undefined) return;
  if (!Array.isArray(flows) || flows.some((f) => !ENERGY_FLOWS.includes(f as EnergyFlow))) {
    throw new Error(`"energy_flows" must be a list of: ${ENERGY_FLOWS.join(', ')}`);
  }
  if (style === 'sankey' && flows.some((f) => !SANKEY_FLOWS.includes(f as EnergyFlow))) {
    throw new Error(`"energy_flows" on a Sankey must be a list of: ${SANKEY_FLOWS.join(', ')}`);
  }
}

/** The config a chart style checks: the Energy dashboard read as long-term statistics. */
export function energyChecked(raw: CardConfig): CardConfig {
  validateEnergy(raw);
  return raw.source === 'energy' ? { ...raw, source: 'statistics' } : raw;
}

/** Every statistic of the wanted flows, in the order of `flows`, each id once. */
export function energyStatistics(prefs: EnergyPrefs, flows: readonly EnergyFlow[]): EnergyStatistic[] {
  const found: Record<EnergyFlow, EnergyStatistic[]> = {
    grid_import: [],
    grid_export: [],
    solar: [],
    battery_out: [],
    battery_in: [],
    gas: [],
    water: [],
    devices: [],
  };
  const add = (flow: EnergyFlow, id: string | null | undefined, name?: string | null) => {
    if (typeof id === 'string' && id !== '') found[flow].push({ id, flow, ...(name ? { name } : {}) });
  };
  for (const source of prefs.energy_sources ?? []) {
    switch (source.type) {
      case 'grid':
        for (const f of source.flow_from ?? []) add('grid_import', f.stat_energy_from);
        for (const f of source.flow_to ?? []) add('grid_export', f.stat_energy_to);
        add('grid_import', source.stat_energy_from);
        add('grid_export', source.stat_energy_to);
        break;
      case 'solar':
        add('solar', source.stat_energy_from);
        break;
      case 'battery':
        add('battery_out', source.stat_energy_from);
        add('battery_in', source.stat_energy_to);
        break;
      case 'gas':
        add('gas', source.stat_energy_from);
        break;
      case 'water':
        add('water', source.stat_energy_from);
        break;
    }
  }
  for (const d of prefs.device_consumption ?? []) add('devices', d.stat_consumption, d.name);
  const seen = new Set<string>();
  return flows
    .flatMap((flow) => found[flow])
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
}

const NO_ACTION: ActionConfig = { action: 'none' };

/**
 * The card's entities for these statistics. A flow with one statistic is named after the flow
 * ("Solar"); several (two arrays, two tariffs) and devices keep their own names: the Energy
 * settings' device name, the entity's, else the statistic's. A statistic that is no entity takes
 * its unit from its metadata (electricity flows read kWh when that says nothing) and does nothing
 * when tapped, since there is no entity to open. `below` marks energy leaving the house.
 */
export function energyEntities(
  stats: EnergyStatistic[],
  hass: HomeAssistant | undefined,
  meta: StatisticsMeta = {},
  below = false,
): EntityConfig[] {
  const per = new Map<EnergyFlow, number>();
  for (const s of stats) per.set(s.flow, (per.get(s.flow) ?? 0) + 1);
  return stats.map((s) => {
    const state = hass?.states[s.id];
    const info = meta[s.id];
    const own = s.name ?? (state?.attributes?.friendly_name as string | undefined) ?? (info?.name || undefined);
    const flowName = localize(hass, `energy_flow_${s.flow}`);
    const name = s.flow === 'devices' || (per.get(s.flow) ?? 0) > 1 ? (own ?? flowName) : flowName;
    const entity: EntityConfig & EnergyMarks = { entity: s.id, name, energy_flow: s.flow };
    if (FLOW_COLORS[s.flow]) entity.color = FLOW_COLORS[s.flow];
    if (!state) {
      entity.statistic = true;
      const unit = info?.unit || (ELECTRIC_FLOWS.includes(s.flow) ? 'kWh' : undefined);
      if (unit) entity.unit = unit;
      entity.tap_action = NO_ACTION;
      entity.hold_action = NO_ACTION;
      entity.double_tap_action = NO_ACTION;
    }
    if (below && OUT_FLOWS.includes(s.flow)) entity.energy_below = true;
    return entity;
  });
}

/**
 * The card config to draw from: the dashboard's statistics first, then any entities the card
 * lists itself. Over time, unless the card says otherwise, it reads each hour's change (as the
 * Energy dashboard does); a column or area chart puts export and charging below the axis.
 */
export function energyCardRaw(
  raw: CardConfig,
  prefs: EnergyPrefs,
  hass: HomeAssistant | undefined,
  meta: StatisticsMeta = {},
): CardConfig {
  const style = raw.style as StyleName | undefined;
  const flows = (raw.energy_flows as EnergyFlow[] | undefined) ?? defaultFlows(style);
  const below = ENERGY_SPLIT_STYLES.includes(style as StyleName) && raw.energy_split !== false;
  const entities = [...energyEntities(energyStatistics(prefs, flows), hass, meta, below), ...(raw.entities ?? [])];
  const out: CardConfig = { ...raw, entities, source: 'statistics' };
  // Totals are read by the pie and Sankey themselves (energy-totals.ts).
  if (ENERGY_TOTAL_STYLES.includes(style as StyleName)) return out;
  // The column chart picks its own grouping for the span; the others read hours.
  out.group_by = raw.group_by ?? (style === 'column' ? undefined : 'hour');
  out.aggregate = raw.aggregate === undefined || raw.aggregate === 'auto' ? 'change' : raw.aggregate;
  if (out.group_by === undefined) delete out.group_by;
  return out;
}

/** Points turned over, for a series drawn below the axis (its lowest becomes its highest). */
export function belowAxis(points: Point[]): Point[] {
  return points.map((p) => {
    const out: Point = { ...p, v: p.v === null ? null : -p.v };
    if (p.min !== undefined) out.max = p.min === null ? null : -p.min;
    if (p.max !== undefined) out.min = p.max === null ? null : -p.max;
    return out;
  });
}

/** A value as it reads in a tooltip or label: energy drawn below the axis still reads positive. */
export function shownValue(entity: { config: unknown }, v: number): number {
  return marks(entity).energy_below ? -v : v;
}

/**
 * Whether a pie's or Sankey's entities are Energy dashboard totals over the card's period, so an
 * empty chart says nothing flowed in that period rather than "right now".
 */
export function isEnergyTotals(items: readonly { config: unknown }[]): boolean {
  return items.some((e) => marks(e).energy_flow !== undefined);
}

/** Whether this entity is a long-term statistic with no entity behind it (never "not found"). */
export function isStatistic(entity: { config: unknown }): boolean {
  return marks(entity).statistic === true;
}

/**
 * The header value of an energy series: its total over the span when the chart reads each
 * group's change (or sum), positive even when drawn below the axis; '' with no readings. A
 * statistic that is no entity shows nothing otherwise (it has no current value). Undefined for
 * any other series, which shows its current value as usual.
 */
export function energyValueText(
  entity: ResolvedEntity,
  points: readonly Point[],
  group: Grouping | undefined,
  hass: HomeAssistant | undefined,
): string | undefined {
  if (!marks(entity).energy_flow) return undefined;
  if (group?.aggregate !== 'change' && group?.aggregate !== 'sum') return isStatistic(entity) ? '' : undefined;
  const total = periodTotal(points);
  if (total === null) return '';
  return withUnit(formatNumber(shownValue(entity, total), entity.decimals, hass), entity.unit);
}

/** The sum of the readings, or null when there are none. */
export function periodTotal(points: readonly Point[]): number | null {
  let sum: number | null = null;
  for (const p of points) if (p.v !== null) sum = (sum ?? 0) + p.v;
  return sum;
}

/**
 * Options the editor sets alongside choosing the Energy dashboard, so what it shows is what
 * draws: over time, grouped by hour, each hour's change; a pie or Sankey, today. Switching away
 * drops the energy options. Returns `next` unchanged otherwise.
 */
export function withEnergyDefaults(previous: CardConfig, next: CardConfig): CardConfig {
  if (next.source !== 'energy') {
    // Leaving the Energy dashboard: its own options would only make the card refuse the config.
    if (previous.source !== 'energy' || (next.energy_flows === undefined && next.energy_split === undefined)) {
      return next;
    }
    const out = { ...next };
    delete out.energy_flows;
    delete out.energy_split;
    return out;
  }
  if (previous.source === 'energy') return next;
  // A pie or Sankey of today's totals, as the Energy dashboard opens on.
  if (ENERGY_TOTAL_STYLES.includes(next.style as StyleName)) {
    return next.period === undefined ? { ...next, period: { calendar: 'day' } } : next;
  }
  const out: CardConfig = { ...next, aggregate: 'change' };
  if (next.style !== 'column' && (next.group_by === undefined || next.group_by === 'none')) out.group_by = 'hour';
  return out;
}

type PrefsState =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; prefs: EnergyPrefs; meta: StatisticsMeta; at: number }
  | { status: 'error'; error: string; at: number };

/** Read again after this long, so a change on the Energy settings page shows without a reload. */
export const PREFS_REFRESH_MS = 30 * 60_000;
/** After a failure, try again this soon. */
const PREFS_RETRY_MS = 60_000;

/** One read of the settings for the page, keyed by the connection's `callWS`. */
const prefsCache = new WeakMap<object, PrefsState>();
const waiting = new WeakMap<object, Set<() => void>>();

/** Forget every loaded setting (tests). */
export function resetEnergyPrefs(hass: HomeAssistant): void {
  if (hass.callWS) prefsCache.delete(hass.callWS);
}

export type PrefsResult =
  | { status: 'loading' }
  | { status: 'ready'; prefs: EnergyPrefs; meta: StatisticsMeta }
  | { status: 'error'; error: string };

interface MetadataRow {
  statistic_id: string;
  name?: string | null;
  statistics_unit_of_measurement?: string | null;
}

/**
 * Every statistic's name and unit, for those that are no entity. Missing metadata is no error:
 * the flow's own name and unit stand in.
 */
async function loadMeta(callWS: NonNullable<HomeAssistant['callWS']>, prefs: EnergyPrefs): Promise<StatisticsMeta> {
  const ids = energyStatistics(prefs, ENERGY_FLOWS).map((s) => s.id);
  if (!ids.length) return {};
  try {
    const rows = await callWS<MetadataRow[]>({ type: 'recorder/get_statistics_metadata', statistic_ids: ids });
    const meta: StatisticsMeta = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.statistic_id) meta[row.statistic_id] = { name: row.name, unit: row.statistics_unit_of_measurement };
    }
    return meta;
  } catch {
    return {};
  }
}

/**
 * The Energy dashboard's settings and its statistics' metadata: as loaded, or loading (and
 * `onChange` is called once they arrive). Every card on the page shares one request.
 */
export function energyPrefs(hass: HomeAssistant, onChange: () => void, now = Date.now()): PrefsResult {
  const callWS = hass.callWS;
  if (!callWS) return { status: 'error', error: 'no connection' };
  const cached = prefsCache.get(callWS);
  const listeners = waiting.get(callWS) ?? new Set();
  waiting.set(callWS, listeners);
  const stale =
    cached &&
    ((cached.status === 'ready' && now - cached.at > PREFS_REFRESH_MS) ||
      (cached.status === 'error' && now - cached.at > PREFS_RETRY_MS));
  if (!cached || stale) {
    listeners.add(onChange);
    const promise = callWS<EnergyPrefs>({ type: 'energy/get_prefs' })
      .then(async (loaded) => {
        const prefs = loaded ?? {};
        const meta = await loadMeta(callWS, prefs);
        prefsCache.set(callWS, { status: 'ready', prefs, meta, at: Date.now() });
      })
      .catch((err: unknown) => {
        const error = (err as { message?: string })?.message ?? String(err);
        prefsCache.set(callWS, { status: 'error', error, at: Date.now() });
      })
      .then(() => {
        const call = [...listeners];
        listeners.clear();
        for (const fn of call) fn();
      });
    // A stale read keeps drawing what it had while the new one loads.
    if (cached?.status === 'ready') {
      prefsCache.set(callWS, { ...cached, at: now });
      return { status: 'ready', prefs: cached.prefs, meta: cached.meta };
    }
    prefsCache.set(callWS, { status: 'loading', promise });
    return { status: 'loading' };
  }
  if (cached.status === 'loading') {
    listeners.add(onChange);
    return { status: 'loading' };
  }
  return cached.status === 'ready'
    ? { status: 'ready', prefs: cached.prefs, meta: cached.meta }
    : { status: 'error', error: cached.error };
}

/**
 * The normalized config a card with `source: energy` draws from, or a message to show instead
 * (still loading, couldn't load, nothing set up). Any other card's config comes back as it was.
 * `totals` says the chart draws each flow's total over the period (pie, Sankey).
 */
export function energyConfig(
  config: NormalizedConfig,
  hass: HomeAssistant | undefined,
  onChange: () => void,
): { config: NormalizedConfig; message?: string; totals?: boolean } {
  const raw = config.cardOptions as CardConfig;
  if (raw.source !== 'energy' || !hass) return { config };
  const loaded = energyPrefs(hass, onChange);
  if (loaded.status === 'loading') return { config, message: localize(hass, 'energy_loading') };
  if (loaded.status === 'error') return { config, message: localize(hass, 'energy_error', { error: loaded.error }) };
  const drawn = normalizeConfig(energyCardRaw(raw, loaded.prefs, hass, loaded.meta));
  if (drawn.entities.length === 0) return { config, message: localize(hass, 'energy_none') };
  return ENERGY_TOTAL_STYLES.includes(drawn.style) ? { config: drawn, totals: true } : { config: drawn };
}
