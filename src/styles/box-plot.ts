import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { axisOptions, timeLabel, timeZoneOf, validateAxisOptions, valueAxis, hour12Of } from '../chart/axes';
import { MAX_OUTLIERS, WHISKERS, boxStats, heldSamples, jitter, rowSamples, spread } from '../chart/box';
import type { BoxStats, Sample, Whiskers } from '../chart/box';
import {
  SERIES_COLORS,
  VIEW_H,
  VIEW_W,
  disconnectHistory,
  frameMessage,
  frameStyles,
  periodNav,
  seriesHeader,
  seriesTransform,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartArea, chartWidth, gridStyles, plotWidth, stopChartWidth } from '../chart/grid';
import type { PlotAxes } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { withLegend } from '../chart/legend-toggle';
import { linear } from '../chart/scale';
import { dotsPath } from '../chart/series-style';
import { tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import { pickHandlers, pickStyles, pickTooltip, pickedIndex, stopPick, xDecimals } from '../chart/xy';
import type { PickRow } from '../chart/xy';
import {
  AXES_FIELDS,
  HISTORY_FIELDS,
  LAYOUT_FIELDS,
  axesSchema,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  historyVariant,
  layoutSchema,
} from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { key } from '../history/fetch';
import type { StatisticsQuery } from '../history/fetch';
import { statisticsPeriod } from '../history/fetch';
import { parseGrouping } from '../history/group';
import type { GroupUnit } from '../history/group';
import { parsePeriod, periodRange, stepsFor } from '../history/period';
import { storeFor } from '../history/store';
import { convertPoints } from '../units';
import { chartConditions, conditionStatus, conditionalPoints } from '../history/condition';
import { boundaries, startOf, zoneFor } from '../history/timezone';
import type { Range, Source } from '../history/types';
import { localize } from '../localize';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const ORIENTATIONS = ['vertical', 'horizontal'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** Readings drawn per box when `readings: true`; more are thinned evenly. */
const MAX_READINGS = 120;
/** Widest a box gets, in px, however few there are. */
const MAX_BOX_PX = 44;
/** Share of a category's room the boxes take together; the rest is the gap between categories. */
const SLOT = 0.72;

type BoxRaw = CardConfig & { orientation?: unknown; whiskers?: unknown; readings?: unknown };

/** One box: where it sits (category, and its slot among the series there) and what it shows. */
export interface Box {
  category: number;
  slot: number;
  series: ChartSeries;
  stats: BoxStats;
  /** The values drawn as dots when the card shows each reading (thinned). */
  readings: number[];
}

export interface BoxFrame extends HistoryFrame {
  /** Group boundaries when grouped (each start, then the last end); else empty. */
  bounds: number[];
  unit?: GroupUnit;
  until: number;
}

/**
 * Load the card's readings as they were recorded: never grouped into one value per group (a box
 * needs every reading in it). Grouped, the range starts where its first group does. Statistics
 * come in hours (five minutes for hourly boxes) so each box has rows to spread.
 */
export function boxFrame(ctx: ChartContext, now = Date.now()): BoxFrame {
  const period = parsePeriod(ctx.raw.period as CardConfig['period']);
  const source: Source = (ctx.raw.source as Source | undefined) ?? 'history';
  const zone = zoneFor(ctx.hass);
  const span = periodRange(period, now, zone, period.navigate ? stepsFor(ctx.host, period) : 0);
  const group = parseGrouping(ctx.raw);
  const range: Range = { start: group ? startOf(group.unit, span.start, zone) : span.start, end: span.end };
  const requests = ctx.items.map((e) => ({ entity: e.entityId, attribute: e.config.attribute }));
  const statistics: StatisticsQuery | undefined =
    source === 'statistics'
      ? {
          period: group ? (group.unit === 'hour' ? '5minute' : 'hour') : statisticsPeriod(range),
          types: ['mean', 'min', 'max'],
          value: 'mean',
        }
      : undefined;
  const loaded = storeFor(ctx.host, ctx.requestUpdate).get(ctx.hass, requests, range, source, {
    live: span.live,
    statistics,
  });
  // Series with a `when` (their own or the card's) keep only the readings taken while it held.
  const conditions = chartConditions(ctx, range, span.live);
  const series = ctx.items.map((entity, index): ChartSeries => {
    const own = entity.config as typeof entity.config & { color?: string };
    return {
      index,
      entity,
      points: conditionalPoints(
        entity.config,
        convertPoints(loaded.data.get(key(requests[index])) ?? [], entity.conversion),
        conditions,
      ),
      color: baseColor(own.color ?? SERIES_COLORS[index % SERIES_COLORS.length]),
      curve: 'straight',
      dash: false,
    };
  });
  // Each entity's history transform (running total, rate of change), on its readings before boxing.
  const until = Math.min(range.end, now);
  for (const s of series) Object.assign(s, seriesTransform(s.entity, s.points, range, until, zone, ctx.hass));
  return {
    status: conditionStatus(loaded.status, conditions),
    error: loaded.error,
    range,
    period,
    source,
    series,
    live: span.live,
    back: span.back,
    zone,
    bounds: group ? boundaries(group.unit, range.start, range.end, zone) : [],
    unit: group?.unit,
    until,
  };
}

/** Every box to draw: one per series per group, or one per series when not grouped. */
export function boxesOf(frame: BoxFrame, whiskers: Whiskers): { boxes: Box[]; categories: number; slots: number } {
  const grouped = frame.bounds.length > 1;
  const spans: [number, number][] = grouped
    ? frame.bounds.slice(0, -1).map((start, i) => [start, frame.bounds[i + 1]])
    : [[frame.range.start, frame.range.end]];
  const boxes: Box[] = [];
  spans.forEach(([start, end], g) => {
    const stop = Math.min(end, frame.until);
    frame.series.forEach((s, j) => {
      let samples: Sample[];
      let extremes: [number, number] | undefined;
      if (frame.source === 'statistics') ({ samples, extremes } = rowSamples(s.points, start, stop));
      else samples = heldSamples(s.points, start, stop);
      const stats = boxStats(samples, whiskers, extremes);
      if (!stats) return;
      boxes.push({
        category: grouped ? g : j,
        slot: grouped ? j : 0,
        series: s,
        stats,
        readings: spread(
          samples.map((x) => x.v),
          MAX_READINGS,
        ),
      });
    });
  });
  return { boxes, categories: grouped ? spans.length : frame.series.length, slots: grouped ? frame.series.length : 1 };
}

/** Keep every `step`-th category label so they fit `room` labels. */
export function categoryTicks(count: number, room: number): number[] {
  const step = Math.max(1, Math.ceil(count / Math.max(1, room)));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/**
 * Axes with the categories along one side and values along the other. Upright boxes put the
 * categories along the bottom (as `times`); boxes on their side put them up the side (as value
 * ticks, first at the top). Gridlines follow the value labels whichever way the chart is turned:
 * "lines across" draws at each value label, "lines down" at each category.
 */
export function boxAxes(
  ctx: ChartContext,
  orientation: Orientation,
  categories: number,
  data: [number, number] | undefined,
  labelPx: number,
  sidePx = 0,
): PlotAxes {
  const options = axisOptions(ctx.raw);
  const fixed = { min: options.min, max: options.max };
  const cat: [number, number] = [-0.5, categories - 0.5];
  if (orientation === 'vertical') {
    const width = plotWidth(ctx);
    const value = valueAxis(data, fixed, 4);
    return {
      options,
      value,
      times: categoryTicks(categories, Math.floor(width / labelPx)),
      unit: 'day',
      range: { start: cat[0], end: cat[1] },
      scales: { x: linear(cat, [0, VIEW_W]), y: linear(value.domain, [VIEW_H, 0]), domain: value.domain },
    };
  }
  // The category names take a column of their own beside the plot.
  const width = chartWidth(ctx) - 32 - (options.y && options.labels === 'outside' ? sidePx : 0);
  const count = Math.max(2, Math.min(8, Math.round(width / 70)));
  const x = valueAxis(data, fixed, count);
  const rows = ctx.raw.compact === true ? 6 : 10;
  return {
    options: { ...options, horizontal: options.vertical, vertical: options.horizontal },
    value: { domain: cat, ticks: categoryTicks(categories, rows), decimals: 0 },
    times: x.ticks,
    unit: 'day',
    range: { start: x.domain[0], end: x.domain[1] },
    scales: { x: linear(x.domain, [0, VIEW_W]), y: linear(cat, [0, VIEW_H]), domain: cat },
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A group's name for its tooltip: "Tue 29 Oct, 14:00", "Tue 29 Oct", "October 2026". */
function groupTitle(t: number, unit: GroupUnit, hass: ChartContext['hass']): string {
  const opts: Intl.DateTimeFormatOptions =
    unit === 'month'
      ? { month: 'long', year: 'numeric' }
      : unit === 'hour'
        ? {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: hour12Of(hass),
          }
        : { weekday: unit === 'day' ? 'short' : undefined, day: 'numeric', month: 'short' };
  const language = hass?.locale?.language ?? 'en';
  const k = `${language}|${unit}|${timeZoneOf(hass)}|${opts.hour12}`;
  let f = formatters.get(k);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(language, { ...opts, timeZone: timeZoneOf(hass) });
    } catch {
      f = new Intl.DateTimeFormat('en', opts);
    }
    formatters.set(k, f);
  }
  return f.format(t);
}

/** A group's short name under its box: as the time axis would label it. */
function groupLabel(frame: BoxFrame, i: number, hass: ChartContext['hass']): string {
  const t = frame.bounds[i];
  const span = frame.range.end - frame.range.start;
  if (frame.unit === 'hour') return timeLabel(t, 'hour', span, hass);
  if (frame.unit === 'month') return timeLabel(t, 'month', span, hass);
  return timeLabel(t, 'day', frame.unit === 'week' ? Infinity : span, hass);
}

const shorten = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Where a box's centre and half-width sit along the category axis, in category units. */
export function boxPlace(box: Pick<Box, 'category' | 'slot'>, slots: number, maxHalf: number) {
  const width = SLOT / slots;
  return { centre: box.category - SLOT / 2 + width * (box.slot + 0.5), half: Math.min(width * 0.4, maxHalf) };
}

/**
 * Which box the pointer is on, from its position along the category axis (a fraction): the
 * category under it, then the series' slot within. Undefined in a gap or where there's no box.
 */
export function pickBox(boxes: readonly Box[], categories: number, slots: number, along: number): number | undefined {
  const at = along * categories - 0.5;
  const category = Math.min(categories - 1, Math.max(0, Math.round(at)));
  const within = at - category + SLOT / 2;
  if (slots > 1 && (within < 0 || within >= SLOT)) return undefined;
  const slot = Math.min(slots - 1, Math.max(0, Math.floor(within / (SLOT / slots))));
  const i = boxes.findIndex((b) => b.category === category && b.slot === slot);
  return i < 0 ? undefined : i;
}

function drawBox(
  box: Box,
  place: { centre: number; half: number },
  at: (c: number, v: number) => [number, number],
  showReadings: boolean,
): SVGTemplateResult {
  const { stats, series } = box;
  const { centre: c, half } = place;
  const line = (a: [number, number], b: [number, number], cls: string) =>
    svg`<line class=${cls} x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line>`;
  const [x0, y0] = at(c - half, stats.q1);
  const [x1, y1] = at(c + half, stats.q3);
  const readings =
    showReadings && box.readings.length
      ? svg`<path class="readings" d=${dotsPath(box.readings.map((v, k) => at(c + jitter(k) * half * 0.8, v)))}></path>`
      : nothing;
  return svg`<g class="box" data-series=${series.index} style="--box-color:${series.color}">
    ${line(at(c, stats.low), at(c, stats.q1), 'whisker')}
    ${line(at(c, stats.q3), at(c, stats.high), 'whisker')}
    ${line(at(c - half / 2, stats.low), at(c + half / 2, stats.low), 'cap')}
    ${line(at(c - half / 2, stats.high), at(c + half / 2, stats.high), 'cap')}
    <rect
      class="body"
      x=${Math.min(x0, x1)}
      y=${Math.min(y0, y1)}
      width=${Math.abs(x1 - x0)}
      height=${Math.abs(y1 - y0)}
    ></rect>
    ${readings}
    ${line(at(c - half, stats.median), at(c + half, stats.median), 'median')}
    ${stats.outliers.length ? svg`<path class="outliers" d=${dotsPath(stats.outliers.map((v) => at(c, v)))}></path>` : nothing}
  </g>`;
}

function validate(raw: CardConfig): void {
  validateHistoryOptions(raw);
  validateAxisOptions(raw);
  validateTooltipOptions(raw);
  validateLayout(raw);
  const r = raw as BoxRaw;
  if (r.orientation !== undefined && !ORIENTATIONS.includes(r.orientation as Orientation)) {
    throw new Error(`"orientation" must be one of: ${ORIENTATIONS.join(', ')}`);
  }
  if (r.whiskers !== undefined && !WHISKERS.includes(r.whiskers as Whiskers)) {
    throw new Error(`"whiskers" must be one of: ${WHISKERS.join(', ')}`);
  }
  if (r.readings !== undefined && typeof r.readings !== 'boolean') throw new Error('"readings" must be true or false');
}

const BOX_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'orientation', path: ['orientation'], default: 'vertical' },
  { name: 'whiskers', path: ['whiskers'], default: 'tukey' },
  { name: 'readings', path: ['readings'], default: false },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

/** The Chart section: period and source, one box per group or per entity, the boxes' look, axes, layout. */
export function boxEditor(ctx: ChartEditorContext): TemplateResult {
  // Boxes need every reading, not one combined value per group: no "combine with" choice.
  const ungrouped = { ...ctx.config, group_by: undefined };
  const schema = cachedSchema(`box|${historyVariant(ungrouped)}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ungrouped),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'orientation', selector: choice(ctx.hass, 'orientation', ORIENTATIONS) },
        { name: 'whiskers', selector: choice(ctx.hass, 'whiskers', WHISKERS) },
      ],
    },
    { name: 'readings', selector: { boolean: {} } },
    ...axesSchema(ctx.hass),
    ...layoutSchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, BOX_FIELDS);
}

const ENTITY_SCHEMA = [{ name: 'box_color', selector: { text: {} } }];
const ENTITY_FIELDS: FieldBinding[] = [{ name: 'box_color', path: ['color'] }];

export const box: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${pickStyles}
    .style-box .box line {
      stroke: var(--box-color);
      stroke-width: 1.5;
    }
    .style-box .box .median {
      stroke-width: 3;
    }
    .style-box .box .body {
      fill: color-mix(in srgb, var(--box-color) 22%, transparent);
      stroke: var(--box-color);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .style-box .box .outliers {
      fill: none;
      stroke: var(--box-color);
      stroke-width: 6px;
      stroke-linecap: round;
    }
    .style-box .box .readings {
      fill: none;
      stroke: var(--box-color);
      stroke-width: 4px;
      stroke-linecap: round;
      opacity: 0.45;
    }
  `,
  thumbnail: () => svg`
    <g stroke="var(--primary-color, #03a9f4)" stroke-width="2" fill="none" stroke-linecap="round">
      <line x1="16" y1="4" x2="16" y2="12" /><line x1="16" y1="28" x2="16" y2="36" />
      <rect x="9" y="12" width="14" height="16" rx="1.5"
        fill="color-mix(in srgb, var(--primary-color, #03a9f4) 25%, transparent)" />
      <line x1="9" y1="19" x2="23" y2="19" stroke-width="3" />
      <line x1="44" y1="8" x2="44" y2="16" /><line x1="44" y1="27" x2="44" y2="32" />
      <rect x="37" y="16" width="14" height="11" rx="1.5"
        fill="color-mix(in srgb, var(--primary-color, #03a9f4) 25%, transparent)" />
      <line x1="37" y1="22" x2="51" y2="22" stroke-width="3" />
      <circle cx="44" cy="4" r="1.6" fill="var(--primary-color, #03a9f4)" />
    </g>`,
  validate,
  editor: boxEditor,
  entityFields: () => ({ schema: ENTITY_SCHEMA, fields: ENTITY_FIELDS }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopPick(host);
  },
  render(ctx) {
    const frame = withLegend(boxFrame(ctx), ctx);
    const nav = periodNav(frame, ctx);
    const names = seriesHeader(frame, ctx);
    const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
    const layout = chartLayout(ctx.raw);
    const message = frameMessage(frame, ctx);
    if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
    const raw = ctx.raw as BoxRaw;
    const orientation = (raw.orientation as Orientation | undefined) ?? 'vertical';
    const whiskers = (raw.whiskers as Whiskers | undefined) ?? 'tukey';
    const { boxes, categories, slots } = boxesOf(frame, whiskers);
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of boxes) {
      lo = Math.min(lo, b.stats.low, ...b.stats.outliers, ...(raw.readings === true ? b.readings : []));
      hi = Math.max(hi, b.stats.high, ...b.stats.outliers, ...(raw.readings === true ? b.readings : []));
    }
    const grouped = frame.bounds.length > 1;
    const vertical = orientation === 'vertical';
    // Every entity is named; under upright boxes, cut to the room each one has (about 6.5 px a letter).
    const room = vertical ? Math.max(4, Math.floor(plotWidth(ctx) / Math.max(1, categories) / 6.5)) : 16;
    const categoryName = (i: number) =>
      grouped ? groupLabel(frame, i, ctx.hass) : shorten(frame.series[i]?.entity.name ?? '', room);
    const longest = Math.max(0, ...Array.from({ length: categories }, (_, i) => categoryName(i).length));
    const axes = boxAxes(
      ctx,
      orientation,
      categories,
      boxes.length ? [lo, hi] : undefined,
      grouped ? 56 : 1,
      longest * 6 + 12,
    );
    const cs = vertical ? axes.scales.x : axes.scales.y;
    const vs = vertical ? axes.scales.y : axes.scales.x;
    const at = (c: number, v: number): [number, number] => (vertical ? [cs(c), vs(v)] : [vs(v), cs(c)]);
    // Along the category axis, how many category units make MAX_BOX_PX / 2.
    const alongPx = vertical ? plotWidth(ctx) : layout.compact ? 110 : 160;
    const maxHalf = alongPx > 0 ? (MAX_BOX_PX / 2) * (categories / alongPx) : Infinity;
    const content = svg`${boxes.map((b) => drawBox(b, boxPlace(b, slots, maxHalf), at, raw.readings === true))}`;
    const label = localize(ctx.hass, 'box_aria', { names: frame.series.map((s) => s.entity.name).join(', ') });
    const tooltip = tooltipEnabled(ctx.raw);
    const picked = tooltip ? pickedIndex(ctx.host) : undefined;
    const fmt = (b: Box, v: number) =>
      withUnit(formatNumber(v, b.series.entity.decimals, ctx.hass), b.series.entity.unit);
    let tip: TemplateResult | typeof nothing = nothing;
    const box = picked === undefined ? undefined : boxes[picked];
    if (box) {
      const t = (k: string) => localize(ctx.hass, k);
      const { stats } = box;
      const rows: PickRow[] = [
        { name: t('box_highest'), value: fmt(box, stats.max) },
        { name: t('box_upper_quartile'), value: fmt(box, stats.q3) },
        { name: t('box_median'), value: fmt(box, stats.median), color: box.series.color },
        { name: t('box_lower_quartile'), value: fmt(box, stats.q1) },
        { name: t('box_lowest'), value: fmt(box, stats.min) },
        { name: t('box_mean'), value: fmt(box, stats.mean) },
        { name: t('box_count'), value: String(stats.count) },
      ];
      if (stats.outliers.length) {
        const n = stats.outliers.length;
        rows.push({ name: t('box_outliers'), value: n >= MAX_OUTLIERS ? `${n}+` : String(n) });
      }
      const place = boxPlace(box, slots, maxHalf);
      const title = grouped
        ? `${groupTitle(frame.bounds[box.category], frame.unit!, ctx.hass)}${slots > 1 ? ` · ${box.series.entity.name}` : ''}`
        : box.series.entity.name;
      tip = vertical
        ? pickTooltip({
            x: cs(place.centre) / VIEW_W,
            y: vs(stats.median) / VIEW_H,
            plotWidth: plotWidth(ctx),
            title,
            rows,
            band: [cs(box.category - 0.5) / VIEW_W, cs(box.category + 0.5) / VIEW_W],
          })
        : pickTooltip({
            x: vs(stats.high) / VIEW_W,
            y: cs(place.centre) / VIEW_H,
            plotWidth: plotWidth(ctx),
            title,
            rows,
          });
    }
    return chartFrame(
      layout,
      header,
      chartArea({
        axes,
        ctx,
        content,
        label,
        overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}${tip}`,
        hover: tooltip
          ? pickHandlers(ctx, (fx, fy) => pickBox(boxes, categories, slots, vertical ? fx : fy))
          : undefined,
        ...(vertical
          ? { xLabel: categoryName }
          : { yLabel: categoryName, xLabel: (v: number) => formatNumber(v, xDecimals(axes), ctx.hass) }),
      }),
    );
  },
};
