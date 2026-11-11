import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { toReading } from '../history/fetch';
import type { Point, Range } from '../history/types';
import { languageOf, localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import type { FieldBinding } from '../editor/schemas';
import { convertPoints } from '../units';
import { downsample } from './downsample';
import { VIEW_W } from './frame';
import type { ChartSeries, HistoryFrame } from './frame';
import type { PlotScales } from './grid';
import { runPath, runs } from './paths';

/*
 * A forecast drawn on after a series' history: Solcast's or Forecast.Solar's estimate after a
 * solar sensor, a price list after a tariff sensor, a weather entity's hourly temperatures after a
 * thermometer. Each entity may name a `forecast`; the line chart draws it dashed in the series'
 * colour from now on, and stretches its time axis past now to show it when its span ends now.
 *
 * Where the forecast comes from:
 * - an attribute holding a list of objects (`detailedForecast` on Solcast: `period_start`,
 *   `pv_estimate`), a list of [time, value] pairs, or an object of time: value (`watts`);
 * - a weather entity with no attribute named: Home Assistant's `weather/subscribe_forecast`
 *   websocket subscription (hourly by default), or its old `forecast` attribute if it still has one.
 */

/** Weather forecasts Home Assistant can send. */
export const FORECAST_TYPES = ['hourly', 'daily', 'twice_daily'] as const;
export type ForecastType = (typeof FORECAST_TYPES)[number];

/** How far past now the time axis reaches for a forecast, by default. */
export const DEFAULT_FORECAST_HOURS = 24;

/** One entity's `forecast` option. */
export interface ForecastConfig {
  entity: string;
  /** The attribute holding the forecast; absent: the weather subscription, else `forecast`. */
  attribute?: string;
  /** Each item's value; absent: the first of `VALUE_KEYS` it has. */
  value_key?: string;
  /** Each item's time; absent: the first of `TIME_KEYS` it has. */
  time_key?: string;
  /** Weather only: which forecast to subscribe to. */
  type?: ForecastType;
  /** Scale every value (1000 turns Solcast's kW into W). */
  multiply?: number;
}

/** Keys forecast items commonly give their time in, tried in order. */
export const TIME_KEYS = ['datetime', 'period_start', 'start', 'starts_at', 'startsAt', 'time', 'from', 'date'];
/** Keys forecast items commonly give their value in, tried in order. */
export const VALUE_KEYS = ['value', 'pv_estimate', 'watts', 'price', 'total', 'temperature', 'native_temperature'];

const isEntityId = (v: unknown): v is string => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v.trim());
const text = (v: unknown) => v === undefined || typeof v === 'string';

/** Throw a readable error for a bad `forecast` on an entity, or a bad `forecast_hours`. */
export function validateForecast(raw: CardConfig): void {
  const hours = (raw as { forecast_hours?: unknown }).forecast_hours;
  if (hours !== undefined && !(typeof hours === 'number' && Number.isFinite(hours) && hours > 0)) {
    throw new Error('"forecast_hours" must be a number above 0');
  }
  for (const item of raw.entities ?? []) {
    if (typeof item !== 'object') continue;
    const f = (item as { forecast?: unknown }).forecast;
    if (f === undefined) continue;
    const where = `"forecast" of ${item.entity}`;
    if (typeof f !== 'object' || f === null || Array.isArray(f)) throw new Error(`${where} must have an "entity"`);
    const o = f as Record<string, unknown>;
    // Left without an entity (half filled in the editor) it is ignored; a wrong one is an error.
    if (o.entity !== undefined && !isEntityId(o.entity))
      throw new Error(`"forecast.entity" of ${item.entity} must be an entity id`);
    for (const k of ['attribute', 'value_key', 'time_key']) {
      if (!text(o[k])) throw new Error(`"forecast.${k}" of ${item.entity} must be text`);
    }
    if (o.type !== undefined && !FORECAST_TYPES.includes(o.type as ForecastType)) {
      throw new Error(`"forecast.type" of ${item.entity} must be one of: ${FORECAST_TYPES.join(', ')}`);
    }
    if (o.multiply !== undefined && !(typeof o.multiply === 'number' && Number.isFinite(o.multiply))) {
      throw new Error(`"forecast.multiply" of ${item.entity} must be a number`);
    }
  }
}

/** One entity's forecast option, or undefined when it has none (or only a half-filled one). */
export function forecastOf(entity: object): ForecastConfig | undefined {
  const f = (entity as { forecast?: unknown }).forecast;
  if (typeof f !== 'object' || f === null || !isEntityId((f as ForecastConfig).entity)) return undefined;
  return { ...(f as ForecastConfig), entity: (f as ForecastConfig).entity.trim() };
}

/** How far past now the axis may reach for a forecast, in ms. */
export function forecastReach(raw: CardConfig): number {
  const hours = (raw as { forecast_hours?: unknown }).forecast_hours;
  return (typeof hours === 'number' && hours > 0 ? hours : DEFAULT_FORECAST_HOURS) * 3_600_000;
}

/** Entities the card's forecasts read, so their changes redraw it. */
export function forecastEntities(raw: CardConfig): string[] {
  const ids = new Set<string>();
  for (const item of raw.entities ?? []) {
    if (typeof item !== 'object') continue;
    const f = forecastOf(item);
    if (f) ids.add(f.entity);
  }
  return [...ids];
}

/* ------------------------------------------------------------------ maths ------------------------------------------------------------------ */

/** A time as ms: ISO text, or a number in seconds (below 1e11) or ms. NaN when unreadable. */
export function toTime(raw: unknown): number {
  if (typeof raw === 'number') return raw < 1e11 ? raw * 1000 : raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^\d+(\.\d+)?$/.test(s)) return toTime(Number(s));
    return Date.parse(s);
  }
  if (raw instanceof Date) return raw.getTime();
  return NaN;
}

const firstKey = (item: Record<string, unknown>, keys: string[]) => keys.find((k) => item[k] !== undefined);

/**
 * A forecast as points, oldest first: from a list of objects (time and value read from
 * `timeKey` / `valueKey`, or the first common key each has), a list of [time, value] pairs, or an
 * object of time: value. Items with no readable time are dropped; a value that isn't a number is
 * a gap. Values are multiplied by `multiply`.
 */
export function parseForecast(raw: unknown, valueKey?: string, timeKey?: string, multiply = 1): Point[] {
  const out: Point[] = [];
  const push = (t: number, v: unknown) => {
    if (!Number.isFinite(t)) return;
    const n = toReading(v);
    out.push({ t, v: n === null ? null : n * multiply });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item)) {
        push(toTime(item[0]), item[1]);
      } else if (typeof item === 'object' && item !== null) {
        const o = item as Record<string, unknown>;
        const tk = timeKey ?? firstKey(o, TIME_KEYS);
        const vk = valueKey ?? firstKey(o, VALUE_KEYS);
        if (tk === undefined) continue;
        push(toTime(o[tk]), vk === undefined ? undefined : o[vk]);
      }
    }
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [t, v] of Object.entries(raw as Record<string, unknown>)) push(toTime(t), v);
  }
  out.sort((a, b) => a.t - b.t);
  // One value per moment: the last given wins.
  return out.filter((p, i) => i + 1 >= out.length || out[i + 1].t !== p.t);
}

/** The value a forecast gives at `t`, read along the straight line between its points. */
export function valueAt(points: readonly Point[], t: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.t < t) continue;
    if (a.t > t || a.v === null || b.v === null) return null;
    return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return null;
}

/**
 * The part of a forecast to draw: from `now` (its value there read between the points either
 * side) to the first point at or past `end`. Points before now are left out: history covers them.
 */
export function aheadOf(points: readonly Point[], now: number, end: number): Point[] {
  const ahead: Point[] = [];
  const atNow = valueAt(points, now);
  if (atNow !== null) ahead.push({ t: now, v: atNow });
  for (const p of points) {
    if (p.t < now || (p.t === now && atNow !== null)) continue;
    ahead.push(p);
    if (p.t >= end) break;
  }
  return ahead;
}

/**
 * Where the chart's span ends once forecasts are drawn: a span ending now reaches on to the last
 * forecast reading, at most `reach` ms past now. A span that already runs past now (to the end of
 * today) or ended in the past is left alone.
 */
export function extendedEnd(range: Range, live: boolean, now: number, last: number | undefined, reach: number): number {
  if (!live || last === undefined || range.end < now - 1000 || range.end > now + 1000) return range.end;
  return Math.max(range.end, Math.min(last, now + reach));
}

/* ------------------------------------------------------------- weather feed ------------------------------------------------------------- */

/** The bit of Home Assistant's websocket connection the weather forecast needs. */
interface Connection {
  subscribeMessage?<T>(callback: (message: T) => void, message: Record<string, unknown>): Promise<() => void>;
}

interface Subscription {
  /** What happens when it is no longer wanted. */
  unsubscribe?: Promise<(() => void) | undefined>;
  items?: unknown[];
  closed: boolean;
}

const feeds = new WeakMap<HTMLElement, Map<string, Subscription>>();

/**
 * A weather entity's forecast items, from a subscription kept per card. The first call subscribes
 * (redrawing the card through `onChange` as forecasts arrive); later calls return the latest.
 * Undefined until the first one arrives, or when the connection can't subscribe.
 */
export function weatherForecast(
  host: HTMLElement,
  hass: HomeAssistant,
  entity: string,
  type: ForecastType,
  onChange: () => void,
): unknown[] | undefined {
  let subs = feeds.get(host);
  if (!subs) {
    subs = new Map();
    feeds.set(host, subs);
  }
  const k = `${entity}|${type}`;
  let sub = subs.get(k);
  if (!sub) {
    const connection = (hass as { connection?: Connection }).connection;
    const made: Subscription = { closed: false };
    sub = made;
    subs.set(k, made);
    const call = connection?.subscribeMessage?.<{ forecast?: unknown[] | null }>(
      (message) => {
        if (made.closed) return;
        made.items = Array.isArray(message?.forecast) ? message.forecast : [];
        onChange();
      },
      { type: 'weather/subscribe_forecast', entity_id: entity, forecast_type: type },
    );
    // A failed subscription (the entity has no such forecast) leaves the chart without it.
    made.unsubscribe = call?.then(
      (stop) => stop,
      () => undefined,
    );
  }
  return sub.items;
}

/** Drop a card's weather subscriptions except those in `keep` (entity|type). */
function closeFeeds(host: HTMLElement, keep: Set<string>): void {
  const subs = feeds.get(host);
  if (!subs) return;
  for (const [k, sub] of subs) {
    if (keep.has(k)) continue;
    sub.closed = true;
    void sub.unsubscribe?.then((stop) => stop?.());
    subs.delete(k);
  }
}

/** Stop a card's weather subscriptions (it leaves the page). */
export function stopForecast(host: HTMLElement): void {
  closeFeeds(host, new Set());
  feeds.delete(host);
}

/**
 * One forecast's items: its attribute when it names one; for a weather entity without one, the
 * old `forecast` attribute if present, else the subscription; for anything else, `forecast`.
 */
export function forecastItems(ctx: ChartContext, f: ForecastConfig): unknown {
  const state = ctx.hass.states[f.entity];
  if (f.attribute) return state?.attributes?.[f.attribute];
  if (f.entity.startsWith('weather.')) {
    const old = state?.attributes?.forecast;
    if (Array.isArray(old)) return old;
    return weatherForecast(ctx.host, ctx.hass, f.entity, f.type ?? 'hourly', ctx.requestUpdate);
  }
  return state?.attributes?.forecast;
}

/* ---------------------------------------------------------------- the layer ---------------------------------------------------------------- */

export interface ForecastLayer {
  /** The frame with its range stretched to show the forecasts (the same frame when there are none). */
  frame: HistoryFrame;
  /** One series per forecast, dashed in its series' colour, its points from now on. */
  series: ChartSeries[];
}

/**
 * The card's forecasts for a history frame: each entity's forecast read and cut to what lies
 * ahead, and the frame's range stretched past now to show them (see `extendedEnd`).
 */
export function forecastLayer(ctx: ChartContext, frame: HistoryFrame, now = Date.now()): ForecastLayer {
  const wanted = new Set<string>();
  const parsed: { s: ChartSeries; points: Point[] }[] = [];
  for (const s of frame.series) {
    const f = forecastOf(s.entity.config);
    if (!f) continue;
    if (!f.attribute && f.entity.startsWith('weather.')) wanted.add(`${f.entity}|${f.type ?? 'hourly'}`);
    // Weather temperatures come under `temperature`, so that is the first guess for them.
    const valueKey = f.value_key ?? (f.entity.startsWith('weather.') ? 'temperature' : undefined);
    // A forecast (after `multiply`) is in the sensor's own unit, like the line it carries on; a
    // series shown in another unit (W shown as kW) converts its forecast the same way.
    const points = convertPoints(
      parseForecast(forecastItems(ctx, f), valueKey, f.time_key, f.multiply ?? 1),
      s.entity.conversion,
    );
    if (points.length > 0) parsed.push({ s, points });
  }
  closeFeeds(ctx.host, wanted);
  if (parsed.length === 0) return { frame, series: [] };
  const last = Math.max(...parsed.map((p) => p.points[p.points.length - 1].t));
  const end = extendedEnd(frame.range, frame.live, now, last, forecastReach(ctx.raw));
  const range = end === frame.range.end ? frame.range : { ...frame.range, end };
  const series = parsed
    .map(({ s, points }) => ({ ...s, points: aheadOf(points, now, range.end), dash: true }))
    .filter((s) => s.points.some((p) => p.v !== null));
  return { frame: range === frame.range ? frame : { ...frame, range }, series };
}

/** The forecast lines, dashed in their series' colours, for the plot's SVG. */
export function forecastLines(series: readonly ChartSeries[], scales: PlotScales): SVGTemplateResult | typeof nothing {
  if (series.length === 0) return nothing;
  return svg`<g class="forecasts">${series.map((s) => {
    const d = runs(downsample(s.points, 500))
      .map((run) =>
        runPath(
          run.map((p) => [scales.x(p.t), scales.y(p.v as number)]),
          s.curve,
        ),
      )
      .join('');
    return svg`<path class="forecast-line" data-series=${s.index} d=${d} fill="none" stroke=${s.color}></path>`;
  })}</g>`;
}

/**
 * The forecasts as the tooltip should list them: named "… forecast", with a gap at the chart's
 * start so a time before the forecast begins reads as none rather than its first value.
 */
export function forecastTooltipSeries(ctx: ChartContext, series: readonly ChartSeries[], start: number): ChartSeries[] {
  return series.map((s) => ({
    ...s,
    entity: { ...s.entity, name: localize(ctx.hass, 'forecast_series', { name: s.entity.name }) },
    points: s.points[0] && s.points[0].t > start ? [{ t: start, v: null }, ...s.points] : s.points,
  }));
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** A small "Forecast" label where the forecasts begin, at the top of the plot. */
export function forecastLabel(
  ctx: ChartContext,
  series: readonly ChartSeries[],
  scales: PlotScales,
): TemplateResult | typeof nothing {
  const start = Math.min(...series.map((s) => s.points[0]?.t ?? Infinity));
  if (!Number.isFinite(start)) return nothing;
  const left = scales.x(start) / VIEW_W;
  if (!(left >= 0 && left < 0.97)) return nothing;
  return html`<span class="forecast-label ${left > 0.8 ? 'end' : ''}" style="left:${pct(left)}"
    >${localize(ctx.hass, 'forecast_label')}</span
  >`;
}

export const forecastStyles = css`
  .plot .forecast-line {
    stroke-width: 2;
    stroke-dasharray: 6 5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.85;
  }
  .forecast-label {
    position: absolute;
    top: 0;
    transform: translateX(4px);
    font-size: 10px;
    line-height: 1.2;
    padding: 1px 4px;
    border-radius: 3px;
    pointer-events: none;
    white-space: nowrap;
    color: var(--secondary-text-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent);
    border-left: 1px dashed var(--secondary-text-color);
  }
  .forecast-label.end {
    transform: translateX(calc(-100% - 4px));
    border-left: none;
    border-right: 1px dashed var(--secondary-text-color);
  }
`;

/* ---------------------------------------------------------------- editor ---------------------------------------------------------------- */

/** Each series' forecast, in its options. */
export const FORECAST_ENTITY_FIELDS: FieldBinding[] = [
  { name: 'forecast_entity', path: ['forecast', 'entity'] },
  { name: 'forecast_attribute', path: ['forecast', 'attribute'] },
  { name: 'forecast_value_key', path: ['forecast', 'value_key'] },
  { name: 'forecast_time_key', path: ['forecast', 'time_key'] },
  { name: 'forecast_type', path: ['forecast', 'type'] },
  { name: 'forecast_multiply', path: ['forecast', 'multiply'] },
];

/** The card's reach past now, in its Chart section. */
export const FORECAST_FIELDS: FieldBinding[] = [
  { name: 'forecast_hours', path: ['forecast_hours'], default: DEFAULT_FORECAST_HOURS },
];

const FORECAST_SCHEMA = [
  { name: 'forecast_hours', selector: { number: { min: 1, max: 336, mode: 'box', unit_of_measurement: 'h' } } },
];

/** Part of the Chart section's cache key: whether any entity has a forecast. */
export const forecastVariant = (config: CardConfig | undefined) =>
  config && forecastEntities(config).length > 0 ? 'forecast' : '';

/** The reach past now, shown once an entity has a forecast (cache under `forecastVariant`). */
export function forecastSchema(config: CardConfig | undefined): unknown[] {
  return forecastVariant(config) ? FORECAST_SCHEMA : [];
}

const entitySchemas = new Map<string, { base: unknown[]; schema: unknown[] }>();
const entityFieldLists = new WeakMap<FieldBinding[], FieldBinding[]>();

/**
 * A series' options with its forecast added in a folding section after `base` (built once per
 * language and base, so ha-form keeps the same schema).
 */
export function withForecastFields(
  hass: HomeAssistant | undefined,
  base: { schema: unknown[]; fields: FieldBinding[] },
): { schema: unknown[]; fields: FieldBinding[] } {
  const k = languageOf(hass);
  let cached = entitySchemas.get(k);
  if (!cached || cached.base !== base.schema) {
    const t = (key: string) => localize(hass, key);
    cached = {
      base: base.schema,
      schema: [
        ...base.schema,
        {
          type: 'expandable',
          name: '',
          flatten: true,
          title: t('editor_forecast_title'),
          schema: [
            { name: 'forecast_entity', selector: { entity: {} } },
            {
              type: 'grid',
              name: '',
              schema: [
                { name: 'forecast_attribute', selector: { text: {} } },
                {
                  name: 'forecast_type',
                  selector: {
                    select: {
                      mode: 'dropdown',
                      options: FORECAST_TYPES.map((value) => ({ value, label: t(`editor_forecast_type_${value}`) })),
                    },
                  },
                },
                { name: 'forecast_value_key', selector: { text: {} } },
                { name: 'forecast_time_key', selector: { text: {} } },
                { name: 'forecast_multiply', selector: { number: { mode: 'box', step: 'any' } } },
              ],
            },
          ],
        },
      ],
    };
    entitySchemas.set(k, cached);
  }
  let fields = entityFieldLists.get(base.fields);
  if (!fields) {
    fields = [...base.fields, ...FORECAST_ENTITY_FIELDS];
    entityFieldLists.set(base.fields, fields);
  }
  return { schema: cached.schema, fields };
}
