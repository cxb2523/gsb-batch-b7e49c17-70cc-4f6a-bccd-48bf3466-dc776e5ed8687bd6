import { css, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import {
  CATEGORY_FIELDS,
  bandTooltip,
  categoryGeometry,
  categoryOptions,
  categoryPlot,
  categorySchema,
  categoryStyles,
  clockScale,
  hoveredBand,
  labelCount,
  numberScale,
  stopCategoryHover,
  validateCategoryOptions,
} from '../chart/category-plot';
import type { Category, CategoryGeometry, ValueScale } from '../chart/category-plot';
import { dotReadings, sampleReadings, summarize } from '../chart/density';
import type { Reading } from '../chart/density';
import {
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries } from '../chart/frame';
import { stopChartWidth } from '../chart/grid';
import { chartFrame, chartLayout, layoutStyles } from '../chart/layout';
import { dotsPath } from '../chart/series-style';
import { fitSwarm, sizeFor } from '../chart/swarm';
import { tooltipEnabled, tooltipStyles } from '../chart/tooltip';
import {
  HISTORY_FIELDS,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  historyVariant,
} from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { wallTime } from '../history/timezone';
import type { Point } from '../history/types';
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const PLACE_BY = ['value', 'time_of_day'] as const;
export type PlaceBy = (typeof PLACE_BY)[number];

export const DEFAULT_DOT = 6;
export const MIN_DOT = 2;
export const MAX_DOT = 16;
/** At most this many dots per row; more are evenly sampled (the count still says how many). */
const MAX_DOTS = 400;
/** A row's height across, before compact: swarms need more room than a violin. */
const ROW_PX = 96;
/** Dot sizes when sized by value are rounded to this many steps, one path each. */
const SIZE_STEPS = 6;

export interface SwarmOptions {
  placeBy: PlaceBy;
  dot: number;
  sized: boolean;
}

export function swarmOptions(raw: CardConfig): SwarmOptions {
  return {
    placeBy: (raw.place_by as PlaceBy | undefined) ?? 'value',
    dot: typeof raw.dot_size === 'number' ? raw.dot_size : DEFAULT_DOT,
    sized: raw.size_by_value === true,
  };
}

/** Domains whose states are on and off: their dots are the times they turned on. */
const ON_OFF = /^(binary_sensor|switch|input_boolean|light|fan|siren|automation)\./;

/**
 * The times something turned on: readings of 1 (on) after anything but 1. The state carried in
 * from before the period is not an event, and nor is coming back on after being unavailable (a
 * restart), when it was on before.
 */
export function onEvents(points: Point[]): Point[] {
  const out: Point[] = [];
  let prev: number | null = null;
  for (const p of points) {
    if (p.v === null) continue;
    if (p.v === 1 && prev !== 1 && !p.carried) out.push(p);
    prev = p.v;
  }
  return out;
}

/** Hours since midnight (0–24) in the card's time zone. */
export function hourOfDay(t: number, timeZone: string): number {
  const w = wallTime(t, timeZone);
  return w.hour + w.minute / 60 + w.second / 3600;
}

/** One row of dots: the readings (or events), placed and sized. */
interface Row {
  series: ChartSeries;
  /** Where along the axis, in axis units (a value, or hours). */
  positions: number[];
  /** The reading behind each dot, for sizing. */
  values: number[];
  total: number;
  events: boolean;
  /** The value the sensor held all period, when it took no reading in it (see `dotReadings`). */
  held?: number;
}

function rowsOf(frame: ReturnType<typeof historyFrame>, o: SwarmOptions, now: number): Row[] {
  const until = Math.min(frame.range.end, now);
  return frame.series.map((series) => {
    const events = o.placeBy === 'time_of_day' && ON_OFF.test(series.entity.entityId);
    let readings: Reading[];
    let held: number | undefined;
    if (events) {
      readings = onEvents(series.points).map((p) => ({ t: p.t, v: 1, w: 1, real: true }));
    } else {
      // Dots are readings taken in the period, or the one value a sensor held all period.
      ({ readings, held } = dotReadings(series.points, frame.source === 'history' && !frame.group, until));
      // Held all period, it was read at no time of day: no dot on a clock axis.
      if (held !== undefined && o.placeBy === 'time_of_day') readings = [];
    }
    const shown = sampleReadings(readings, MAX_DOTS);
    return {
      series,
      positions: shown.map((r) => (o.placeBy === 'time_of_day' ? hourOfDay(r.t, frame.zone.timeZone) : r.v)),
      values: shown.map((r) => r.v),
      total: held === undefined ? readings.length : 0,
      events,
      ...(held === undefined ? {} : { held }),
    };
  });
}

function detail(row: Row, hass: HomeAssistant | undefined): string {
  if (row.held !== undefined) {
    const value = withUnit(formatNumber(row.held, row.series.entity.decimals, hass), row.series.entity.unit);
    return localize(hass, 'swarm_no_change', { value });
  }
  if (row.total === 0) return localize(hass, 'swarm_none');
  const n = formatNumber(row.total, 0, hass);
  const count = localize(hass, row.events ? 'swarm_events' : 'swarm_readings', { n });
  return count;
}

/** One row's swarm: dots packed in px so they stay round and apart, then into plot units. */
function drawRow(row: Row, i: number, g: CategoryGeometry, scale: ValueScale, o: SwarmOptions): SVGTemplateResult {
  if (row.positions.length === 0) return svg``;
  const r = o.dot / 2;
  const span = scale.domain[1] - scale.domain[0] || 1;
  const lo = Math.min(...row.values);
  const hi = Math.max(...row.values);
  const radii = row.values.map((v) => {
    if (!o.sized || row.events) return r;
    // Rounded to a few steps, so a row is a handful of paths rather than one per dot.
    const exact = sizeFor(v, lo, hi, r);
    return Math.max(0.5, Math.round((exact / r) * SIZE_STEPS) / SIZE_STEPS) * r;
  });
  const dots = row.positions.map((p, k) => ({ at: ((p - scale.domain[0]) / span) * g.valuePx, r: radii[k] }));
  const { offsets, scale: shrink } = fitSwarm(dots, g.bandPx / 2 - 1, 1);
  const bySize = new Map<number, [number, number][]>();
  dots.forEach((d, k) => {
    const size = Math.round(d.r * shrink * 2 * 100) / 100;
    const list = bySize.get(size) ?? [];
    list.push(g.at(row.positions[k], i, offsets[k] / g.bandPx));
    bySize.set(size, list);
  });
  return svg`<g class="swarm entity" data-index=${row.series.index} stroke=${row.series.color}>
    ${[...bySize].map(([size, pts]) => svg`<path class="dots" d=${dotsPath(pts)} style="stroke-width:${size}px"></path>`)}
  </g>`;
}

function tooltipRows(row: Row, scale: ValueScale, clock: boolean, hass: HomeAssistant | undefined): [string, string][] {
  const s = summarize(row.positions.map((v, i) => ({ t: i, v, w: 1, real: true })));
  if (!s) return [];
  const f = (v: number) =>
    clock ? scale.format(v) : withUnit(formatNumber(v, row.series.entity.decimals, hass), row.series.entity.unit);
  if (row.held !== undefined) return [[localize(hass, 'swarm_held'), f(row.held)]];
  return [
    [localize(hass, 'dist_count'), formatNumber(row.total, 0, hass)],
    ...(row.positions.length < row.total
      ? ([[localize(hass, 'swarm_shown'), formatNumber(row.positions.length, 0, hass)]] as [string, string][])
      : []),
    [localize(hass, 'dist_median'), f(s.median)],
    [localize(hass, 'dist_middle'), `${f(s.q1)} – ${f(s.q3)}`],
    // By time of day the ends are the earliest and latest times; by value, the lowest and highest readings.
    [localize(hass, clock ? 'swarm_earliest_latest' : 'swarm_lowest_highest'), `${f(s.min)} – ${f(s.max)}`],
  ];
}

const SWARM_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'place_by', path: ['place_by'], default: 'value' },
  { name: 'dot_size', path: ['dot_size'], default: DEFAULT_DOT },
  { name: 'size_by_value', path: ['size_by_value'], default: false },
  ...CATEGORY_FIELDS,
];

/** Fixed value ends only mean something when dots are placed by value. */
function withoutValueRange(schema: unknown[]): unknown[] {
  return schema.map((item) => {
    const grid = item as { schema?: { name: string }[] };
    if (!grid.schema) return item;
    return { ...grid, schema: grid.schema.filter((s) => s.name !== 'value_min' && s.name !== 'value_max') };
  });
}

export function swarmEditor(ctx: ChartEditorContext): TemplateResult {
  const o = swarmOptions(ctx.config);
  const schema = cachedSchema(`beeswarm|${historyVariant(ctx.config)}|${o.placeBy}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ctx.config),
    { name: 'place_by', selector: choice(ctx.hass, 'place_by', PLACE_BY) },
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'dot_size',
          selector: { number: { min: MIN_DOT, max: MAX_DOT, step: 1, mode: 'box', unit_of_measurement: 'px' } },
        },
        { name: 'size_by_value', selector: { boolean: {} } },
      ],
    },
    ...(o.placeBy === 'value' ? categorySchema(ctx.hass) : withoutValueRange(categorySchema(ctx.hass))),
  ]);
  return chartForm(ctx, 'chart', schema, SWARM_FIELDS);
}

const ENTITY_FIELDS = {
  schema: [{ name: 'fill_color', selector: { text: {} } }],
  fields: [{ name: 'fill_color', path: ['color'] }],
};

export const beeswarm: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 260,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${categoryStyles}
    .swarm .dots {
      fill: none;
      stroke-linecap: round;
      stroke-opacity: 0.85;
    }
  `,
  thumbnail: () => svg`
    <g fill="var(--primary-color, #03a9f4)">
      <circle cx="10" cy="14" r="2.2" /><circle cx="16" cy="11" r="2.2" /><circle cx="16" cy="17" r="2.2" />
      <circle cx="21" cy="14" r="2.2" /><circle cx="26" cy="11" r="2.2" /><circle cx="26" cy="17" r="2.2" />
      <circle cx="31" cy="14" r="2.2" /><circle cx="44" cy="14" r="2.2" /><circle cx="52" cy="14" r="2.2" />
    </g>
    <g fill="var(--warning-color, #f59e0b)">
      <circle cx="14" cy="30" r="2.2" /><circle cx="30" cy="30" r="2.2" /><circle cx="36" cy="27" r="2.2" />
      <circle cx="36" cy="33" r="2.2" /><circle cx="41" cy="30" r="2.2" /><circle cx="46" cy="27" r="2.2" />
      <circle cx="46" cy="33" r="2.2" /><circle cx="51" cy="30" r="2.2" /><circle cx="56" cy="27" r="2.2" />
    </g>`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateCategoryOptions(raw);
    if (raw.place_by !== undefined && !PLACE_BY.includes(raw.place_by as PlaceBy)) {
      throw new Error(`"place_by" must be one of: ${PLACE_BY.join(', ')}`);
    }
    const dot = raw.dot_size;
    if (dot !== undefined && !(typeof dot === 'number' && dot >= MIN_DOT && dot <= MAX_DOT)) {
      throw new Error(`"dot_size" must be a number from ${MIN_DOT} to ${MAX_DOT}`);
    }
    if (raw.size_by_value !== undefined && typeof raw.size_by_value !== 'boolean') {
      throw new Error('"size_by_value" must be true or false');
    }
  },
  editor: swarmEditor,
  entityFields: () => ENTITY_FIELDS,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopCategoryHover(host);
  },
  render(ctx: ChartContext) {
    const now = Date.now();
    const frame = historyFrame(ctx, now);
    const nav = periodNav(frame, ctx);
    const layout = { ...chartLayout(ctx.raw), header: 'above' as const };
    const message = frameMessage(frame, ctx);
    if (message) return chartFrame(layout, nav, message);
    const o = swarmOptions(ctx.raw);
    const rows = rowsOf(frame, o, now);
    const options = categoryOptions(ctx.raw);
    const probe = categoryGeometry(ctx, rows.length, { domain: [0, 1] }, ROW_PX);
    const count = labelCount(probe.valuePx, options.orientation);
    let scale: ValueScale;
    if (o.placeBy === 'time_of_day') scale = clockScale(count, ctx.hass);
    else {
      const all = rows.flatMap((r) => r.positions);
      scale = numberScale(all.length ? [Math.min(...all), Math.max(...all)] : undefined, ctx.raw, count, ctx.hass);
    }
    const geometry = categoryGeometry(ctx, rows.length, scale, ROW_PX);
    const content = svg`${rows.map((row, i) => drawRow(row, i, geometry, scale, o))}`;
    const categories: Category[] = rows.map((row) => {
      const d = detail(row, ctx.hass);
      return {
        index: row.series.index,
        name: row.series.entity.name,
        detail: d,
        color: row.series.color,
        label: `${row.series.entity.name}, ${d}`,
      };
    });
    const tooltip = tooltipEnabled(ctx.raw);
    const at = tooltip ? hoveredBand(ctx.host) : undefined;
    const hovered = at === undefined ? undefined : rows[at];
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_beeswarm'),
      names: frame.series.map((s) => s.entity.name).join(', '),
    });
    return chartFrame(
      layout,
      nav,
      categoryPlot({
        ctx,
        geometry,
        categories,
        scale,
        content,
        label,
        hover: tooltip,
        overlay:
          hovered && hovered.positions.length > 0 && at !== undefined
            ? bandTooltip(
                geometry,
                at,
                hovered.series.entity.name,
                tooltipRows(hovered, scale, o.placeBy === 'time_of_day', ctx.hass),
                hovered.series.color,
              )
            : nothing,
      }),
    );
  },
};
