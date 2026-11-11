import { css, html, nothing, svg } from 'lit';
import { nowMarkerLayer, nowMarkerStyles, stopNowMarker, validateNowMarker } from '../chart/now-marker';
import { NOW_MARKER_FIELDS, nowMarkerSchema } from '../editor/now-marker-editor';
import type { TemplateResult } from 'lit';
import { baseColor, bandFor } from '../bands';
import { formatDateTime, formatTime, timeLabel, timeZoneOf, validateAxisOptions } from '../chart/axes';
import type { TimeUnit } from '../chart/axes';
import {
  COLUMN_AGGREGATES,
  COLUMN_GROUPS,
  COLUMN_PERIOD,
  columnBox,
  columnRaw,
  columnTable,
  labelEvery,
  spread,
  zeroBased,
} from '../chart/columns';
import type { ColumnTable } from '../chart/columns';
import {
  ERROR_BARS,
  errorBarStyles,
  errorBarsOf,
  fitsAggregate,
  validateErrorBars,
  whiskerMark,
  whiskersFor,
} from '../chart/error-bars';
import type { Whisker } from '../chart/error-bars';
import {
  VIEW_H,
  VIEW_W,
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  seriesHeader,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartArea, gridStyles, plotAxes, plotWidth, stopChartWidth } from '../chart/grid';
import type { PlotAxes, PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { STACK_MODES, stackExtent, stackValues, totals, validateStack } from '../chart/stack';
import type { Layer, StackMode } from '../chart/stack';
import {
  hoverHandlers,
  hoverTime,
  sharedUnit,
  stopHover,
  tooltipEnabled,
  tooltipLayer,
  tooltipStyles,
  totalRow,
  validateTooltipOptions,
} from '../chart/tooltip';
import type { TooltipOptions } from '../chart/tooltip';
import {
  AXES_FIELDS,
  ENERGY_SPLIT_FIELD,
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
import { shownValue } from '../history/energy';
import type { Aggregate, GroupUnit } from '../history/group';
import type { Point } from '../history/types';
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

/** Above this many columns, none get value labels: they would overlap. */
const MAX_LABELS = 60;
/** A column narrower than this (px) has no room for its value label. */
const LABEL_PX = 24;
/** Room each group label needs under the chart, in px: clock times are the widest. */
const GROUP_LABEL_PX: Record<GroupUnit, number> = { hour: 66, day: 52, week: 52, month: 60 };
/** Corner radius of a column's outer end, in px, before narrow columns scale it down. */
const RADIUS_PX = 4;

const isColumnGroup = (v: unknown) => COLUMN_GROUPS.includes(v as (typeof COLUMN_GROUPS)[number]);

/** Check the column chart's options, with its own grouping choices taken out first. */
function validate(raw: CardConfig): void {
  validateNowMarker(raw);
  if (raw.group_by !== undefined && !isColumnGroup(raw.group_by)) {
    throw new Error(`"group_by" must be one of: ${COLUMN_GROUPS.join(', ')}`);
  }
  if (raw.aggregate !== undefined && !COLUMN_AGGREGATES.includes(raw.aggregate as (typeof COLUMN_AGGREGATES)[number])) {
    throw new Error(`"aggregate" must be one of: ${COLUMN_AGGREGATES.join(', ')}`);
  }
  const shared: Record<string, unknown> = { ...raw };
  if (raw.group_by === 'auto' || raw.group_by === 'none') delete shared.group_by;
  if (raw.aggregate === 'auto') delete shared.aggregate;
  validateHistoryOptions(shared as CardConfig);
  validateAxisOptions(raw);
  validateTooltipOptions(raw);
  validateLayout(raw);
  validateStack(raw);
  validateErrorBars(raw);
  for (const k of ['range', 'rounded', 'labels']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  if (raw.color_by !== undefined && raw.color_by !== 'series' && raw.color_by !== 'bands') {
    throw new Error('"color_by" must be one of: series, bands');
  }
}

/** The time unit whose labels name a group: a week is named by its first day. */
const LABEL_UNIT: Record<GroupUnit, TimeUnit> = { hour: 'hour', day: 'day', week: 'day', month: 'month' };

/** A group's full name for the tooltip: "Tue 29 Oct, 14:00 – 15:00", "Tue 29 Oct", "26 Oct – 1 Nov", "October 2026". */
export function groupHeading(start: number, end: number, unit: GroupUnit, hass: HomeAssistant | undefined): string {
  if (unit === 'hour') return `${formatDateTime(start, hass)} – ${formatTime(end, hass)}`;
  const options: Intl.DateTimeFormatOptions =
    unit === 'day'
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : unit === 'week'
        ? { day: 'numeric', month: 'short' }
        : { month: 'long', year: 'numeric' };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(hass?.locale?.language ?? 'en', { ...options, timeZone: timeZoneOf(hass) });
  } catch {
    format = new Intl.DateTimeFormat('en', options);
  }
  return unit === 'week' ? format.formatRange(start, end - 1) : format.format(start);
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 10000) / 100}%`;
const clampY = (y: number) => Math.min(VIEW_H, Math.max(0, y));

interface Drawn {
  columns: TemplateResult[];
  labels: TemplateResult[];
  targets: TemplateResult[];
}

/** A column from `lo` to `hi` (values), `left`/`width` in plot units, with its outer end(s) rounded. */
export function column(
  scales: PlotScales,
  left: number,
  width: number,
  lo: number,
  hi: number,
  color: string,
  cap: 'top' | 'bottom' | 'both' | '',
  series: number,
) {
  const top = clampY(scales.y(hi));
  const bottom = clampY(scales.y(lo));
  return html`<div
    class="col ${cap ? `cap-${cap}` : ''} ${hi <= 0 && cap !== 'both' ? 'down' : ''}"
    data-series=${series}
    style="left:${pct(left, VIEW_W)};width:${pct(width, VIEW_W)};top:${pct(top, VIEW_H)};height:${pct(
      bottom - top,
      VIEW_H,
    )};background:${color}"
  ></div>`;
}

function valueLabel(ctx: ChartContext, x: number, y: number, v: number, decimals: number, below: boolean) {
  return html`<span
    class="point-label col-label ${below ? 'below' : ''}"
    style="left:${pct(x, VIEW_W)};top:${pct(clampY(y), VIEW_H)}"
    >${formatNumber(v, decimals, ctx.hass)}</span
  >`;
}

function targetMark(scales: PlotScales, left: number, width: number, target: number) {
  const y = scales.y(target);
  if (y < 0 || y > VIEW_H) return html``;
  return html`<div
    class="target-mark"
    style="left:${pct(left - width * 0.1, VIEW_W)};width:${pct(width * 1.2, VIEW_W)};top:${pct(y, VIEW_H)}"
  ></div>`;
}

/** Everything drawn in the plot: columns, their labels and target marks. */
function drawColumns(
  ctx: ChartContext,
  frame: HistoryFrame,
  table: ColumnTable,
  scales: PlotScales,
  mode: StackMode,
  layers: Layer[][] | undefined,
  whiskers?: (Whisker | null)[][],
): Drawn {
  const raw = ctx.raw;
  const series = frame.series;
  const n = series.length;
  const range = raw.range === true;
  const byBands = raw.color_by === 'bands';
  const px = plotWidth(ctx) / VIEW_W;
  const showLabels = raw.labels === true && mode !== 'percent' && table.times.length * (layers ? 1 : n) <= MAX_LABELS;
  const showTargets = ctx.config.show.target && mode !== 'percent';
  const baseline = Math.min(Math.max(0, scales.domain[0]), scales.domain[1]);
  const colorOf = (s: ChartSeries, v: number) => (byBands ? baseColor(bandFor(v, s.entity.bands).color) : s.color);
  const out: Drawn = { columns: [], labels: [], targets: [] };
  const sums = layers ? totals(table.values) : [];
  table.times.forEach((t, i) => {
    const x0 = scales.x(t);
    const x1 = scales.x(table.ends[i]);
    if (layers) {
      const [left, width] = columnBox(x0, x1, 0, 1);
      // The outermost slice each way gets the rounded end.
      let up = -1;
      let down = -1;
      layers.forEach((l, k) => {
        const layer = l[i];
        if (layer && layer[1] > layer[0]) up = k;
        if (layer && layer[1] < layer[0]) down = k;
      });
      layers.forEach((l, k) => {
        const layer = l[i];
        if (!layer || layer[0] === layer[1]) return;
        const v = table.values[k][i] as number;
        const cap = k === up ? 'top' : k === down ? 'bottom' : '';
        out.columns.push(
          column(scales, left, width, Math.min(...layer), Math.max(...layer), colorOf(series[k], v), cap, k),
        );
      });
      const sum = sums[i];
      if (showLabels && sum !== null && width * px >= LABEL_PX) {
        const end =
          sum >= 0
            ? Math.max(0, ...layers.map((l) => l[i]?.[1] ?? 0))
            : Math.min(0, ...layers.map((l) => l[i]?.[1] ?? 0));
        const decimals = Math.max(...series.map((s) => s.entity.decimals));
        out.labels.push(valueLabel(ctx, left + width / 2, scales.y(end), sum, decimals, sum < 0));
      }
      const target = series[0].entity.target;
      if (showTargets && target !== null) out.targets.push(targetMark(scales, left, width, target));
      return;
    }
    series.forEach((s, k) => {
      const v = table.values[k][i];
      if (v === null) return;
      const [left, width] = columnBox(x0, x1, k, n);
      if (range) {
        const lo = table.lows[k][i] ?? v;
        const hi = table.highs[k][i] ?? v;
        out.columns.push(column(scales, left, width, lo, hi, colorOf(s, v), 'both', k));
        out.columns.push(
          html`<div
            class="col-mark"
            style="left:${pct(left, VIEW_W)};width:${pct(width, VIEW_W)};top:${pct(clampY(scales.y(v)), VIEW_H)}"
          ></div>`,
        );
      } else {
        out.columns.push(
          column(
            scales,
            left,
            width,
            Math.min(baseline, v),
            Math.max(baseline, v),
            colorOf(s, v),
            v >= baseline ? 'top' : 'bottom',
            k,
          ),
        );
        if (showLabels && width * px >= LABEL_PX) {
          const shown = shownValue(s.entity, v);
          out.labels.push(valueLabel(ctx, left + width / 2, scales.y(v), shown, s.entity.decimals, v < baseline));
        }
        const whisker = whiskers?.[k][i];
        if (whisker) out.columns.push(whiskerMark(scales, left + width / 2, width * 0.4, whisker));
      }
      if (showTargets && s.entity.target !== null) out.targets.push(targetMark(scales, left, width, s.entity.target));
    });
  });
  return out;
}

function render(ctx0: ChartContext): TemplateResult {
  // The column chart's defaults (7 days, grouped to fit) filled in, for the shared frame to read.
  const ctx = { ...ctx0, raw: columnRaw(ctx0.raw, ctx0.items) };
  const raw = ctx.raw;
  const range = raw.range === true;
  // Error bars: on side-by-side grouped columns whose aggregate they fit (see error-bars.ts).
  const errorMode = errorBarsOf(raw);
  const errorBars =
    errorMode &&
    !range &&
    (raw.stack ?? 'none') === 'none' &&
    raw.group_by !== undefined &&
    fitsAggregate(errorMode, raw.aggregate as Aggregate)
      ? errorMode
      : undefined;
  const now = Date.now();
  const frame = historyFrame(ctx, now, {
    // Statistics only give a group's lows and highs, and keep its hourly rows, when asked.
    range: range || errorBars === 'min_max',
    hourly: errorBars !== undefined && raw.source === 'statistics',
  });
  const nav = periodNav(frame, ctx);
  const names = seriesHeader(frame, ctx);
  const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
  const message = frameMessage(frame, ctx);
  const layout = chartLayout(raw);
  if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
  const mode: StackMode = range ? 'none' : ((raw.stack as StackMode | undefined) ?? 'none');
  const group = frame.group;
  // Grouped, every slot is a whole group: today's column is as wide as yesterday's, and the time
  // axis runs on to the end of the last group.
  const table = columnTable(
    frame.series.map((s) => s.points),
    group ? Infinity : frame.range.end,
  );
  const xRange =
    group && table.ends.length ? { ...frame.range, end: Math.max(frame.range.end, ...table.ends) } : frame.range;
  const layers = mode === 'none' ? undefined : stackValues(table.values, mode);
  const whiskers =
    errorBars && group
      ? frame.series.map((s) =>
          whiskersFor(
            s.readings ?? [],
            table.times,
            table.ends,
            errorBars,
            frame.source === 'statistics',
            Math.min(frame.range.end, now),
          ),
        )
      : undefined;
  const reach = (whiskers ?? []).flat().flatMap((w) => (w ? [w.lo, w.hi] : []));
  const targets = frame.series.map((s) => s.entity.target).filter((t): t is number => t !== null);
  let data: [number, number] | undefined;
  if (layers) data = stackExtent(layers);
  else if (range)
    data = spread([...table.lows.flat(), ...table.highs.flat(), ...table.values.flat(), ...targets], false);
  else data = spread([...table.values.flat(), ...reach, ...(ctx.config.show.target ? targets : [])]);
  let fixed = raw;
  if (mode === 'percent') fixed = { y_min: data![0] < 0 ? -100 : 0, y_max: data![1] > 0 ? 100 : 0, ...raw };
  else if (!range && data) fixed = zeroBased(data, raw);
  let axes: PlotAxes = plotAxes({ ...ctx, raw: fixed }, xRange, data);
  const { scales } = axes;
  const centres = table.times.map((t, i) => (t + table.ends[i]) / 2);
  const slotOf = new Map(centres.map((c, i) => [c, i]));
  if (group && centres.length) {
    // One label under each set of columns, every second or third one when they won't all fit.
    const every = labelEvery(centres.length, plotWidth(ctx) / GROUP_LABEL_PX[group.unit]);
    const unit = LABEL_UNIT[group.unit];
    // A week's worth of days goes by its day names.
    const span = group.unit === 'day' && centres.length <= 8 ? 7 * 86_400_000 : frame.range.end - frame.range.start;
    axes = {
      ...axes,
      unit,
      times: centres.filter((_, i) => i % every === 0),
      label: (c) => timeLabel(table.times[slotOf.get(c)!], unit, span, ctx.hass),
    };
  }
  const drawn = drawColumns(ctx, frame, table, scales, mode, layers, whiskers);
  // The tooltip reads each series at the middle of each slot.
  const shown: ChartSeries[] = frame.series.map((s, k) => ({
    ...s,
    points: centres.map((t, i): Point => ({ t, v: table.values[k][i], min: table.lows[k][i], max: table.highs[k][i] })),
  }));
  const tip: TooltipOptions = {
    dotY: () => null,
    heading: (c) => {
      const i = slotOf.get(c);
      if (i === undefined) return formatDateTime(c, ctx.hass);
      return group
        ? groupHeading(table.times[i], table.ends[i], group.unit, ctx.hass)
        : formatDateTime(table.times[i], ctx.hass);
    },
  };
  const fmt = (v: number, s: ChartSeries) => formatNumber(v, s.entity.decimals, ctx.hass);
  if (range) {
    tip.text = (s, p) => {
      if (!p || p.v === null) return '—';
      const lo = p.min ?? p.v;
      const hi = p.max ?? p.v;
      return withUnit(`${fmt(lo, s)} – ${fmt(hi, s)}`, s.entity.unit);
    };
  }
  if (whiskers) {
    // Whiskers follow the drawn series' order; a series' index is its place among the card's
    // entities, which differs once names hide some (legend_toggle).
    const whiskersOf = new Map(frame.series.map((s, k) => [s.index, whiskers[k]]));
    tip.text = (s, p) => {
      if (!p || p.v === null) return '—';
      const w = whiskersOf.get(s.index)?.[slotOf.get(p.t) ?? -1];
      const value = withUnit(fmt(p.v, s), s.entity.unit);
      if (!w) return value;
      return localize(ctx.hass, 'error_bars_tooltip', { value, low: fmt(w.lo, s), high: fmt(w.hi, s) });
    };
  }
  if (layers) {
    const sums = totals(table.values);
    const unit = sharedUnit(shown);
    const decimals = Math.max(...shown.map((s) => s.entity.decimals));
    tip.footer = (rows) => totalRow(ctx, sums[slotOf.get(rows[0]?.p?.t ?? NaN) ?? -1] ?? null, unit, decimals);
    if (mode === 'percent') {
      tip.text = (s, p) => {
        const layer = p ? layers[s.index][slotOf.get(p.t) ?? -1] : null;
        if (!p || p.v === null || !layer) return '—';
        return `${withUnit(fmt(shownValue(s.entity, p.v), s), s.entity.unit)} · ${Math.round(Math.abs(layer[1] - layer[0]))} %`;
      };
    }
  }
  const tooltip = tooltipEnabled(raw);
  const hovered = tooltip ? hoverTime(ctx.host) : undefined;
  const at = hovered === undefined ? undefined : slotOf.get(hovered);
  const highlight =
    at === undefined
      ? nothing
      : html`<div
          class="slot-hover"
          style="left:${pct(scales.x(table.times[at]), VIEW_W)};width:${pct(
            scales.x(table.ends[at]) - scales.x(table.times[at]),
            VIEW_W,
          )}"
        ></div>`;
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_column'),
    names: frame.series.map((s) => s.entity.name).join(', '),
  });
  const radius = raw.rounded === false ? 0 : RADIUS_PX;
  return chartFrame(
    layout,
    header,
    chartArea({
      axes,
      ctx,
      content: svg``,
      label,
      overlay: html`<div class="columns" style="--r:${radius}px">${highlight}${drawn.columns}${drawn.targets}</div>
        <div class="point-labels">${drawn.labels}</div>
        ${layout.header === 'over' ? headerOver(header) : nothing}
        ${nowMarkerLayer(ctx, frame, xRange, scales, plotWidth(ctx))}
        ${tooltip ? tooltipLayer(ctx, shown, scales, hovered, plotWidth(ctx), tip) : nothing}`,
      hover: tooltip
        ? hoverHandlers(
            ctx,
            xRange,
            shown.map((s) => s.points),
          )
        : undefined,
    }),
  );
}

/** The shared history fields with the column chart's defaults: 7 days, grouping chosen for you. */
const COLUMN_HISTORY_FIELDS: FieldBinding[] = HISTORY_FIELDS.map((f) => {
  if (f.name === 'period_last') return { ...f, default: COLUMN_PERIOD.last };
  if (f.name === 'period_unit') return { ...f, default: COLUMN_PERIOD.unit };
  if (f.name === 'group_by' || f.name === 'aggregate') return { ...f, default: 'auto' };
  return f;
});

const COLUMN_FIELDS: FieldBinding[] = [
  ...COLUMN_HISTORY_FIELDS,
  ENERGY_SPLIT_FIELD,
  { name: 'stack', path: ['stack'], default: 'none' },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  { name: 'range', path: ['range'], default: false },
  { name: 'column_labels', path: ['labels'], default: false },
  { name: 'rounded', path: ['rounded'], default: true },
  { name: 'error_bars', path: ['error_bars'], default: 'none' },
  ...AXES_FIELDS,
  ...NOW_MARKER_FIELDS,
  ...LAYOUT_FIELDS,
];

/**
 * A rolling period edited here keeps both its length and unit in the config: the column chart's
 * default (7 days) differs from other charts', so a lone `last: 24` would read as 24 hours.
 */
export function fullPeriod(config: CardConfig): CardConfig {
  const period = config.period as Record<string, unknown> | undefined;
  if (!period || typeof period !== 'object' || period.calendar !== undefined) return config;
  if (period.last !== undefined && period.unit !== undefined) return config;
  return { ...config, period: { last: COLUMN_PERIOD.last, unit: COLUMN_PERIOD.unit, ...period } };
}

export function columnEditor(ctx: ChartEditorContext): TemplateResult {
  const ungrouped = ctx.config.group_by === 'none';
  // The shared period fields without their grouping row: the column chart has its own choices.
  const period = { ...ctx.config, group_by: undefined };
  const schema = cachedSchema(`column|${historyVariant(period)}|${ungrouped}`, ctx.hass, () => [
    ...historySchema(ctx.hass, period).slice(0, -1),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'group_by', selector: choice(ctx.hass, 'group_by', COLUMN_GROUPS) },
        ...(ungrouped ? [] : [{ name: 'aggregate', selector: choice(ctx.hass, 'aggregate', COLUMN_AGGREGATES) }]),
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'stack', selector: choice(ctx.hass, 'stack', STACK_MODES) },
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', ['series', 'bands']) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'range', selector: { boolean: {} } },
        { name: 'column_labels', selector: { boolean: {} } },
        { name: 'rounded', selector: { boolean: {} } },
      ],
    },
    // Whiskers need groups to spread within.
    ...(ungrouped ? [] : [{ name: 'error_bars', selector: choice(ctx.hass, 'error_bars', ERROR_BARS) }]),
    ...axesSchema(ctx.hass),
    ...nowMarkerSchema(ctx.hass),
    ...layoutSchema(ctx.hass),
  ]);
  return chartForm({ ...ctx, commit: (c) => ctx.commit(fullPeriod(c)) }, 'chart', schema, COLUMN_FIELDS);
}

const ENTITY_FIELDS: FieldBinding[] = [{ name: 'column_color', path: ['color'] }];

export const columnStyles = css`
  .columns {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .col {
    position: absolute;
    box-sizing: border-box;
    transform-origin: 50% 100%;
    animation: cd-col-grow var(--cd-duration) var(--cd-easing);
  }
  .col.down {
    transform-origin: 50% 0;
  }
  .col.cap-top {
    border-radius: var(--r) var(--r) 0 0;
  }
  .col.cap-bottom {
    border-radius: 0 0 var(--r) var(--r);
  }
  .col.cap-both {
    border-radius: var(--r);
    opacity: 0.75;
  }
  .col-mark {
    position: absolute;
    height: 0;
    border-top: 2px solid var(--card-background-color, #fff);
    transform: translateY(-1px);
  }
  .target-mark {
    position: absolute;
    height: 0;
    border-top: 2px solid var(--primary-text-color);
    transform: translateY(-1px);
    border-radius: 1px;
  }
  .slot-hover {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
  }
  .point-label.col-label.below {
    transform: translate(-50%, 4px);
  }
  :host([static]) .col {
    animation: none;
  }
  @keyframes cd-col-grow {
    from {
      transform: scaleY(0);
    }
  }
  /* Labels over the plot stay readable above the columns. */
  .axes-inside .y-axis,
  .axes-inside .x-axis {
    z-index: 1;
  }
`;

export const columnChart: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${columnStyles}
    ${errorBarStyles}
    ${nowMarkerStyles}
  `,
  thumbnail: () => svg`
    <path d="M7 36 V22 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" />
    <path d="M19 36 V12 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" />
    <path d="M31 36 V18 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" />
    <path d="M43 36 V8 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 V36 Z" fill="var(--warning-color, #f59e0b)" />
    <path d="M55 36 V26 a2 2 0 0 1 2 -2 h2 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" />
    <path d="M4 36.5 H62" stroke="var(--secondary-text-color, #888)" stroke-width="1" />`,
  validate,
  editor: columnEditor,
  entityFields: (hass) => ({
    schema: cachedSchema('column-entity', hass, () => [{ name: 'column_color', selector: { text: {} } }]),
    fields: ENTITY_FIELDS,
  }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
    stopNowMarker(host);
  },
  render,
};
