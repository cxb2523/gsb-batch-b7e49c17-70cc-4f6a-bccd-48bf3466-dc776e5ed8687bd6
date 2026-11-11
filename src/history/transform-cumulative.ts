import { formatNumber, withUnit } from '../format';
import { languageOf, localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { EntityFields } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { increments } from './group';
import { addUnits, boundaries } from './timezone';
import type { Zone } from './timezone';
import type { Point, Range } from './types';

/*
 * Cumulative series (`transform: cumulative` on an entity): a history chart draws the running
 * total of the entity instead of its readings.
 *
 * - A meter (state_class total_increasing) adds up how much it went up, resets of the meter
 *   itself handled as in grouping's `change` (see `increments`). A `total` meter adds up its
 *   changes, falls included: a net meter can go down.
 * - Anything else (a power sensor, a flow rate) is integrated over time: value × hours. History
 *   records changes and a reading holds until the next one, so each reading counts for as long as
 *   it held (the left Riemann sum), the same weighting grouping's time-weighted mean uses. A
 *   power sensor in W gives Wh (kW gives kWh); set `unit: kWh` on a W sensor and the total is
 *   scaled to match.
 *
 * The total starts at zero at the chart's left edge and again at each `transform_reset`
 * boundary (day, week or month, in the card's time zone, or `billing`: midnight on day
 * `transform_reset_day` (1–28) of every month, for a supplier's billing period). A gap in the
 * readings is a gap in the line; a meter's total carries on across it.
 *
 * Charts that load history themselves get the same transform through `seriesTransform` in
 * chart/frame.ts: box plot, candlestick and the 24-hour clock's number rings. The climate chart
 * (a thermostat's attributes, drawn against its set point) and the wind rose (speeds sorted into
 * bands by direction) have no use for a running total and ignore it.
 */

/** Every per-entity transform. Both transform files list them all, so neither rejects the other's. */
export const TRANSFORMS = ['cumulative', 'derivative'] as const;
export const CUMULATIVE_RESETS = ['none', 'day', 'week', 'month', 'billing'] as const;
/** Billing days stop at 28, so every month has one. */
export const MAX_BILLING_DAY = 28;
export type CumulativeReset = (typeof CUMULATIVE_RESETS)[number];

/** Styles that read history through `historyFrame` as numbers, where a transform applies. */
export const CUMULATIVE_STYLES = [
  'line',
  'column',
  'area',
  'combined',
  'range_area',
  'sparkline',
  'trend',
  'streamgraph',
  'histogram',
  'violin',
  'beeswarm',
  'heatmap',
  'slope',
  'dumbbell',
  'waterfall',
  'scatter',
  'bubble',
  'box',
  'candlestick',
  'day_clock',
  'spiral',
  'strip_plot',
  'cycle_plot',
];

interface CumulativeConfig {
  transform?: string;
  transform_reset?: string;
  transform_reset_day?: unknown;
}

/** Check each entity's `transform` and `transform_reset`. Throws a readable error. */
export function validateCumulative(raw: CardConfig): void {
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object' || e === null) continue;
    const own = e as CumulativeConfig;
    if (own.transform !== undefined && !(TRANSFORMS as readonly string[]).includes(own.transform)) {
      throw new Error(`"transform" must be one of: ${TRANSFORMS.join(', ')}`);
    }
    if (own.transform_reset !== undefined && !(CUMULATIVE_RESETS as readonly string[]).includes(own.transform_reset)) {
      throw new Error(`"transform_reset" must be one of: ${CUMULATIVE_RESETS.join(', ')}`);
    }
    const day = own.transform_reset_day;
    if (day !== undefined && (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > MAX_BILLING_DAY)) {
      throw new Error(`"transform_reset_day" must be a whole number from 1 to ${MAX_BILLING_DAY}`);
    }
  }
}

/** How a meter adds up: by its rises (resets handled), by every change, or not a meter. */
export type MeterKind = 'increasing' | 'total' | undefined;

export function meterKind(entity: ResolvedEntity): MeterKind {
  if (entity.config.attribute) return undefined;
  const cls = entity.stateObj?.attributes?.state_class;
  return cls === 'total_increasing' ? 'increasing' : cls === 'total' ? 'total' : undefined;
}

/** Each reading's change from the one before (null at a gap, 0 for the first after one). */
function changes(points: Point[]): (number | null)[] {
  let prev: number | null = null;
  return points.map((p) => {
    if (p.v === null) return null;
    const step = prev === null ? 0 : p.v - prev;
    prev = p.v;
    return step;
  });
}

/**
 * Reset boundaries strictly inside the readings, ascending. `billing` is midnight on `day` of each
 * month (day 1 is the same as `month`), in the card's time zone.
 */
export function resetTimes(reset: CumulativeReset, first: number, until: number, zone: Zone, day = 1): number[] {
  if (reset === 'none' || until <= first) return [];
  const times =
    reset === 'billing'
      ? boundaries('month', first, until, zone).map((m) => (day > 1 ? addUnits('day', m, day - 1, zone) : m))
      : boundaries(reset, first, until, zone);
  return times.filter((b) => b > first && b <= until);
}

/**
 * A meter's running total: what it added since the first reading, back to zero at each of
 * `resets`. A rise is counted at the reading that shows it, as grouping's `change` does.
 * What a meter rose across a gap counts (it kept counting while unavailable), except when the
 * reading after the gap is `carried`: a series shown only while a condition holds (`when`)
 * restarts with the value in force at that moment, and what the meter added while the condition
 * didn't hold is not part of its total.
 */
export function meterTotal(points: Point[], resets: number[], kind: 'increasing' | 'total'): Point[] {
  const steps = kind === 'increasing' ? increments(points) : changes(points);
  const out: Point[] = [];
  let total = 0;
  let r = 0;
  points.forEach((p, i) => {
    while (r < resets.length && resets[r] <= p.t) {
      out.push({ t: resets[r], v: total }, { t: resets[r], v: 0 });
      total = 0;
      r++;
    }
    const restart = p.carried === true && i > 0 && points[i - 1].v === null;
    const step = restart && steps[i] !== null ? 0 : steps[i];
    if (step === null) {
      out.push({ t: p.t, v: null });
      return;
    }
    total += step;
    out.push({ t: p.t, v: total });
  });
  return out;
}

const HOUR = 3_600_000;

/**
 * The time integral of readings in value × hours, from the first reading. Each reading holds
 * until the next (the left Riemann sum); a gap adds nothing. `end` is where the last reading
 * stops counting (now, for a sensor still holding it). Back to zero at each of `resets`.
 */
export function integral(points: Point[], resets: number[], end: number): Point[] {
  const out: Point[] = [];
  let total = 0;
  let r = 0;
  let held: number | null = null;
  let from = points[0]?.t ?? end;
  const accrue = (to: number) => {
    if (held !== null && to > from) total += (held * (to - from)) / HOUR;
    from = Math.max(from, to);
  };
  const reach = (t: number) => {
    while (r < resets.length && resets[r] <= t) {
      accrue(resets[r]);
      out.push({ t: resets[r], v: held === null ? null : total }, { t: resets[r], v: held === null ? null : 0 });
      total = 0;
      r++;
    }
    accrue(t);
  };
  for (const p of points) {
    reach(p.t);
    held = p.v;
    out.push({ t: p.t, v: p.v === null ? null : total });
  }
  const last = points[points.length - 1];
  if (last && end > last.t) {
    reach(end);
    if (held !== null) out.push({ t: end, v: total });
  }
  return out;
}

const POWER: Record<string, number> = { W: 1, kW: 1e3, MW: 1e6 };
const ENERGY: Record<string, number> = { Wh: 1, kWh: 1e3, MWh: 1e6 };

/**
 * The unit of a time integral, and the factor its numbers need. A power in W, kW or MW gives
 * Wh, kWh or MWh. When the card's `unit` already names an energy unit and the sensor reports a
 * power, the total is scaled to it (a W sensor with `unit: kWh` divides by 1000). Any other unit
 * gets "·h"; none stays none.
 */
export function integralUnit(display: string, sensor: string | undefined): { unit: string; factor: number } {
  if (POWER[display] !== undefined) return { unit: `${display}h`, factor: 1 };
  if (ENERGY[display] !== undefined && sensor !== undefined && POWER[sensor] !== undefined) {
    return { unit: display, factor: POWER[sensor] / ENERGY[display] };
  }
  return { unit: display ? `${display}·h` : '', factor: 1 };
}

/** The entity with its value, text and unit read from the last number of a transformed series. */
export function withLatest(entity: ResolvedEntity, points: Point[], unit: string, hass: HomeAssistant): ResolvedEntity {
  let latest: number | null = null;
  for (let i = points.length - 1; i >= 0 && latest === null; i--) latest = points[i].v;
  if (latest === null) return { ...entity, unit };
  const valueText = formatNumber(latest, entity.decimals, hass);
  const display = withUnit(valueText, unit);
  return { ...entity, unit, value: latest, valueText, display, label: `${entity.name}, ${display}` };
}

/**
 * A history series as its running total, when its entity asks for one (`transform: cumulative`);
 * any other series comes back as it was. `until` is now (or the span's end, if earlier): a sensor
 * still holding its last reading keeps adding up to it.
 */
export function cumulativeSeries(
  entity: ResolvedEntity,
  points: Point[],
  range: Range,
  until: number,
  zone: Zone,
  hass: HomeAssistant,
): { entity: ResolvedEntity; points: Point[] } {
  const own = entity.config as CumulativeConfig;
  if (own.transform !== 'cumulative' || points.length === 0) return { entity, points };
  const reset = (own.transform_reset as CumulativeReset | undefined) ?? 'none';
  const day = typeof own.transform_reset_day === 'number' ? own.transform_reset_day : 1;
  const plain = points.map((p): Point => (p.carried ? { t: p.t, v: p.v, carried: true } : { t: p.t, v: p.v }));
  const resets = resetTimes(reset, plain[0].t, until, zone, day);
  const kind = meterKind(entity);
  if (kind) {
    const total = meterTotal(plain, resets, kind);
    return { entity: withLatest(entity, total, entity.unit, hass), points: total };
  }
  const sensorUnit = entity.stateObj?.attributes?.unit_of_measurement;
  const { unit, factor } = integralUnit(entity.unit, typeof sensorUnit === 'string' ? sensorUnit : undefined);
  let total = integral(plain, resets, Math.max(until, range.start));
  if (factor !== 1) total = total.map((p) => (p.v === null ? p : { t: p.t, v: p.v * factor }));
  return { entity: withLatest(entity, total, unit, hass), points: total };
}

/** Any entity in the card asks for a running total, so its reset field is worth showing. */
function anyCumulative(config: CardConfig): boolean {
  return (config.entities ?? []).some(
    (e) => typeof e === 'object' && (e as CumulativeConfig).transform === 'cumulative',
  );
}

/** Any running total starts again on a billing day, so the day field is worth showing. */
function anyBilling(config: CardConfig): boolean {
  return (config.entities ?? []).some(
    (e) =>
      typeof e === 'object' &&
      (e as CumulativeConfig).transform === 'cumulative' &&
      (e as CumulativeConfig).transform_reset === 'billing',
  );
}

/** The `transform` dropdown's field, found by where it writes, whichever transform added it. */
const isTransform = (f: { path: string[] }) => f.path.length === 1 && f.path[0] === 'transform';

interface SelectField {
  name: string;
  selector: { select: { mode: string; options: { value: string; label: string }[] } };
}

/** Built once per base schema, base fields, language and switches, so ha-form keeps its schema. */
const fieldCache = new WeakMap<object, WeakMap<object, Map<string, EntityFields>>>();
const EMPTY: EntityFields = { schema: [], fields: [] };

/**
 * A history chart's per-entity fields with the running-total ones added: "Running total" in the
 * transform dropdown (made here if no other transform made it first), and the reset dropdown
 * while any entity uses it. Other styles' fields come back as they were.
 */
export function withCumulativeFields(
  style: string,
  hass: HomeAssistant | undefined,
  config: CardConfig,
  base: EntityFields | undefined,
): EntityFields | undefined {
  if (!CUMULATIVE_STYLES.includes(style)) return base;
  const from = base ?? EMPTY;
  const shown = anyCumulative(config);
  const billing = shown && anyBilling(config);
  const key = `${languageOf(hass)}|${shown}|${billing}`;
  let bySchema = fieldCache.get(from.schema);
  if (!bySchema) {
    bySchema = new WeakMap();
    fieldCache.set(from.schema, bySchema);
  }
  let byKey = bySchema.get(from.fields);
  if (!byKey) {
    byKey = new Map();
    bySchema.set(from.fields, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  const t = (k: string) => localize(hass, k);
  const option = { value: 'cumulative', label: t('editor_cumulative_transform_cumulative') };
  const existing = from.fields.find(isTransform);
  let schema: unknown[];
  let fields = from.fields;
  if (existing) {
    schema = from.schema.map((s) => {
      const field = s as SelectField;
      if (field.name !== existing.name) return s;
      return {
        ...field,
        selector: { select: { ...field.selector.select, options: [...field.selector.select.options, option] } },
      };
    });
  } else {
    const select: SelectField = {
      name: 'cumulative_transform',
      selector: {
        select: {
          mode: 'dropdown',
          options: [{ value: 'none', label: t('editor_cumulative_transform_none') }, option],
        },
      },
    };
    schema = [...from.schema, select];
    fields = [...fields, { name: 'cumulative_transform', path: ['transform'], default: 'none' }];
  }
  if (shown) {
    schema = [
      ...schema,
      {
        name: 'cumulative_reset',
        selector: {
          select: {
            mode: 'dropdown',
            options: CUMULATIVE_RESETS.map((value) => ({ value, label: t(`editor_cumulative_reset_${value}`) })),
          },
        },
      },
    ];
    fields = [...fields, { name: 'cumulative_reset', path: ['transform_reset'], default: 'none' }];
  }
  if (billing) {
    schema = [
      ...schema,
      { name: 'cumulative_billing_day', selector: { number: { min: 1, max: MAX_BILLING_DAY, step: 1, mode: 'box' } } },
    ];
    fields = [...fields, { name: 'cumulative_billing_day', path: ['transform_reset_day'], default: 1 }];
  }
  const out = { schema, fields };
  byKey.set(key, out);
  return out;
}
