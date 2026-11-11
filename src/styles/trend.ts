import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { bandFor, baseColor } from '../bands';
import { DEFAULT_BANDS } from '../config';
import { formatTime } from '../chart/axes';
import {
  VIEW_H,
  VIEW_W,
  disconnectHistory,
  frameStyles,
  historyFrame,
  periodNav,
  plot,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { stopChartWidth } from '../chart/grid';
import { linear } from '../chart/scale';
import { runPath, runs } from '../chart/paths';
import type { Curve } from '../chart/paths';
import { DEFAULT_LINE_WIDTH, MAX_LINE_WIDTH, MIN_LINE_WIDTH, dotSize, dotsPath } from '../chart/series-style';
import {
  hoverHandlers,
  hoverTime,
  nearestIndex,
  stopHover,
  tooltipEnabled,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import {
  DEFAULT_POINTS_PER_HOUR,
  MAX_BARS,
  MAX_BUCKETS,
  bandStops,
  bucketBounds,
  bucketSeries,
  checkAggregate,
  extrema,
  parseBound,
  placeBuckets,
  trendDomain,
} from '../chart/trend-data';
import type { Bound, TrendPoint } from '../chart/trend-data';
import { trendEditor, trendEntityFields } from '../editor/trend-editor';
import { formatNumber, withUnit } from '../format';
import type { Aggregate } from '../history/group';
import { localize } from '../localize';
import { iconOverride } from '../resolve';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig } from '../types';
import type { ChartContext, ChartStyleModule } from './index';

/**
 * A compact card for one or a few sensors, after mini-graph-card: the name and icon, the current
 * value in large type, and a graph of its history filling the bottom of the card edge to edge.
 * Hovering or dragging along the graph shows the value at that moment in place of the current one.
 */

export const GRAPH_KINDS = ['line', 'bar', 'none'] as const;
export const FILL_KINDS = ['solid', 'fade', 'none'] as const;
export const SHOW_MODES = ['hover', 'always', 'never'] as const;
export const HEADER_ALIGN = ['default', 'left', 'right', 'center'] as const;
export const ICON_ALIGN = ['right', 'left', 'state'] as const;
export const STATE_ALIGN = ['left', 'right', 'center'] as const;
export const TRANSITIONS = ['smooth', 'hard'] as const;

type GraphKind = (typeof GRAPH_KINDS)[number];
type FillKind = (typeof FILL_KINDS)[number];
type ShowMode = (typeof SHOW_MODES)[number];

/** Graph height per 500 px of width, as mini-graph-card's `height`: the graph keeps its shape as the card resizes. */
export const DEFAULT_HEIGHT = 150;
export const DEFAULT_TREND_LINE_WIDTH = DEFAULT_LINE_WIDTH;
export const DEFAULT_BAR_SPACING = 4;

/** The trend options from YAML, with defaults filled in. */
export interface TrendOptions {
  graph: GraphKind;
  fill: FillKind;
  points: ShowMode;
  labels: ShowMode;
  pointsPerHour: number;
  height: number;
  lineWidth: number;
  barSpacing: number;
  transition: 'smooth' | 'hard';
  extrema: boolean;
  average: boolean;
  legend: boolean;
  factor: number;
  alignHeader: (typeof HEADER_ALIGN)[number];
  alignIcon: (typeof ICON_ALIGN)[number];
  alignState: (typeof STATE_ALIGN)[number];
  fontSize: number;
  fontSizeHeader?: number;
  colorName: boolean;
  colorValue: boolean;
  colorIcon: boolean;
  group: boolean;
  iconImage?: string;
  primary: { min?: Bound; max?: Bound; minRange?: number };
  secondary: { min?: Bound; max?: Bound; minRange?: number };
}

/** Per-entity trend settings (entity configs keep keys the card doesn't know). */
interface TrendEntity {
  color?: string;
  line_width?: number;
  aggregate?: Aggregate;
  y_axis?: 'primary' | 'secondary';
  fixed_value?: boolean;
  show_state?: boolean;
  show_indicator?: boolean;
  show_graph?: boolean;
  show_line?: boolean;
  show_fill?: boolean;
  show_points?: boolean;
  show_legend?: boolean;
  show_legend_state?: boolean;
}

/** mini-graph-card's true / false / hover, or always / never / hover. */
function showMode(raw: unknown, fallback: ShowMode): ShowMode {
  if (raw === undefined) return fallback;
  if (raw === true) return 'always';
  if (raw === false) return 'never';
  return raw as ShowMode;
}

/** `fill: true` (mini-graph-card's solid fill) is the faded one here, as on the area chart. */
function fillKind(raw: unknown): FillKind {
  if (raw === undefined || raw === true) return 'fade';
  if (raw === false) return 'none';
  return raw as FillKind;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function trendOptions(raw: CardConfig): TrendOptions {
  return {
    graph: (raw.graph as GraphKind | undefined) ?? 'line',
    fill: fillKind(raw.fill),
    points: showMode(raw.points, 'hover'),
    labels: showMode(raw.labels, 'hover'),
    pointsPerHour: num(raw.points_per_hour) ?? DEFAULT_POINTS_PER_HOUR,
    height: num(raw.height) ?? DEFAULT_HEIGHT,
    lineWidth: num(raw.line_width) ?? DEFAULT_TREND_LINE_WIDTH,
    barSpacing: num(raw.bar_spacing) ?? DEFAULT_BAR_SPACING,
    transition: (raw.color_transition as 'smooth' | 'hard' | undefined) ?? 'smooth',
    extrema: raw.extrema === true,
    average: raw.average === true,
    legend: raw.legend !== false,
    factor: Math.pow(10, num(raw.value_factor) ?? 0),
    alignHeader: (raw.align_header as TrendOptions['alignHeader'] | undefined) ?? 'default',
    alignIcon: (raw.align_icon as TrendOptions['alignIcon'] | undefined) ?? 'right',
    alignState: (raw.align_state as TrendOptions['alignState'] | undefined) ?? 'left',
    fontSize: num(raw.font_size) ?? 100,
    fontSizeHeader: num(raw.font_size_header),
    colorName: raw.color_name === true,
    colorValue: raw.color_value === true,
    colorIcon: raw.color_icon === true,
    group: raw.group === true,
    iconImage: typeof raw.icon_image === 'string' && raw.icon_image !== '' ? raw.icon_image : undefined,
    primary: {
      min: parseBound(raw.y_min, 'y_min'),
      max: parseBound(raw.y_max, 'y_max'),
      minRange: num(raw.min_range),
    },
    secondary: {
      min: parseBound(raw.y_min_secondary, 'y_min_secondary'),
      max: parseBound(raw.y_max_secondary, 'y_max_secondary'),
      minRange: num(raw.min_range_secondary),
    },
  };
}

function oneOf(raw: unknown, values: readonly unknown[], name: string): void {
  if (raw !== undefined && !values.includes(raw)) {
    throw new Error(`"${name}" must be one of: ${values.join(', ')}`);
  }
}

function checkNumber(raw: unknown, name: string, min: number, max = Infinity, integer = false): void {
  if (raw === undefined) return;
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max ||
    (integer && !Number.isInteger(raw))
  ) {
    const range = max === Infinity ? `${min} or more` : `from ${min} to ${max}`;
    throw new Error(`"${name}" must be ${integer ? 'a whole number' : 'a number'} ${range}`);
  }
}

function checkBool(raw: unknown, name: string): void {
  if (raw !== undefined && typeof raw !== 'boolean') throw new Error(`"${name}" must be true or false`);
}

/** Throw a readable error for any bad trend option, on the card or an entity. */
export function validateTrend(raw: CardConfig): void {
  validateHistoryOptions(raw);
  validateTooltipOptions(raw);
  oneOf(raw.graph, GRAPH_KINDS, 'graph');
  oneOf(raw.fill, [...FILL_KINDS, true, false], 'fill');
  oneOf(raw.points, [...SHOW_MODES, true, false], 'points');
  oneOf(raw.labels, [...SHOW_MODES, true, false], 'labels');
  oneOf(raw.color_transition, TRANSITIONS, 'color_transition');
  oneOf(raw.align_header, HEADER_ALIGN, 'align_header');
  oneOf(raw.align_icon, ICON_ALIGN, 'align_icon');
  oneOf(raw.align_state, STATE_ALIGN, 'align_state');
  checkNumber(raw.points_per_hour, 'points_per_hour', 0, 60);
  checkNumber(raw.height, 'height', 20, 1000);
  checkNumber(raw.line_width, 'line_width', MIN_LINE_WIDTH, MAX_LINE_WIDTH);
  checkNumber(raw.bar_spacing, 'bar_spacing', 0, 50);
  checkNumber(raw.value_factor, 'value_factor', -9, 9, true);
  checkNumber(raw.font_size, 'font_size', 25, 400);
  checkNumber(raw.font_size_header, 'font_size_header', 6, 60);
  checkNumber(raw.min_range, 'min_range', 0);
  checkNumber(raw.min_range_secondary, 'min_range_secondary', 0);
  for (const k of ['extrema', 'average', 'legend', 'color_name', 'color_value', 'group']) checkBool(raw[k], k);
  if (raw.icon_image !== undefined && typeof raw.icon_image !== 'string') throw new Error('"icon_image" must be a URL');
  trendOptions(raw);
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object') continue;
    const own = e as TrendEntity & { entity: string };
    const where = (k: string) => `"${k}" of ${own.entity}`;
    checkAggregate(own.aggregate, where('aggregate'));
    oneOf(own.y_axis, ['primary', 'secondary'], `y_axis of ${own.entity}`);
    checkNumber(own.line_width, `line_width of ${own.entity}`, MIN_LINE_WIDTH, MAX_LINE_WIDTH);
    for (const k of [
      'fixed_value',
      'show_state',
      'show_indicator',
      'show_graph',
      'show_line',
      'show_fill',
      'show_points',
      'show_legend',
      'show_legend_state',
    ] as const) {
      if (own[k] !== undefined && typeof own[k] !== 'boolean') throw new Error(`${where(k)} must be true or false`);
    }
  }
}

/** One series ready to draw: its points in buckets, its colour and where it shows. */
interface TrendSeries {
  index: number;
  entity: ResolvedEntity;
  own: TrendEntity;
  points: TrendPoint[];
  /** The series' own colour, or undefined when it is coloured by bands. */
  color?: string;
  /** Its colour now: its own, the current value's band, or its palette colour. */
  current: string;
  curve: Curve;
  secondary: boolean;
  graphed: boolean;
}

/** Bands someone set (on the card or the entity), rather than the single default one. */
const hasBands = (e: ResolvedEntity) => e.config.severity !== DEFAULT_BANDS;

function trendSeries(frame: HistoryFrame, ctx: ChartContext, options: TrendOptions): TrendSeries[] {
  const until = Math.min(frame.range.end, Date.now());
  const bars = options.graph === 'bar';
  // Bars always need buckets; a line with points_per_hour 0 draws every reading.
  const perHour = bars && options.pointsPerHour === 0 ? DEFAULT_POINTS_PER_HOUR : options.pointsPerHour;
  const bounds = frame.group ? [] : bucketBounds(frame.range, perHour, bars ? MAX_BARS : MAX_BUCKETS);
  const cardAggregate = (ctx.raw.aggregate as Aggregate | undefined) ?? 'mean';
  return frame.series.map((s: ChartSeries) => {
    const own = s.entity.config as unknown as TrendEntity;
    let points: TrendPoint[] = s.points;
    if (own.fixed_value && s.entity.value !== null) {
      points = [
        { t: frame.range.start, v: s.entity.value },
        { t: until, v: s.entity.value },
      ];
    } else if (frame.group) {
      // Calendar groups (`group_by`): drawn at their middles like buckets.
      points = placeBuckets(s.points, frame.range, until);
    } else if (bounds.length) {
      points = placeBuckets(
        bucketSeries(s.points, bounds, own.aggregate ?? cardAggregate, frame.source, until),
        frame.range,
        until,
      );
    }
    if (options.factor !== 1) points = points.map((p) => (p.v === null ? p : { ...p, v: p.v * options.factor }));
    const ownColor = own.color !== undefined ? baseColor(own.color) : undefined;
    const banded = !ownColor && hasBands(s.entity);
    const value = s.entity.value === null ? null : s.entity.value * options.factor;
    const current = ownColor ?? (banded && value !== null ? baseColor(bandFor(value, s.entity.bands).color) : s.color);
    return {
      index: s.index,
      entity: s.entity,
      own,
      points,
      color: banded ? undefined : (ownColor ?? s.color),
      current,
      curve: s.curve,
      secondary: own.y_axis === 'secondary',
      graphed: own.show_graph !== false,
    };
  });
}

/** Lowest and highest reading across these series. */
function dataExtent(series: TrendSeries[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p.v === null) continue;
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/** The value as text, scaled by `value_factor`, with the entity's unit kept apart for styling. */
function valueParts(v: number | null, e: ResolvedEntity, factor: number, hass: ChartContext['hass']) {
  if (v === null) return { number: e.display, unit: '' };
  return { number: formatNumber(v * factor, e.decimals, hass), unit: e.unit };
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

interface Scaled {
  series: TrendSeries;
  y: (v: number) => number;
}

function gradientDefs(scaled: Scaled[], domains: Map<boolean, [number, number]>, options: TrendOptions) {
  return scaled
    .filter(({ series: s }) => s.color === undefined)
    .map(({ series: s }) => {
      const stops = bandStops(s.entity.bands, domains.get(s.secondary)!, options.transition);
      return svg`<linearGradient id="cd-trend-${s.index}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1=${VIEW_H} y2="0">
        ${stops.map((stop) => svg`<stop offset=${stop.offset} stop-color=${stop.color}></stop>`)}
      </linearGradient>`;
    });
}

const paint = (s: TrendSeries) => s.color ?? `url(#cd-trend-${s.index})`;

/** A filled line: the fill closes down to the bottom of the graph, under each unbroken run. */
function lineSeries({ series: s, y }: Scaled, x: (t: number) => number, options: TrendOptions): SVGTemplateResult {
  const parts = runs(s.points).map((run) => {
    const pts = run.map((p): [number, number] => [x(p.t), y(p.v as number)]);
    return { pts, d: runPath(pts, s.curve) };
  });
  const line = s.own.show_line !== false;
  const fill = options.fill !== 'none' && s.own.show_fill !== false;
  const width = s.own.line_width ?? options.lineWidth;
  const dots = s.own.show_points ?? options.points === 'always';
  const real = s.points.filter((p) => p.v !== null && !p.carried);
  return svg`<g class="series" data-series=${s.index}>
    ${
      fill
        ? svg`<path
            class="fill ${options.fill}"
            d=${parts.map(({ pts, d }) => `${d}L${pts[pts.length - 1][0]},${VIEW_H}L${pts[0][0]},${VIEW_H}Z`).join('')}
            fill=${paint(s)}
            mask=${options.fill === 'fade' ? 'url(#cd-trend-fade)' : nothing}
          ></path>`
        : nothing
    }
    ${
      line
        ? svg`<path class="line" d=${parts.map((p) => p.d).join('')} fill="none" stroke=${paint(s)}
            style="stroke-width:${width}px"></path>`
        : nothing
    }
    ${
      dots && real.length <= 200
        ? svg`<path class="dots" d=${dotsPath(real.map((p) => [x(p.t), y(p.v as number)]))} fill="none"
            stroke=${paint(s)} style="stroke-width:${dotSize(width)}px"></path>`
        : nothing
    }
  </g>`;
}

/**
 * Columns, one per bucket, side by side when there are several series, drawn in HTML as on the
 * column chart so their rounded ends stay round. A column coloured by bands takes its own value's
 * band. `spacing` is the gap between buckets, in px.
 */
function columns(scaled: Scaled[], x: (t: number) => number, spacing: number) {
  const n = scaled.length;
  const cols = scaled.flatMap(({ series: s, y }, k) => {
    const zero = Math.min(VIEW_H, Math.max(0, y(0)));
    return s.points
      .filter((p) => p.v !== null && !p.carried && p.start !== undefined && p.end !== undefined)
      .map((p) => {
        const left = x(p.start!) / VIEW_W;
        const slot = (x(p.end!) - x(p.start!)) / VIEW_W;
        const top = Math.min(VIEW_H, Math.max(0, y(p.v as number)));
        const down = top > zero;
        const color = s.color ?? baseColor(bandFor(p.v as number, s.entity.bands).color);
        const width = `(${pct(slot)} - ${spacing}px) / ${n}`;
        return html`<div
          class="trend-col ${down ? 'down' : ''}"
          style="left:calc(${pct(left)} + ${spacing / 2}px + ${k} * ${width});width:max(1px, calc(${width}));
            top:${pct(Math.min(top, zero) / VIEW_H)};height:${pct(Math.abs(zero - top) / VIEW_H)};background:${color}"
        ></div>`;
      });
  });
  return html`<div class="trend-cols">${cols}</div>`;
}

/**
 * A series' name in the legend. The card's `name` is the header's title, and Chartdeck hands it
 * down to every entity, so a series that only has the card's name uses its friendly name instead.
 */
function seriesName(s: TrendSeries, ctx: ChartContext): string {
  const cardName = ctx.raw.name;
  if (cardName === undefined || s.entity.name !== cardName) return s.entity.name;
  return (s.entity.stateObj?.attributes.friendly_name as string | undefined) ?? s.entity.entityId;
}

/** The value at the hovered moment for each series, or nothing when not hovering. */
function hovered(series: TrendSeries[], t: number | undefined) {
  if (t === undefined) return undefined;
  return series.map((s) => {
    const real = s.points.filter((p) => !p.carried);
    const i = nearestIndex(real, t);
    return i < 0 ? undefined : real[i];
  });
}

/** "14:00 – 16:00" for a bucket, the time alone for a reading. */
function whenText(p: TrendPoint, ctx: ChartContext): string {
  if (p.start !== undefined && p.end !== undefined && p.end > p.start) {
    return `${formatTime(p.start, ctx.hass)} – ${formatTime(p.end, ctx.hass)}`;
  }
  return formatTime(p.t, ctx.hass);
}

function icon(e: ResolvedEntity, ctx: ChartContext, options: TrendOptions, color: string) {
  const style = options.colorIcon ? `color:${color}` : '';
  if (options.iconImage) {
    return html`<span class="trend-icon"><img src=${options.iconImage} alt="" /></span>`;
  }
  return html`<span class="trend-icon" style=${style}>
    <ha-state-icon .hass=${ctx.hass} .stateObj=${e.stateObj} .icon=${iconOverride(e)}></ha-state-icon>
  </span>`;
}

/** Low, average and high as chips tinted with the series colour, as on the line chart's highs and lows. */
function infoRow(s: TrendSeries, options: TrendOptions, ctx: ChartContext, weighted: boolean) {
  if (!options.extrema && !options.average) return nothing;
  const x = extrema(s.points, weighted);
  if (!x) return nothing;
  const text = (v: number) => withUnit(formatNumber(v, s.entity.decimals, ctx.hass), s.entity.unit);
  const chip = (key: string, v: number, t?: number) =>
    html`<span class="trend-chip ${key}"
      ><span class="trend-chip-type">${localize(ctx.hass, key)}</span> ${text(v)}${
        t !== undefined ? html` · <span class="trend-chip-time">${formatTime(t, ctx.hass)}</span>` : nothing
      }</span
    >`;
  return html`<div class="trend-info" style="--series:${s.current}">
    ${options.extrema ? chip('trend_min', x.min.v, x.min.t) : nothing}
    ${options.average ? chip('trend_avg', x.mean) : nothing}
    ${options.extrema ? chip('trend_max', x.max.v, x.max.t) : nothing}
  </div>`;
}

function render(ctx: ChartContext): TemplateResult {
  const options = trendOptions(ctx.raw);
  const { show } = ctx.config;
  const frame = historyFrame(ctx);
  const series = trendSeries(frame, ctx, options);
  const primary = series[0];
  const e = primary.entity;
  const graphedSeries = series.filter((s) => s.graphed);
  const t = tooltipEnabled(ctx.raw) && frame.status === 'ready' ? hoverTime(ctx.host) : undefined;
  const at = hovered(series, t);

  // Header: name and icon.
  const nameStyle = options.colorName ? `color:${primary.current}` : '';
  const headerIcon = show.icon && options.alignIcon !== 'state' ? icon(e, ctx, options, primary.current) : nothing;
  const header =
    show.name || headerIcon !== nothing
      ? html`<div
          class="trend-header entity align-${options.alignHeader} icon-${options.alignIcon}"
          data-index="0"
          tabindex="0"
          aria-label=${e.label}
          style=${options.fontSizeHeader ? `font-size:${options.fontSizeHeader}px` : ''}
        >
          ${show.name ? html`<span class="trend-name" style=${nameStyle}>${e.name}</span>` : nothing} ${headerIcon}
        </div>`
      : nothing;

  // States: the primary value large, any others set to show small beside it.
  const stateOf = (s: TrendSeries, i: number) => {
    const p = at?.[i];
    const v = p ? p.v : s.entity.value;
    const parts = p
      ? { number: p.v === null ? '—' : formatNumber(p.v, s.entity.decimals, ctx.hass), unit: s.entity.unit }
      : valueParts(v, s.entity, options.factor, ctx.hass);
    // The colour follows the value shown: the hovered reading's band while hovering.
    const color =
      p && p.v !== null && s.color === undefined ? baseColor(bandFor(p.v, s.entity.bands).color) : s.current;
    return { parts, color, when: p ? whenText(p, ctx) : undefined };
  };
  const big = stateOf(primary, 0);
  const showPrimary = show.value;
  const secondaries = series.slice(1).filter((s) => s.own.show_state === true);
  const states =
    showPrimary || secondaries.length || options.alignIcon === 'state'
      ? html`<div class="trend-states align-${options.alignState}" style="font-size:${options.fontSize}%">
          ${show.icon && options.alignIcon === 'state' ? icon(e, ctx, options, primary.current) : nothing}
          ${
            showPrimary
              ? html`<div class="trend-state entity" data-index="0" tabindex="0" aria-label=${e.label}>
                  ${primary.own.show_indicator ? html`<span class="swatch" style="background:${primary.current}"></span>` : nothing}
                  <span class="trend-value" style=${options.colorValue ? `color:${big.color}` : ''}
                    >${big.parts.number}</span
                  >${big.parts.unit ? html`<span class="trend-unit">${big.parts.unit}</span>` : nothing}
                  ${big.when ? html`<span class="trend-when">${big.when}</span>` : nothing}
                </div>`
              : nothing
          }
          ${
            secondaries.length
              ? html`<div class="trend-secondary">
                  ${secondaries.map((s) => {
                    const st = stateOf(s, s.index);
                    return html`<div
                      class="trend-state small entity"
                      data-index=${s.index}
                      tabindex="0"
                      aria-label=${s.entity.label}
                    >
                      ${s.own.show_indicator !== false ? html`<span class="swatch" style="background:${s.current}"></span>` : nothing}
                      <span class="trend-value" style=${options.colorValue ? `color:${st.color}` : ''}
                        >${st.parts.number}</span
                      >${st.parts.unit ? html`<span class="trend-unit">${st.parts.unit}</span>` : nothing}
                    </div>`;
                  })}
                </div>`
              : nothing
          }
        </div>`
      : nothing;

  const legendItems = graphedSeries.filter((s) => s.own.show_legend !== false);
  // Two or more lines: the row of swatches and names every history chart has.
  const legend =
    options.legend && graphedSeries.length > 1 && legendItems.length
      ? html`<div class="series-header trend-legend">
          ${legendItems.map(
            (s) =>
              html`<div class="entity series-item" data-index=${s.index} tabindex="0" aria-label=${s.entity.label}>
                <span class="swatch" style="background:${s.current}"></span>
                <span class="series-name">${seriesName(s, ctx)}</span>
                ${s.own.show_legend_state ? html`<span class="series-value">${s.entity.display}</span>` : nothing}
              </div>`,
          )}
        </div>`
      : nothing;

  const nav = periodNav(frame, ctx);
  const graph = options.graph === 'none' ? nothing : graphArea(ctx, frame, graphedSeries, options, at);
  return html`<div class="trend ${options.group ? 'group' : ''} ${options.graph === 'none' ? 'no-graph' : ''}">
    <div class="trend-top">
      ${header} ${nav === nothing ? nothing : html`<div class="trend-nav">${nav}</div>`} ${states}
      ${infoRow(primary, options, ctx, frame.source === 'history' && !frame.group && options.pointsPerHour === 0)}
      ${legend}
    </div>
    ${graph}
  </div>`;
}

function graphArea(
  ctx: ChartContext,
  frame: HistoryFrame,
  series: TrendSeries[],
  options: TrendOptions,
  at: (TrendPoint | undefined)[] | undefined,
) {
  const ratio = `aspect-ratio:500 / ${options.height}`;
  if (frame.status !== 'ready' || series.every((s) => s.points.every((p) => p.v === null))) {
    const key =
      frame.status === 'loading' ? 'chart_loading' : frame.status === 'error' ? 'chart_error' : 'chart_no_data';
    return html`<div class="trend-graph message ${frame.status === 'error' ? 'error' : ''}" style=${ratio}>
      <span>${localize(ctx.hass, key, { error: frame.error ?? '' })}</span>
    </div>`;
  }
  const bars = options.graph === 'bar';
  const domains = new Map<boolean, [number, number]>();
  for (const secondary of [false, true]) {
    const group = series.filter((s) => s.secondary === secondary);
    if (!group.length) continue;
    domains.set(
      secondary,
      trendDomain(dataExtent(group), { ...(secondary ? options.secondary : options.primary), fromZero: bars }),
    );
  }
  const x = linear([frame.range.start, frame.range.end], [0, VIEW_W]);
  const scaled: Scaled[] = series.map((s) => ({ series: s, y: linear(domains.get(s.secondary)!, [VIEW_H, 0]) }));
  const content = bars ? svg`` : svg`${scaled.map((sc) => lineSeries(sc, x, options))}`;
  const defs = svg`${gradientDefs(scaled, domains, options)}
    <linearGradient id="cd-trend-fade-paint" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2=${VIEW_H}>
      <stop offset="0" stop-color="#fff" stop-opacity="0.42"></stop>
      <stop offset="1" stop-color="#fff" stop-opacity="0.05"></stop>
    </linearGradient>
    <mask id="cd-trend-fade" maskContentUnits="userSpaceOnUse">
      <rect x="0" y="0" width=${VIEW_W} height=${VIEW_H} fill="url(#cd-trend-fade-paint)"></rect>
    </mask>`;
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_trend'),
    names: series.map((s) => s.entity.name).join(', '),
  });

  // Value labels: the top and bottom of each axis, as pills over the graph's corners.
  const bound = (secondary: boolean) => {
    const group = series.filter((s) => s.secondary === secondary);
    const data = dataExtent(group);
    if (!data) return nothing;
    // The readings' own lowest and highest, not the padded ends; a hard bound shows itself.
    const set = secondary ? options.secondary : options.primary;
    const lo = set.min && !set.min.soft ? set.min.value : data[0];
    const hi = set.max && !set.max.soft ? set.max.value : data[1];
    const e = group[0].entity;
    const f = (v: number) => withUnit(formatNumber(v, e.decimals, ctx.hass), e.unit);
    return html`<div class="trend-labels ${secondary ? 'secondary' : 'primary'}" style="--series:${group[0].current}">
      <span>${f(hi)}</span><span>${f(lo)}</span>
    </div>`;
  };
  const labels =
    options.labels === 'never'
      ? nothing
      : html`<div class="trend-labels-wrap labels-${options.labels}">${bound(false)}${bound(true)}</div>`;

  // Hover: the guide line and a dot on each line at the hovered reading, as on the line chart
  // (bars light up their slot instead, as on the column chart).
  const guide =
    at && !bars && at[series[0].index]
      ? html`<div class="crosshair" style="left:${pct(x(at[series[0].index]!.t) / VIEW_W)}"></div>`
      : nothing;
  const dots =
    at && !bars
      ? scaled.map(({ series: s, y }) => {
          const p = at[s.index];
          if (!p || p.v === null || s.own.show_points === false) return nothing;
          const top = y(p.v) / VIEW_H;
          if (!(top >= 0 && top <= 1)) return nothing;
          const color = s.color ?? baseColor(bandFor(p.v, s.entity.bands).color);
          return html`<span
            class="hover-dot"
            style="left:${pct(x(p.t) / VIEW_W)};top:${pct(top)};background:${color}"
          ></span>`;
        })
      : nothing;
  const marker =
    at && bars && at[series[0].index]
      ? (() => {
          const p = at[series[0].index]!;
          if (p.start === undefined || p.end === undefined) return nothing;
          return html`<div
            class="bar-hover"
            style="left:${pct(x(p.start) / VIEW_W)};width:${pct((x(p.end) - x(p.start)) / VIEW_W)}"
          ></div>`;
        })()
      : nothing;

  const hover = tooltipEnabled(ctx.raw)
    ? hoverHandlers(
        ctx,
        frame.range,
        series.map((s) => s.points.filter((p) => !p.carried)),
      )
    : undefined;
  return html`<div
    class="trend-graph ${hover ? 'hoverable' : ''}"
    style=${ratio}
    @pointerdown=${hover?.move}
    @pointermove=${hover?.move}
    @pointerleave=${hover?.leave}
    @pointercancel=${hover?.leave}
  >
    ${plot(content, label, defs)} ${bars ? columns(scaled, x, options.barSpacing) : nothing} ${labels} ${marker}
    ${guide} ${options.points === 'never' ? nothing : dots}
  </div>`;
}

export const trend: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 170,
  gridOptions: { columns: 6, min_columns: 3, min_rows: 2 },
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .content.style-trend {
      padding: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .content.style-trend > .chart {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    /* The graph sits on the card's bottom edge, its corners cut by the card's rounding. */
    ha-card:has(> .content.style-trend) {
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    ha-card:has(> .content.style-trend .trend.group) {
      box-shadow: none;
      border: none;
      background: none;
    }
    .trend {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .trend-top {
      padding: 16px 16px 0;
    }
    .trend.group .trend-top {
      padding: 0 0 0;
    }
    .trend.no-graph .trend-top {
      padding-bottom: 16px;
    }
    .trend-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      cursor: pointer;
      border-radius: 4px;
      font-size: 14px;
    }
    .trend-header.icon-left {
      flex-direction: row-reverse;
      justify-content: flex-end;
    }
    .trend-header.align-left {
      justify-content: flex-start;
    }
    .trend-header.align-right {
      justify-content: flex-end;
    }
    .trend-header.align-center {
      justify-content: center;
    }
    .trend-name {
      font-size: 1.15em;
      font-weight: 500;
      line-height: 1.4em;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .trend-icon {
      flex: none;
      display: inline-flex;
      color: var(--state-icon-color, #44739e);
    }
    .trend-icon ha-state-icon {
      --mdc-icon-size: 1.7em;
      width: 1.7em;
      height: 1.7em;
    }
    .trend-icon img {
      width: 1.7em;
      height: 1.7em;
      object-fit: contain;
    }
    .trend-states {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0 16px;
      min-width: 0;
      padding-bottom: 4px;
    }
    .trend-states.align-right {
      flex-direction: row-reverse;
    }
    .trend-states.align-center {
      justify-content: space-evenly;
    }
    .trend-states .trend-icon {
      align-self: center;
      font-size: 1.15em;
    }
    .trend-state {
      position: relative;
      display: flex;
      align-items: baseline;
      gap: 4px;
      min-width: 0;
      cursor: pointer;
      border-radius: 4px;
    }
    .trend-state:not(.small) {
      margin-top: 4px;
    }
    .trend-value {
      font-size: 2.25em;
      font-weight: 400;
      line-height: 1.15;
      letter-spacing: -0.01em;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .trend-unit {
      font-size: 1.15em;
      font-weight: 400;
      color: var(--secondary-text-color);
      white-space: nowrap;
    }
    /* While hovering, the reading's time sits after the value. */
    .trend-when {
      align-self: center;
      margin-left: 6px;
      font-size: 0.8125em;
      color: var(--secondary-text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .trend-secondary {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 0;
      padding-top: 8px;
    }
    .trend-states.align-right .trend-secondary {
      align-items: flex-start;
    }
    .trend-state.small {
      align-items: center;
      gap: 6px;
    }
    .trend-state.small .trend-value {
      font-size: 1em;
      font-weight: 500;
      letter-spacing: 0;
    }
    .trend-state.small .trend-unit {
      font-size: 0.875em;
    }
    .trend-state .swatch {
      align-self: center;
    }
    /* Low, average and high, as the line chart's highs and lows. */
    .trend-info {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 2px 0 8px;
    }
    .trend-chip {
      height: 20px;
      box-sizing: border-box;
      padding: 0 8px;
      border-radius: 10px;
      font-size: 11px;
      line-height: 20px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--series) 16%, var(--card-background-color, #fff));
    }
    .trend-chip.trend_avg {
      color: var(--secondary-text-color);
      background: color-mix(in srgb, var(--primary-text-color) 6%, var(--card-background-color, #fff));
    }
    .trend-chip-type {
      font-weight: 500;
    }
    .trend-chip-time {
      color: var(--secondary-text-color);
    }
    .trend-legend {
      padding: 0 0 6px;
    }
    .trend .entity:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .trend-graph {
      position: relative;
      margin-top: auto;
      width: 100%;
      max-height: 400px;
    }
    .trend-graph.hoverable {
      touch-action: pan-y;
      cursor: crosshair;
    }
    .trend-graph.message {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--secondary-text-color);
      font-size: 0.875em;
      min-height: 48px;
    }
    .trend-graph.message.error {
      color: var(--error-color, #db4437);
    }
    .trend-graph .plot {
      overflow: hidden;
    }
    .style-trend .line {
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .style-trend .dots {
      stroke-linecap: round;
    }
    .style-trend .fill.solid {
      fill-opacity: 0.2;
    }
    /* Columns as on the column chart: rounded at the outer end, growing in from the base. */
    .trend-cols {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .trend-col {
      position: absolute;
      box-sizing: border-box;
      border-radius: 4px 4px 0 0;
      transform-origin: 50% 100%;
      animation: cd-trend-grow var(--cd-duration) var(--cd-easing);
    }
    .trend-col.down {
      border-radius: 0 0 4px 4px;
      transform-origin: 50% 0;
    }
    :host([static]) .trend-col {
      animation: none;
    }
    @keyframes cd-trend-grow {
      from {
        transform: scaleY(0);
      }
    }
    .trend-labels-wrap {
      position: absolute;
      inset: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 1;
    }
    .trend-labels-wrap.labels-hover {
      opacity: 0;
    }
    .trend-graph:hover .trend-labels-wrap.labels-hover,
    .trend-graph:active .trend-labels-wrap.labels-hover {
      opacity: 1;
    }
    .trend-labels {
      position: absolute;
      top: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-start;
      padding: 6px 8px;
      box-sizing: border-box;
    }
    .trend-labels.primary {
      left: 0;
    }
    .trend-labels.secondary {
      right: 0;
      align-items: flex-end;
    }
    /* Tinted with the series colour, as the line chart's high and low labels. */
    .trend-labels span {
      height: 18px;
      box-sizing: border-box;
      padding: 0 6px;
      border-radius: 9px;
      font-size: 11px;
      line-height: 18px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--series) 16%, var(--card-background-color, #fff));
    }
    .trend-graph .crosshair {
      z-index: 1;
      pointer-events: none;
    }
    .trend-graph .hover-dot {
      z-index: 2;
      pointer-events: none;
    }
    .bar-hover {
      position: absolute;
      top: 0;
      bottom: 0;
      background: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
      pointer-events: none;
    }
  `,
  thumbnail: () => svg`
    <rect x="6" y="6" width="18" height="3" rx="1.5" fill="var(--secondary-text-color, #727272)" />
    <circle cx="55" cy="8" r="3.5" fill="var(--state-icon-color, #44739e)" />
    <rect x="6" y="13" width="22" height="7" rx="2" fill="var(--primary-text-color, #212121)" />
    <path d="M0 33 C10 36 14 26 24 27 S38 29 44 25 S56 21 64 24 V40 H0 Z"
      fill="var(--primary-color, #03a9f4)" fill-opacity="0.2" />
    <path d="M0 33 C10 36 14 26 24 27 S38 29 44 25 S56 21 64 24" fill="none"
      stroke="var(--primary-color, #03a9f4)" stroke-width="2.5" stroke-linecap="round" />`,
  validate: validateTrend,
  editor: trendEditor,
  entityFields: trendEntityFields,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render,
};
