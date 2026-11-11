import { formatNumber, withUnit } from '../format';
import { languageOf, localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { EntityFields } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import type { Point } from './types';

/*
 * Derivative series (`transform: derivative` on an entity): a history chart draws how fast the
 * entity changes instead of its readings. Watts from an energy meter, °C per hour from a
 * thermometer, litres per minute from a water meter.
 *
 * Each reading after the first gives the rate over the time since the one before:
 * (v₁ − v₀) ÷ (t₁ − t₀), in the entity's unit per `transform_unit_time` (s, min, h or d; h by
 * default), drawn at the later reading as Home Assistant's derivative helper does. Then:
 *
 * - A meter that only counts up (state_class total_increasing) falling is a reset, not a negative
 *   rate: that step is dropped and the next one is measured from the new reading.
 * - The first reading after a gap, and the reading carried in from before the span (its real time
 *   is earlier than the left edge, so the time since it is unknown), start a new run: no rate.
 * - A series that held one value all span (history then has only the reading carried in to its
 *   start, so no step to measure) changed at a rate of 0: it is drawn at 0 from that reading to
 *   now. A series with no reading at all stays empty ("No readings").
 * - `transform_smoothing: n` averages each rate with the n − 1 before it in the same run.
 * - `transform_smoothing_time: 15min` (a number and s, min, h or d) averages over a trailing time
 *   window instead, each rate weighted by how much of the window it covers: for a meter that is
 *   how much it went up in the last 15 minutes, per unit time. It suits sensors that report at
 *   uneven intervals, where a count of readings is a different stretch of time each time. When
 *   both are set, the time window is used.
 *
 * Energy over time reads as power: Wh/h is W, kWh/h kW, MWh/h MW.
 *
 * Charts that load history themselves get the same transform through `seriesTransform` in
 * chart/frame.ts: box plot, candlestick and the 24-hour clock's number rings. The climate chart
 * (a thermostat's attributes, drawn against its set point) and the wind rose (speeds sorted into
 * bands by direction) have no use for a rate of change and ignore it.
 */

/** Every per-entity transform. Both transform files list them all, so neither rejects the other's. */
export const TRANSFORMS = ['cumulative', 'derivative'] as const;
export const DERIVATIVE_UNIT_TIMES = ['s', 'min', 'h', 'd'] as const;
export type DerivativeUnitTime = (typeof DERIVATIVE_UNIT_TIMES)[number];
const UNIT_MS: Record<DerivativeUnitTime, number> = { s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 };
export const MAX_SMOOTHING = 100;
/** The longest smoothing window: a week. */
const MAX_SMOOTHING_MS = 7 * 86_400_000;

/** Styles that read history through `historyFrame` as numbers, where a transform applies. */
export const DERIVATIVE_STYLES = [
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

interface DerivativeConfig {
  transform?: string;
  transform_unit_time?: string;
  transform_smoothing?: unknown;
  transform_smoothing_time?: unknown;
}

const DURATION = /^\s*(\d+(?:\.\d+)?)\s*(s|min|h|d)\s*$/;

/** A smoothing window as written ("15min", "1h", "90s", "1d") in ms; undefined when it isn't one. */
export function parseWindow(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = DURATION.exec(v);
  if (!m) return undefined;
  const ms = Number(m[1]) * UNIT_MS[m[2] as DerivativeUnitTime];
  return ms > 0 && ms <= MAX_SMOOTHING_MS ? ms : undefined;
}

/** Check each entity's `transform`, `transform_unit_time` and `transform_smoothing`. Throws a readable error. */
export function validateDerivative(raw: CardConfig): void {
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object' || e === null) continue;
    const own = e as DerivativeConfig;
    if (own.transform !== undefined && !(TRANSFORMS as readonly string[]).includes(own.transform)) {
      throw new Error(`"transform" must be one of: ${TRANSFORMS.join(', ')}`);
    }
    if (
      own.transform_unit_time !== undefined &&
      !(DERIVATIVE_UNIT_TIMES as readonly string[]).includes(own.transform_unit_time)
    ) {
      throw new Error(`"transform_unit_time" must be one of: ${DERIVATIVE_UNIT_TIMES.join(', ')}`);
    }
    const n = own.transform_smoothing;
    if (n !== undefined && (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_SMOOTHING)) {
      throw new Error(`"transform_smoothing" must be a whole number from 1 to ${MAX_SMOOTHING}`);
    }
    const w = own.transform_smoothing_time;
    if (w !== undefined && w !== '' && parseWindow(w) === undefined) {
      throw new Error('"transform_smoothing_time" must be a time up to 7 days, like 90s, 15min, 1h or 1d');
    }
  }
}

/** One measured step: the rate `r` held from `a` to `b`. */
interface Step {
  a: number;
  b: number;
  r: number;
}

/** The time-weighted mean rate over the `windowMs` before `t`, from the run's steps (oldest dropped as they leave). */
function windowMean(steps: Step[], t: number, windowMs: number): number {
  const from = t - windowMs;
  while (steps.length > 1 && steps[0].b <= from) steps.shift();
  let sum = 0;
  let span = 0;
  for (const s of steps) {
    const covered = s.b - Math.max(s.a, from);
    if (covered <= 0) continue;
    sum += s.r * covered;
    span += covered;
  }
  return span > 0 ? sum / span : steps[steps.length - 1].r;
}

/**
 * The rate of change between readings, per `unitMs`, at the later reading. `increasing` drops a
 * fall (a meter reset). A gap stays a gap; the reading after it, and one carried in from before
 * the span, only start a new run. `smoothing` averages each rate with those before it in its run;
 * `windowMs`, when set, averages over that much time instead (each rate weighted by the time it
 * covers in the window).
 */
export function rates(points: Point[], unitMs: number, increasing = false, smoothing = 1, windowMs = 0): Point[] {
  const out: Point[] = [];
  let prev: Point | undefined;
  let run: number[] = [];
  let steps: Step[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (out.length && out[out.length - 1].v !== null) out.push({ t: p.t, v: null });
      prev = undefined;
      run = [];
      steps = [];
      continue;
    }
    if (prev === undefined || prev.carried || p.t <= prev.t) {
      prev = p;
      continue;
    }
    if (increasing && p.v < (prev.v as number)) {
      prev = p;
      continue;
    }
    const rate = ((p.v - (prev.v as number)) * unitMs) / (p.t - prev.t);
    if (windowMs > 0) {
      steps.push({ a: prev.t, b: p.t, r: rate });
      out.push({ t: p.t, v: windowMean(steps, p.t, windowMs) });
    } else {
      run.push(rate);
      if (run.length > smoothing) run.shift();
      out.push({ t: p.t, v: run.reduce((a, b) => a + b, 0) / run.length });
    }
    prev = p;
  }
  return out;
}

/**
 * When every reading in a series is the same value (most often the one reading carried in to
 * the span's start, from a sensor that hasn't changed since), the time of the first of them;
 * undefined when there is none, or the value changed (its rate is then measured, or unknown).
 */
export function heldValue(points: Point[]): number | undefined {
  const known = points.filter((p) => p.v !== null);
  if (!known.length || known.some((p) => p.v !== known[0].v)) return undefined;
  return known[0].t;
}

const ENERGY_PER_HOUR: Record<string, string> = { 'Wh/h': 'W', 'kWh/h': 'kW', 'MWh/h': 'MW' };

/** The unit of a rate: "°C/h", "L/min"; energy per hour as power (kWh/h is kW); none as "/h". */
export function rateUnit(unit: string, time: DerivativeUnitTime): string {
  const plain = `${unit}/${time}`;
  return ENERGY_PER_HOUR[plain] ?? plain;
}

/** The entity with its value, text and unit read from the last number of a transformed series. */
function withLatest(entity: ResolvedEntity, points: Point[], unit: string, hass: HomeAssistant): ResolvedEntity {
  let latest: number | null = null;
  for (let i = points.length - 1; i >= 0 && latest === null; i--) latest = points[i].v;
  if (latest === null) return { ...entity, unit };
  const valueText = formatNumber(latest, entity.decimals, hass);
  const display = withUnit(valueText, unit);
  return { ...entity, unit, value: latest, valueText, display, label: `${entity.name}, ${display}` };
}

/**
 * A history series as its rate of change, when its entity asks for one (`transform: derivative`);
 * any other series comes back as it was.
 */
export function derivativeSeries(
  entity: ResolvedEntity,
  points: Point[],
  hass: HomeAssistant,
  until = Date.now(),
): { entity: ResolvedEntity; points: Point[] } {
  const own = entity.config as DerivativeConfig;
  if (own.transform !== 'derivative') return { entity, points };
  const time = (own.transform_unit_time as DerivativeUnitTime | undefined) ?? 'h';
  const increasing = !entity.config.attribute && entity.stateObj?.attributes?.state_class === 'total_increasing';
  const smoothing = typeof own.transform_smoothing === 'number' ? own.transform_smoothing : 1;
  let out = rates(points, UNIT_MS[time], increasing, smoothing, parseWindow(own.transform_smoothing_time) ?? 0);
  const steady = out.every((p) => p.v === null) ? heldValue(points) : undefined;
  // Held at one value all span (history then has only the reading carried in to its start): it
  // changed at a rate of 0, from that reading to now, as a line chart of it draws it flat.
  if (steady !== undefined && steady < until)
    out = [
      { t: steady, v: 0 },
      { t: until, v: 0 },
    ];
  return { entity: withLatest(entity, out, rateUnit(entity.unit, time), hass), points: out };
}

/** Any entity in the card asks for a rate of change, so its own fields are worth showing. */
function anyDerivative(config: CardConfig): boolean {
  return (config.entities ?? []).some(
    (e) => typeof e === 'object' && (e as DerivativeConfig).transform === 'derivative',
  );
}

/** The `transform` dropdown's field, found by where it writes, whichever transform added it. */
const isTransform = (f: { path: string[] }) => f.path.length === 1 && f.path[0] === 'transform';

interface SelectField {
  name: string;
  selector: { select: { mode: string; options: { value: string; label: string }[] } };
}

/** Built once per base schema, base fields, language and switch, so ha-form keeps its schema. */
const fieldCache = new WeakMap<object, WeakMap<object, Map<string, EntityFields>>>();
const EMPTY: EntityFields = { schema: [], fields: [] };

/**
 * A history chart's per-entity transform fields with the rate-of-change ones added: "Rate of
 * change" in the transform dropdown (made here if no other transform made it first), and the time
 * unit and smoothing while any entity uses it. Other styles' fields come back as they were.
 */
export function withDerivativeFields(
  style: string,
  hass: HomeAssistant | undefined,
  config: CardConfig,
  base: EntityFields | undefined,
): EntityFields | undefined {
  if (!DERIVATIVE_STYLES.includes(style)) return base;
  const from = base ?? EMPTY;
  const shown = anyDerivative(config);
  const key = `${languageOf(hass)}|${shown}`;
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
  const option = { value: 'derivative', label: t('editor_derivative_transform_derivative') };
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
      name: 'derivative_transform',
      selector: {
        select: {
          mode: 'dropdown',
          options: [{ value: 'none', label: t('editor_derivative_transform_none') }, option],
        },
      },
    };
    schema = [...from.schema, select];
    fields = [...fields, { name: 'derivative_transform', path: ['transform'], default: 'none' }];
  }
  if (shown) {
    schema = [
      ...schema,
      {
        type: 'grid',
        name: '',
        schema: [
          {
            name: 'derivative_unit_time',
            selector: {
              select: {
                mode: 'dropdown',
                options: DERIVATIVE_UNIT_TIMES.map((value) => ({
                  value,
                  label: t(`editor_derivative_unit_time_${value}`),
                })),
              },
            },
          },
          {
            name: 'derivative_smoothing',
            selector: { number: { min: 1, max: MAX_SMOOTHING, step: 1, mode: 'box' } },
          },
        ],
      },
      { name: 'derivative_smoothing_time', selector: { text: {} } },
    ];
    fields = [
      ...fields,
      { name: 'derivative_unit_time', path: ['transform_unit_time'], default: 'h' },
      { name: 'derivative_smoothing', path: ['transform_smoothing'], default: 1 },
      { name: 'derivative_smoothing_time', path: ['transform_smoothing_time'] },
    ];
  }
  const out = { schema, fields };
  byKey.set(key, out);
  return out;
}
