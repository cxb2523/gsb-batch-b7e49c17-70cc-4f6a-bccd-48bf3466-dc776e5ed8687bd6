import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { bandFor, baseColor } from '../bands';
import { stepDecimals, validateAxisOptions } from '../chart/axes';
import {
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
import { chartArea, gridStyles, plotWidth, stopChartWidth } from '../chart/grid';
import { COUNT_MODES, MAX_BINS, binEdges, binTotals, formatDuration, pointWeights } from '../chart/histogram';
import type { CountMode } from '../chart/histogram';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { tooltipEnabled, tooltipSide, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import {
  X_RANGE_FIELDS,
  X_RANGE_SCHEMA,
  pickHandlers,
  pickStyles,
  pickTooltip,
  pickedIndex,
  stopPick,
  validateXRange,
  valueAxes,
  xDecimals,
  xRange,
} from '../chart/xy';
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
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

const SHOW_AS = ['percent', 'total'] as const;
type ShowAs = (typeof SHOW_AS)[number];
const BARS = ['side', 'overlap'] as const;
type Bars = (typeof BARS)[number];
const COLOR_BY = ['series', 'bands'] as const;

const HOUR = 3_600_000;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function oneOf(raw: CardConfig, key: string, values: readonly string[]) {
  if (raw[key] !== undefined && !values.includes(raw[key] as string)) {
    throw new Error(`"${key}" must be one of: ${values.join(', ')}`);
  }
}

interface HistogramOptions {
  count: CountMode;
  showAs: ShowAs;
  bars: Bars;
  bands: boolean;
  bins?: number;
  width?: number;
}

function options(raw: CardConfig): HistogramOptions {
  return {
    count: (raw.count as CountMode | undefined) ?? 'time',
    showAs: (raw.show_as as ShowAs | undefined) ?? 'percent',
    bars: (raw.bars as Bars | undefined) ?? 'side',
    bands: raw.color_by === 'bands',
    bins: isNumber(raw.bins) ? raw.bins : undefined,
    width: isNumber(raw.bin_width) ? raw.bin_width : undefined,
  };
}

/** One series' share of each bin, ready to draw. */
interface Binned {
  series: ChartSeries;
  /** Weight per bin: ms of time, or readings. */
  totals: number[];
  /** What is drawn per bin: a percentage, hours, or readings. */
  heights: number[];
  whole: number;
}

/** A small step, so a value printed for a bin edge isn't longer than it needs to be. */
function edgeDecimals(edges: number[]): number {
  if (edges.length < 2) return 0;
  const width = edges[1] - edges[0];
  const exact = edges.every((e) => Math.abs(e - Number(e.toFixed(stepDecimals(width)))) < width * 1e-6);
  return exact ? stepDecimals(width) : Math.min(4, stepDecimals(width) + 1);
}

function binned(ctx: ChartContext, now: number) {
  const frame = historyFrame(ctx, now);
  const opts = options(ctx.raw);
  const until = Math.min(frame.range.end, now);
  const weights = frame.series.map((s) =>
    pointWeights(s.points, { mode: opts.count, until, statistics: frame.source === 'statistics' }),
  );
  let lo = Infinity;
  let hi = -Infinity;
  frame.series.forEach((s, i) =>
    s.points.forEach((p, k) => {
      if (p.v === null || !(weights[i][k] > 0)) return;
      lo = Math.min(lo, p.v);
      hi = Math.max(hi, p.v);
    }),
  );
  const fixed = xRange(ctx.raw);
  const side = opts.bars === 'side' && frame.series.length > 1;
  const target = Math.max(5, Math.min(24, Math.round(plotWidth(ctx) / (side ? 40 : 28))));
  const edges =
    lo === Infinity
      ? []
      : binEdges(lo, hi, { bins: opts.bins, width: opts.width, min: fixed.min, max: fixed.max }, target);
  const data: Binned[] = frame.series.map((s, i) => {
    const totals = binTotals(s.points, weights[i], edges);
    const whole = totals.reduce((a, b) => a + b, 0);
    const heights = totals.map((t) =>
      opts.showAs === 'percent' ? (whole > 0 ? (t / whole) * 100 : 0) : opts.count === 'time' ? t / HOUR : t,
    );
    return { series: s, totals, heights, whole };
  });
  return { frame, opts, edges, data, side };
}

function amountText(total: number, count: CountMode, ctx: ChartContext): string {
  if (count === 'time') return formatDuration(total);
  return total === 1
    ? localize(ctx.hass, 'histogram_reading')
    : localize(ctx.hass, 'histogram_readings', { n: formatNumber(total, 0, ctx.hass) });
}

export const histogram: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${pickStyles}
    .style-histogram .bin {
      shape-rendering: crispEdges;
    }
    .style-histogram .overlap .bin {
      fill-opacity: 0.35;
      stroke-width: 1.5px;
      vector-effect: non-scaling-stroke;
    }
  `,
  thumbnail: () => svg`
    <g fill="var(--primary-color, #03a9f4)">
      <rect x="6" y="28" width="7" height="8" rx="1" />
      <rect x="14" y="20" width="7" height="16" rx="1" />
      <rect x="22" y="8" width="7" height="28" rx="1" />
      <rect x="30" y="12" width="7" height="24" rx="1" />
      <rect x="38" y="22" width="7" height="14" rx="1" />
      <rect x="46" y="30" width="7" height="6" rx="1" />
    </g>
    <path d="M4 37 H60" stroke="var(--secondary-text-color, #727272)" stroke-width="1" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateLayout(raw);
    validateXRange(raw);
    oneOf(raw, 'count', COUNT_MODES);
    oneOf(raw, 'show_as', SHOW_AS);
    oneOf(raw, 'bars', BARS);
    oneOf(raw, 'color_by', COLOR_BY);
    if (
      raw.bins !== undefined &&
      !(Number.isInteger(raw.bins) && (raw.bins as number) >= 1 && (raw.bins as number) <= MAX_BINS)
    ) {
      throw new Error(`"bins" must be a whole number from 1 to ${MAX_BINS}`);
    }
    if (raw.bin_width !== undefined && !(isNumber(raw.bin_width) && raw.bin_width > 0)) {
      throw new Error('"bin_width" must be a number above 0');
    }
  },
  editor: histogramEditor,
  entityFields: () => ({ schema: ENTITY_SCHEMA, fields: ENTITY_FIELDS }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopPick(host);
  },
  render(ctx) {
    const now = Date.now();
    const { frame, opts, edges, data, side } = binned(ctx, now);
    const nav = periodNav(frame, ctx);
    const names = seriesHeader(frame, ctx);
    const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
    const layout = chartLayout(ctx.raw);
    const message =
      frameMessage(frame, ctx) ?? (edges.length < 2 ? frameMessage({ ...frame, series: [] }, ctx) : undefined);
    if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);

    const top = Math.max(0, ...data.flatMap((d) => d.heights));
    const axes = valueAxes(ctx, [edges[0], edges[edges.length - 1]], [0, top], {
      x: { min: edges[0], max: edges[edges.length - 1] },
      yFloor: 0,
    });
    const { scales } = axes;
    const base = scales.y(Math.max(0, axes.value.domain[0]));
    const n = data.length;
    const overlap = opts.bars === 'overlap' && n > 1;
    const bars = svg`${data.map((d, si) => {
      const bins = d.heights.map((h, b) => {
        if (!(h > 0)) return nothing;
        const x0 = scales.x(edges[b]);
        const x1 = scales.x(edges[b + 1]);
        const pad = Math.min(4, (x1 - x0) * 0.08);
        const slot = (x1 - x0 - 2 * pad) / (side ? n : 1);
        const x = x0 + pad + (side ? slot * si : 0);
        const y = scales.y(h);
        const fill =
          opts.bands && d.series.entity.bands.length
            ? baseColor(bandFor((edges[b] + edges[b + 1]) / 2, d.series.entity.bands).color)
            : d.series.color;
        return svg`<rect class="bin" x=${x} y=${Math.min(y, base)} width=${Math.max(0.5, slot)} height=${Math.abs(base - y)} fill=${fill} stroke=${overlap ? fill : 'none'}></rect>`;
      });
      return svg`<g class="series" data-series=${d.series.index}>${bins}</g>`;
    })}`;

    const decimals = edgeDecimals(edges);
    const xLabel = (v: number) => formatNumber(v, xDecimals(axes), ctx.hass);
    const yLabel = (v: number) =>
      opts.showAs === 'percent'
        ? `${formatNumber(v, axes.value.decimals, ctx.hass)}%`
        : opts.count === 'time'
          ? `${formatNumber(v, axes.value.decimals, ctx.hass)} h`
          : formatNumber(v, axes.value.decimals, ctx.hass);

    const tooltip = tooltipEnabled(ctx.raw);
    const picked = tooltip ? pickedIndex(ctx.host) : undefined;
    let overlay: TemplateResult | typeof nothing = nothing;
    if (picked !== undefined && picked < edges.length - 1) {
      const unit = data[0]?.series.entity.unit ?? '';
      const from = formatNumber(edges[picked], decimals, ctx.hass);
      const to = formatNumber(edges[picked + 1], decimals, ctx.hass);
      const x0 = scales.x(edges[picked]) / VIEW_W;
      const x1 = scales.x(edges[picked + 1]) / VIEW_W;
      // Beside the bin, not over it: from its right edge, or its left when there's no room.
      const pw = plotWidth(ctx);
      overlay = pickTooltip({
        x: tooltipSide(x1, pw) === 'right' ? x1 : x0,
        y: 0,
        plotWidth: pw,
        title: withUnit(`${from} – ${to}`, unit),
        band: [x0, x1],
        rows: data.map((d) => {
          const share = d.whole > 0 ? (d.totals[picked] / d.whole) * 100 : 0;
          return {
            color: d.series.color,
            name: d.series.entity.name,
            value: `${formatNumber(share, share > 0 && share < 1 ? 1 : 0, ctx.hass)}% · ${amountText(d.totals[picked], opts.count, ctx)}`,
          };
        }),
      });
    }

    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_histogram'),
      names: frame.series.map((s) => s.entity.name).join(', '),
    });
    return chartFrame(
      layout,
      header,
      chartArea({
        axes,
        ctx,
        content: svg`<g class=${overlap ? 'overlap' : 'side'}>${bars}</g>`,
        label,
        xLabel,
        yLabel,
        overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}${overlay}`,
        hover: tooltip
          ? pickHandlers(ctx, (fx) => {
              const v = edges[0] + fx * (edges[edges.length - 1] - edges[0]);
              const b = edges.findIndex((e, i) => i < edges.length - 1 && v >= e && v <= edges[i + 1]);
              return b < 0 ? undefined : b;
            })
          : undefined,
      }),
    );
  },
};

const ENTITY_FIELDS: FieldBinding[] = [{ name: 'bar_color', path: ['color'] }];
const ENTITY_SCHEMA = [{ name: 'bar_color', selector: { text: {} } }];

const HIST_AXES_FIELDS: FieldBinding[] = AXES_FIELDS.map((f) =>
  f.name === 'x_axis' ? { ...f, name: 'hist_x_axis' } : f,
);

const HISTOGRAM_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'count', path: ['count'], default: 'time' },
  { name: 'show_as', path: ['show_as'], default: 'percent' },
  { name: 'bins', path: ['bins'] },
  { name: 'bin_width', path: ['bin_width'] },
  ...X_RANGE_FIELDS,
  { name: 'bars', path: ['bars'], default: 'side' },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  ...HIST_AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

function histogramEditor(ctx: ChartEditorContext): TemplateResult {
  const hass: HomeAssistant | undefined = ctx.hass;
  const schema = cachedSchema(`histogram|${historyVariant(ctx.config)}`, hass, () => [
    ...historySchema(hass, ctx.config),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'count', selector: choice(hass, 'count', COUNT_MODES) },
        { name: 'show_as', selector: choice(hass, 'show_as', SHOW_AS) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'bins', selector: { number: { min: 1, max: MAX_BINS, mode: 'box' } } },
        { name: 'bin_width', selector: { number: { min: 0, mode: 'box', step: 'any' } } },
      ],
    },
    ...X_RANGE_SCHEMA,
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'bars', selector: choice(hass, 'bars', BARS) },
        { name: 'color_by', selector: choice(hass, 'color_by', COLOR_BY) },
      ],
    },
    ...axesSchema(hass).map((part) =>
      (part as { type?: string }).type === 'grid'
        ? {
            ...(part as object),
            schema: (part as { schema: { name: string }[] }).schema.map((f) =>
              f.name === 'x_axis' ? { ...f, name: 'hist_x_axis' } : f,
            ),
          }
        : part,
    ),
    ...layoutSchema(hass),
  ]);
  return chartForm(ctx, 'chart', schema, HISTOGRAM_FIELDS);
}
