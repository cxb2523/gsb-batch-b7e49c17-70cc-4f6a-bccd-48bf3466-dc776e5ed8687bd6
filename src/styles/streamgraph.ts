import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { onFillText } from '../bands';
import { formatDateTime, validateAxisOptions } from '../chart/axes';
import {
  SERIES_COLORS,
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
import type { PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { runPath } from '../chart/paths';
import type { Curve, XY } from '../chart/paths';
import {
  BASELINES,
  STREAM_ORDERS,
  binSeries,
  insideOut,
  placeLabels,
  layersExtent,
  sampleBounds,
  stack,
  stackable,
  widest,
} from '../chart/stream';
import type { Baseline, LabelSpot, Layer, StreamOrder } from '../chart/stream';
import {
  hoverHandlers,
  hoverTime,
  nearestIndex,
  stopHover,
  tooltipEnabled,
  tooltipSide,
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
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

/** Samples across the plot: one per 4 px or so, never more than this. */
const MAX_SAMPLES = 240;
/** A stream thinner than this (px) gets no name on it. */
const LABEL_MIN_PX = 18;
/** Plot height in px, for deciding which streams are thick enough to label. */
const PLOT_PX = 180;
const COMPACT_PLOT_PX = 110;
/** Rough width of one character of a stream's name (11 px text), for keeping names apart. */
const LABEL_CHAR_PX = 6.2;

/** One sample across every stream: when, and each series' value there. */
interface Samples {
  times: number[];
  /** Per series (frame order): the value in each sample, null for a gap. */
  values: (number | null)[][];
}

/**
 * The series on shared times. Grouped readings already are (one value per group, at its middle);
 * otherwise each series is binned into even slices of the range by its time-weighted mean.
 * Nothing is drawn past now.
 */
export function streamSamples(frame: HistoryFrame, now: number, width: number): Samples {
  const until = Math.min(frame.range.end, now);
  if (frame.group) {
    const first = frame.series[0]?.points ?? [];
    const keep = first.map((_, j) => j).filter((j) => first[j].t < until);
    return {
      times: keep.map((j) => (first[j].t + Math.min(first[j].end ?? first[j].t, until)) / 2),
      values: frame.series.map((s) => keep.map((j) => s.points[j]?.v ?? null)),
    };
  }
  let count = Math.min(MAX_SAMPLES, Math.max(24, Math.round(width / 4)));
  // Statistics rows are a fixed length: never cut finer than they are, or bins come up empty.
  if (frame.source === 'statistics') {
    const rows = Math.max(1, ...frame.series.map((s) => s.points.filter((p) => !p.carried).length));
    count = Math.min(count, rows);
  }
  const bounds = sampleBounds(frame.range, until, count);
  return {
    times: bounds.slice(0, -1).map((t, i) => (t + bounds[i + 1]) / 2),
    values: frame.series.map((s) => binSeries(s.points, bounds, frame.source, until)),
  };
}

function baselineOf(raw: CardConfig): Baseline {
  return (raw.baseline as Baseline | undefined) ?? 'wiggle';
}

function orderOf(raw: CardConfig): StreamOrder {
  return (raw.stream_order as StreamOrder | undefined) ?? 'inside_out';
}

/** The area between a layer's edges, from the first sample to the last. */
export function layerPath(layer: Layer, xs: number[], scales: PlotScales, curve: Curve): string {
  const top: XY[] = xs.map((x, j) => [x, scales.y(layer.upper[j])]);
  const bottom: XY[] = xs.map((x, j) => [x, scales.y(layer.lower[j])]).reverse() as XY[];
  if (top.length === 0) return '';
  return `${runPath(top, curve)}L${runPath(bottom, curve).slice(1)}Z`;
}

/** Name of a series' colour before it is turned into CSS, for picking text that reads on it. */
function colorName(s: ChartSeries): string {
  return (s.entity.config as { color?: string }).color ?? SERIES_COLORS[s.index % SERIES_COLORS.length];
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

function streamLabels(
  frame: HistoryFrame,
  layers: Layer[],
  xs: number[],
  scales: PlotScales,
  ctx: ChartContext,
  share: boolean,
  values: (number | null)[][],
) {
  const [lo, hi] = scales.domain;
  const plotPx = chartLayout(ctx.raw).compact ? COMPACT_PLOT_PX : PLOT_PX;
  const plotW = plotWidth(ctx);
  const px = (v: number) => (v / (hi - lo)) * plotPx;
  const texts = new Map<number, string>();
  const spots: LabelSpot[] = [];
  // Layers and values follow the drawn series' order; `s.index` names the entity (one may be hidden).
  for (const [pos, s] of frame.series.entries()) {
    const layer = layers[pos];
    const { at, thickness } = widest(layer);
    if (px(thickness) < LABEL_MIN_PX) continue;
    const v = values[pos][at];
    const amount = share
      ? `${formatNumber(layer.upper[at] - layer.lower[at], 0, ctx.hass)} %`
      : v === null
        ? ''
        : withUnit(formatNumber(v, s.entity.decimals, ctx.hass), s.entity.unit);
    const text = `${s.entity.name} ${amount}`.trim();
    texts.set(s.index, text);
    spots.push({
      key: s.index,
      x: (xs[at] / VIEW_W) * plotW,
      y: (scales.y((layer.upper[at] + layer.lower[at]) / 2) / VIEW_H) * plotPx,
      width: text.length * LABEL_CHAR_PX,
      thickness: px(thickness),
    });
  }
  const placed = placeLabels(spots, plotW);
  return html`<div class="stream-labels" aria-hidden="true">
    ${spots.map((spot) => {
      const left = placed.get(spot.key);
      if (left === undefined) return nothing;
      const s = frame.series.find((x) => x.index === spot.key)!;
      return html`<span
        class="stream-label ${onFillText(colorName(s))}"
        style="left:${pct(plotW ? left / plotW : 0)};top:${pct(spot.y / plotPx)}"
        >${texts.get(spot.key)}</span
      >`;
    })}
  </div>`;
}

/** The guide and a box listing each stream's value (and share) at the sample under the pointer. */
function streamTooltip(
  ctx: ChartContext,
  frame: HistoryFrame,
  samples: Samples,
  layers: Layer[],
  order: number[],
  xs: number[],
  t: number | undefined,
  share: boolean,
) {
  if (t === undefined) return nothing;
  // Rolling spans move with the clock between redraws: take the nearest sample, not an exact one.
  const j = nearestIndex(
    samples.times.map((x) => ({ t: x })),
    t,
  );
  if (j < 0) return nothing;
  const x = xs[j] / VIEW_W;
  const side = tooltipSide(x, plotWidth(ctx));
  // Top of the stack first, as it is drawn.
  const rows = [...order].reverse().map((i) => frame.series[i]);
  const shares = layers.map((l) => l.upper[j] - l.lower[j]);
  const total = samples.values.reduce((a, row) => a + Math.max(0, row[j] ?? 0), 0);
  const units = new Set(frame.series.map((s) => s.entity.unit));
  const value = (s: ChartSeries) => {
    const v = samples.values[s.index][j];
    if (v === null) return '—';
    const text = withUnit(formatNumber(v, s.entity.decimals, ctx.hass), s.entity.unit);
    return share ? `${text} · ${formatNumber(shares[s.index], 0, ctx.hass)} %` : text;
  };
  return html`<div class="hover-layer" aria-hidden="true">
    <div class="crosshair" style="left:${pct(x)}"></div>
    <div class="tooltip ${side}" style=${side.startsWith('pin') ? '' : `left:${pct(x)}`}>
      <div class="tooltip-time">${formatDateTime(samples.times[j], ctx.hass)}</div>
      ${rows.map(
        (s) =>
          html`<div class="tooltip-row">
            <span class="swatch" style="background:${s.color}"></span>
            <span class="tooltip-name">${s.entity.name}</span>
            <span class="tooltip-value">${value(s)}</span>
          </div>`,
      )}
      ${
        units.size === 1 && frame.series.length > 1
          ? html`<div class="tooltip-row total">
              <span class="tooltip-name">${localize(ctx.hass, 'stream_total')}</span>
              <span class="tooltip-value"
                >${withUnit(formatNumber(total, frame.series[0].entity.decimals, ctx.hass), frame.series[0].entity.unit)}</span
              >
            </div>`
          : nothing
      }
    </div>
  </div>`;
}

/** Shape fields come first; value labels only mean something on a stack from zero or of shares. */
function streamVariant(config: CardConfig): string {
  const b = baselineOf(config);
  return `${historyVariant(config)}|${b === 'wiggle' || b === 'centre' ? 'floating' : 'axis'}`;
}

const STREAM_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'baseline', path: ['baseline'], default: 'wiggle' },
  { name: 'stream_order', path: ['stream_order'], default: 'inside_out' },
  { name: 'stream_curve', path: ['curve'], default: 'smooth' },
  { name: 'stream_labels', path: ['labels'], default: true },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

/** Floating streams have no value scale to label: drop value labels, lines across and the range. */
const FLOATING_HIDDEN = new Set(['y_axis', 'grid_horizontal', 'y_min', 'y_max']);

function withoutFloating(schema: unknown[]): unknown[] {
  return schema
    .map((item) => {
      const s = item as { name: string; schema?: { name: string }[] };
      if (FLOATING_HIDDEN.has(s.name)) return undefined;
      if (s.schema) {
        const inner = s.schema.filter((x) => !FLOATING_HIDDEN.has(x.name));
        return inner.length ? { ...s, schema: inner } : undefined;
      }
      return s;
    })
    .filter((x) => x !== undefined);
}

export function streamEditor(ctx: ChartEditorContext): TemplateResult {
  const variant = streamVariant(ctx.config);
  const schema = cachedSchema(`streamgraph|${variant}`, ctx.hass, () => {
    const axes = axesSchema(ctx.hass);
    return [
      ...historySchema(ctx.hass, ctx.config),
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'baseline', selector: choice(ctx.hass, 'baseline', BASELINES) },
          { name: 'stream_order', selector: choice(ctx.hass, 'stream_order', STREAM_ORDERS) },
        ],
      },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'stream_curve', selector: choice(ctx.hass, 'curve', ['smooth', 'straight', 'step']) },
          { name: 'stream_labels', selector: { boolean: {} } },
        ],
      },
      ...(variant.endsWith('floating') ? withoutFloating(axes) : axes),
      ...layoutSchema(ctx.hass),
    ];
  });
  return chartForm(ctx, 'chart', schema, STREAM_FIELDS);
}

const ENTITY_FIELDS = {
  schema: [{ name: 'fill_color', selector: { text: {} } }],
  fields: [{ name: 'fill_color', path: ['color'] }],
};

export const streamgraph: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    .style-streamgraph .stream {
      cursor: pointer;
      stroke: var(--card-background-color, #fff);
      stroke-width: 1px;
      stroke-linejoin: round;
    }
    .stream-labels {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .stream-label {
      position: absolute;
      transform: translateY(-50%);
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      color: #fff;
    }
    .stream-label.dark {
      color: rgba(0, 0, 0, 0.8);
    }
    .stream-label.theme {
      color: var(--primary-text-color);
    }
    .tooltip-row.total {
      border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      margin-top: 2px;
      padding-top: 2px;
    }
  `,
  thumbnail: () => svg`
    <path d="M4 20 C14 12 22 14 32 16 S50 10 60 14 L60 22 C50 20 42 24 32 22 S14 22 4 24 Z"
      fill="var(--primary-color, #03a9f4)" />
    <path d="M4 24 C14 22 22 22 32 22 S50 20 60 22 L60 28 C50 30 40 34 32 30 S14 30 4 28 Z"
      fill="var(--success-color, #43a047)" />
    <path d="M4 28 C14 30 22 30 32 30 S50 30 60 28 L60 31 C50 34 40 38 32 34 S14 33 4 31 Z"
      fill="var(--warning-color, #f59e0b)" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateLayout(raw);
    if (raw.baseline !== undefined && !BASELINES.includes(raw.baseline as Baseline)) {
      throw new Error(`"baseline" must be one of: ${BASELINES.join(', ')}`);
    }
    if (raw.stream_order !== undefined && !STREAM_ORDERS.includes(raw.stream_order as StreamOrder)) {
      throw new Error(`"stream_order" must be one of: ${STREAM_ORDERS.join(', ')}`);
    }
    if (raw.labels !== undefined && typeof raw.labels !== 'boolean') throw new Error('"labels" must be true or false');
  },
  editor: streamEditor,
  entityFields: () => ENTITY_FIELDS,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render(ctx) {
    const now = Date.now();
    const frame = historyFrame(ctx, now);
    const nav = periodNav(frame, ctx);
    const names = seriesHeader(frame, ctx);
    const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
    const message = frameMessage(frame, ctx);
    const layout = chartLayout(ctx.raw);
    if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
    const kind = baselineOf(ctx.raw);
    const share = kind === 'share';
    const floating = kind === 'wiggle' || kind === 'centre';
    const samples = streamSamples(frame, now, plotWidth(ctx));
    const values = samples.values.map(stackable);
    const order = orderOf(ctx.raw) === 'listed' ? values.map((_, i) => i) : insideOut(values);
    const layers = stack(values, order, kind);
    const extent = layersExtent(layers);
    // A floating stream has no scale worth labelling, so it fills the plot; a share runs 0 to 100,
    // and a stack from zero starts at zero unless the card says otherwise.
    let axisRaw: CardConfig = ctx.raw;
    if (floating) {
      const [lo, hi] = extent ?? [0, 1];
      const pad = hi > lo ? (hi - lo) * 0.04 : 1;
      axisRaw = {
        ...ctx.raw,
        y_axis: false,
        y_min: lo - pad,
        y_max: hi + pad,
        gridlines: { ...((ctx.raw.gridlines as object | undefined) ?? {}), horizontal: false },
      };
    } else if (share) axisRaw = { ...ctx.raw, y_min: 0, y_max: 100 };
    else if (ctx.raw.y_min === undefined) axisRaw = { ...ctx.raw, y_min: 0 };
    const axes = plotAxes({ ...ctx, raw: axisRaw }, frame.range, extent);
    const { scales } = axes;
    const xs = samples.times.map((t) => scales.x(t));
    const curve = (ctx.raw.curve as Curve | undefined) ?? 'smooth';
    // Carry the edge samples out to the edges of the data, so the streams don't start in mid-air.
    const until = Math.min(frame.range.end, now);
    const edgeX = [scales.x(frame.range.start), ...xs, scales.x(until)];
    const edged = (l: Layer): Layer => ({
      lower: [l.lower[0], ...l.lower, l.lower[l.lower.length - 1]],
      upper: [l.upper[0], ...l.upper, l.upper[l.upper.length - 1]],
    });
    const streams =
      samples.times.length === 0
        ? svg``
        : svg`${order.map((i) => {
            const s = frame.series[i];
            return svg`<path
              class="stream entity"
              data-index=${s.index}
              aria-label=${s.entity.label}
              d=${layerPath(edged(layers[i]), edgeX, scales, curve)}
              fill=${s.color}
            ></path>`;
          })}`;
    const tooltip = tooltipEnabled(ctx.raw);
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_streamgraph'),
      names: frame.series.map((s) => s.entity.name).join(', '),
    });
    const hoverPoints = samples.times.map((t) => ({ t, v: 0 }));
    return chartFrame(
      layout,
      header,
      chartArea({
        axes,
        ctx: { ...ctx, raw: axisRaw },
        content: streams,
        label,
        overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}
        ${
          ctx.raw.labels !== false && samples.times.length
            ? streamLabels(frame, layers, xs, scales, ctx, share, samples.values)
            : nothing
        }
        ${tooltip ? streamTooltip(ctx, frame, samples, layers, order, xs, hoverTime(ctx.host), share) : nothing}`,
        hover: tooltip ? hoverHandlers(ctx, frame.range, [hoverPoints]) : undefined,
      }),
    );
  },
};
