import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { formatDateTime, validateAxisOptions, valueAxis } from '../chart/axes';
import {
  COLUMN_AGGREGATES,
  COLUMN_GROUPS,
  autoGroupUnit,
  columnBox,
  columnTable,
  isMeter,
  spread,
} from '../chart/columns';
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
import type { ChartSeries } from '../chart/frame';
import { chartArea, gridStyles, plotAxes, plotWidth, stopChartWidth } from '../chart/grid';
import type { PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { CURVES } from '../chart/paths';
import { linear } from '../chart/scale';
import { DEFAULT_LINE_WIDTH, validateSeriesStyle } from '../chart/series-style';
import {
  hoverHandlers,
  hoverTime,
  stopHover,
  tooltipEnabled,
  tooltipLayer,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
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
import { LINE_WIDTH_SELECTOR } from '../editor/schemas';
import type { FieldBinding } from '../editor/schemas';
import { AGGREGATES, parseGrouping } from '../history/group';
import type { Aggregate } from '../history/group';
import { parsePeriod } from '../history/period';
import type { Point } from '../history/types';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig } from '../types';
import { areaStyles, drawArea, zeroFloor } from './area';
import { column, columnStyles, groupHeading } from './column';
import { seriesPath } from './line';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const SERIES_TYPES = ['line', 'column', 'area'] as const;
export type SeriesType = (typeof SERIES_TYPES)[number];
export const Y_AXES = ['auto', 'left', 'right'] as const;
type Side = 'left' | 'right';

/** Gaps between value labels on the right axis, as on the left. */
const VALUE_GAPS = 4;

type Own = { type?: SeriesType; y_axis?: Side; aggregate?: Aggregate };
const own = (e: ResolvedEntity) => e.config as unknown as Own;

/** How a series is drawn: its own `type`, else a line. */
export const seriesType = (e: ResolvedEntity): SeriesType => own(e).type ?? 'line';

/**
 * Which value axis each series uses: its own `y_axis`, else left for the first series' unit and
 * right for any other. When nothing ends up on the left, everything moves there.
 */
export function axisSides(items: readonly ResolvedEntity[]): Side[] {
  const first = items[0]?.unit;
  const sides = items.map((e) => own(e).y_axis ?? (e.unit === first ? 'left' : 'right'));
  return sides.includes('left') ? sides : sides.map(() => 'left');
}

/**
 * The card config the shared frame reads. With any column series and no `group_by` (or `auto`),
 * readings are grouped to fit the span, as on the column chart; without columns, auto means not
 * grouped. `none` never groups.
 */
export function combinedRaw(raw: CardConfig, items: readonly ResolvedEntity[]): CardConfig {
  const out: Record<string, unknown> = { ...raw };
  const columns = items.some((e) => seriesType(e) === 'column');
  if (raw.group_by === 'none' || ((raw.group_by === undefined || raw.group_by === 'auto') && !columns)) {
    delete out.group_by;
  } else if (raw.group_by === undefined || raw.group_by === 'auto') {
    out.group_by = autoGroupUnit(parsePeriod(raw.period as CardConfig['period']));
  }
  if (raw.aggregate === 'auto') delete out.aggregate;
  return out as CardConfig;
}

/**
 * How one series' groups are combined: its own `aggregate`, else the card's when set, else a
 * meter's change (energy per day) and anything else's average (the day's temperature).
 */
export function seriesAggregate(e: ResolvedEntity, raw: CardConfig): Aggregate {
  const card = raw.aggregate;
  return own(e).aggregate ?? (card && card !== 'auto' ? (card as Aggregate) : isMeter(e) ? 'change' : 'mean');
}

function validate(raw: CardConfig): void {
  if (raw.group_by !== undefined && !COLUMN_GROUPS.includes(raw.group_by as (typeof COLUMN_GROUPS)[number])) {
    throw new Error(`"group_by" must be one of: ${COLUMN_GROUPS.join(', ')}`);
  }
  if (raw.aggregate !== undefined && !COLUMN_AGGREGATES.includes(raw.aggregate as (typeof COLUMN_AGGREGATES)[number])) {
    throw new Error(`"aggregate" must be one of: ${COLUMN_AGGREGATES.join(', ')}`);
  }
  const shared: Record<string, unknown> = { ...raw };
  if (raw.group_by === 'auto' || raw.group_by === 'none') delete shared.group_by;
  if (raw.aggregate === 'auto') delete shared.aggregate;
  validateHistoryOptions(shared as CardConfig);
  parseGrouping(shared as CardConfig);
  validateAxisOptions(raw);
  validateTooltipOptions(raw);
  validateSeriesStyle(raw);
  validateLayout(raw);
  if (raw.rounded !== undefined && typeof raw.rounded !== 'boolean') throw new Error('"rounded" must be true or false');
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object') continue;
    const o = e as unknown as Own;
    if (o.type !== undefined && !SERIES_TYPES.includes(o.type)) {
      throw new Error(`"type" of ${e.entity} must be one of: ${SERIES_TYPES.join(', ')}`);
    }
    if (o.y_axis !== undefined && o.y_axis !== 'left' && o.y_axis !== 'right') {
      throw new Error(`"y_axis" of ${e.entity} must be one of: left, right`);
    }
    if (o.aggregate !== undefined && !AGGREGATES.includes(o.aggregate)) {
      throw new Error(`"aggregate" of ${e.entity} must be one of: ${AGGREGATES.join(', ')}`);
    }
  }
}

/** Lowest and highest of the given series' values, with zero in when columns stand on it. */
function sideExtent(series: ChartSeries[], types: SeriesType[]): [number, number] | undefined {
  const values = series.flatMap((s) => s.points.map((p) => p.v));
  return spread(values, types.includes('column'));
}

function render(ctx0: ChartContext): TemplateResult {
  const ctx = { ...ctx0, raw: combinedRaw(ctx0.raw, ctx0.items) };
  const raw = ctx.raw;
  const frame = historyFrame(ctx, Date.now(), { aggregate: (e) => seriesAggregate(e, ctx0.raw) });
  const nav = periodNav(frame, ctx);
  const names = seriesHeader(frame, ctx);
  const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
  const message = frameMessage(frame, ctx);
  const layout = chartLayout(raw);
  if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
  const types = frame.series.map((s) => seriesType(s.entity));
  const sides = axisSides(frame.series.map((s) => s.entity));
  const group = frame.group;
  // Grouped, each reading is drawn in the middle of its group, so lines pass over the columns.
  const series: ChartSeries[] = frame.series.map((s) =>
    group ? { ...s, points: s.points.map((p) => ({ ...p, t: p.end !== undefined ? (p.t + p.end) / 2 : p.t })) } : s,
  );
  const lastEnd = group
    ? Math.max(frame.range.end, ...frame.series.flatMap((s) => s.points.map((p) => p.end ?? 0)))
    : 0;
  const xRange = group ? { ...frame.range, end: lastEnd } : frame.range;
  const on = (side: Side) => series.filter((_, i) => sides[i] === side);
  const typesOn = (side: Side) => types.filter((_, i) => sides[i] === side);
  // Left: the shared axes (options, gridlines, a set lowest/highest). Columns stand on zero, and
  // areas reaching down near it do.
  const leftData = sideExtent(on('left'), typesOn('left'));
  let leftRaw = raw;
  if (leftData && typesOn('left').includes('column')) {
    leftRaw = {
      ...raw,
      y_min: raw.y_min ?? (leftData[0] >= 0 ? 0 : undefined),
      y_max: raw.y_max ?? (leftData[1] <= 0 ? 0 : undefined),
    };
  } else if (typesOn('left').includes('area')) leftRaw = zeroFloor(leftData, raw);
  const axes = plotAxes({ ...ctx, raw: leftRaw }, xRange, leftData);
  const left = axes.scales;
  // Right: its own round steps over its series' readings.
  const rightSeries = on('right');
  const rightData = sideExtent(rightSeries, typesOn('right'));
  const rightFixed: { min?: number; max?: number } = {};
  if (rightData && (typesOn('right').includes('column') || typesOn('right').includes('area'))) {
    if (rightData[0] >= 0 && rightData[0] <= rightData[1] / 2) rightFixed.min = 0;
    if (rightData[1] <= 0 && rightData[1] >= rightData[0] / 2) rightFixed.max = 0;
  }
  const rightAxis = rightSeries.length ? valueAxis(rightData, rightFixed, VALUE_GAPS) : undefined;
  const right: PlotScales | undefined = rightAxis
    ? { x: left.x, y: linear(rightAxis.domain, [VIEW_H, 0]), domain: rightAxis.domain }
    : undefined;
  const scalesOf = (s: ChartSeries) => (sides[s.index] === 'right' && right ? right : left);

  // Areas at the back, then columns, then lines on top.
  const areas = series
    .filter((s) => types[s.index] === 'area')
    .map((s) => drawArea(s, s.points, scalesOf(s), raw, { range: xRange }));
  const lines = series
    .filter((s) => types[s.index] === 'line')
    .map((s) => seriesPath({ ...s, points: s.points }, scalesOf(s), s.color, xRange, raw));
  const columnSeries = series.filter((s) => types[s.index] === 'column');
  const table = columnTable(
    frame.series.filter((s) => types[s.index] === 'column').map((s) => s.points),
    group ? Infinity : frame.range.end,
  );
  const radius = raw.rounded === false ? 0 : 4;
  const columns: TemplateResult[] = [];
  table.times.forEach((t, i) => {
    const x0 = left.x(t);
    const x1 = left.x(table.ends[i]);
    columnSeries.forEach((s, k) => {
      const v = table.values[k][i];
      if (v === null) return;
      const sc = scalesOf(s);
      const base = Math.min(Math.max(0, sc.domain[0]), sc.domain[1]);
      const [l, w] = columnBox(x0, x1, k, columnSeries.length);
      columns.push(
        column(sc, l, w, Math.min(base, v), Math.max(base, v), s.color, v >= base ? 'top' : 'bottom', s.index),
      );
    });
  });
  // Column series read their slot (middle) in the tooltip; others their nearest reading.
  const centres = table.times.map((t, i) => (t + table.ends[i]) / 2);
  const shown = series.map((s) => {
    if (types[s.index] !== 'column' || group) return s;
    const k = columnSeries.indexOf(s);
    return { ...s, points: centres.map((t, i): Point => ({ t, v: table.values[k][i] })) };
  });
  const bounds = new Map<number, [number, number]>();
  for (const s of frame.series)
    for (const p of s.points) if (p.end !== undefined) bounds.set((p.t + p.end) / 2, [p.t, p.end]);
  const tooltip = tooltipEnabled(raw);
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_combined'),
    names: frame.series.map((s) => s.entity.name).join(', '),
  });
  return chartFrame(
    layout,
    header,
    chartArea({
      axes,
      ctx,
      right: rightAxis && right ? { value: rightAxis, y: right.y } : undefined,
      content: svg`${areas.map((a) => a.body)}`,
      defs: svg`${areas.map((a) => a.defs)}`,
      label,
      overlay: html`<div class="columns" style="--r:${radius}px">${columns}</div>
        <svg class="plot lines-over" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
          ${lines}
        </svg>
        ${layout.header === 'over' ? headerOver(header) : nothing}
        ${
          tooltip
            ? tooltipLayer(ctx, shown, left, hoverTime(ctx.host), plotWidth(ctx), {
                dotY: (s, p) => (types[s.index] === 'column' || p.v === null ? null : scalesOf(s).y(p.v)),
                heading: (t) => {
                  const b = bounds.get(t);
                  return b && group ? groupHeading(b[0], b[1], group.unit, ctx.hass) : formatDateTime(t, ctx.hass);
                },
              })
            : nothing
        }`,
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

const COMBINED_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS.map((f) => (f.name === 'group_by' || f.name === 'aggregate' ? { ...f, default: 'auto' } : f)),
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'line_width', path: ['line_width'], default: DEFAULT_LINE_WIDTH },
  { name: 'dots', path: ['dots'], default: false },
  { name: 'rounded', path: ['rounded'], default: true },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

export function combinedEditor(ctx: ChartEditorContext): TemplateResult {
  const ungrouped = ctx.config.group_by === 'none';
  const period = { ...ctx.config, group_by: undefined };
  const schema = cachedSchema(`combined|${historyVariant(period)}|${ungrouped}`, ctx.hass, () => [
    // The shared period fields without their grouping row: this chart has its own choices.
    ...historySchema(ctx.hass, period).slice(0, -1),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'group_by', selector: choice(ctx.hass, 'group_by', COLUMN_GROUPS) },
        ...(ungrouped ? [] : [{ name: 'aggregate', selector: choice(ctx.hass, 'aggregate', COLUMN_AGGREGATES) }]),
      ],
    },
    { name: 'curve', selector: choice(ctx.hass, 'curve', CURVES) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
        { name: 'dots', selector: { boolean: {} } },
        { name: 'rounded', selector: { boolean: {} } },
      ],
    },
    ...axesSchema(ctx.hass),
    ...layoutSchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, COMBINED_FIELDS);
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'series_type', path: ['type'], default: 'line' },
  { name: 'series_axis', path: ['y_axis'], default: 'auto' },
  { name: 'series_color', path: ['color'] },
  { name: 'series_aggregate', path: ['aggregate'], default: 'auto' },
  { name: 'curve', path: ['curve'] },
  { name: 'line_width', path: ['line_width'] },
  { name: 'dash', path: ['dash'], default: false },
  { name: 'negative_color', path: ['negative_color'] },
];

export const combined: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${areaStyles}
    ${columnStyles}
    .lines-over {
      pointer-events: none;
    }
    .lines-over .line {
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .lines-over .dots {
      stroke-linecap: round;
    }
    .lines-over .line.dashed {
      stroke-dasharray: 6 5;
    }
  `,
  thumbnail: () => svg`
    <path d="M10 36 V22 a2 2 0 0 1 2 -2 h6 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" opacity="0.8" />
    <path d="M27 36 V14 a2 2 0 0 1 2 -2 h6 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" opacity="0.8" />
    <path d="M44 36 V18 a2 2 0 0 1 2 -2 h6 a2 2 0 0 1 2 2 V36 Z" fill="var(--primary-color, #03a9f4)" opacity="0.8" />
    <path d="M4 26 C14 20 22 8 32 10 S50 22 60 6" fill="none" stroke="var(--warning-color, #f59e0b)"
      stroke-width="2.5" stroke-linecap="round" />`,
  validate,
  editor: combinedEditor,
  entityFields: (hass) => ({
    schema: cachedSchema('combined-entity', hass, () => [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'series_type', selector: choice(hass, 'series_type', SERIES_TYPES) },
          { name: 'series_axis', selector: choice(hass, 'series_axis', Y_AXES) },
          { name: 'series_color', selector: { text: {} } },
          { name: 'series_aggregate', selector: choice(hass, 'series_aggregate', ['auto', ...AGGREGATES]) },
        ],
      },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'curve', selector: choice(hass, 'curve', CURVES) },
          { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
          { name: 'dash', selector: { boolean: {} } },
          { name: 'negative_color', selector: { text: {} } },
        ],
      },
    ]),
    fields: ENTITY_FIELDS,
  }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render,
};
