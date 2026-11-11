import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { formatNumber } from '../format';
import type { Range } from '../history/types';
import type { ChartContext } from '../styles/index';
import { axisOptions, timeLabel, timeTicks, timeZoneOf, valueAxis, zoneOffset } from './axes';
import type { AxisOptions, TimeUnit, ValueAxis } from './axes';
import type { Hover } from './tooltip';
import { VIEW_H, VIEW_W, plot } from './frame';
import { linear } from './scale';
import { logAxis, logScale, logTickText } from './log-scale';

/** Gaps between value labels on a full-height plot: about one per 40 px. */
const VALUE_GAPS = 4;
/** Room each time label needs, in px, when choosing how many fit. */
const TIME_LABEL_PX = 70;
/** Width to assume before the card has been measured. */
const DEFAULT_WIDTH = 400;

interface Size {
  width: number;
  observer?: ResizeObserver;
}

const sizes = new WeakMap<HTMLElement, Size>();

/**
 * The card's last measured width. The first call starts watching it, and a change big enough to
 * alter the number of time labels asks the card to draw again.
 */
export function chartWidth(ctx: Pick<ChartContext, 'host' | 'requestUpdate'>): number {
  let size = sizes.get(ctx.host);
  if (!size) {
    const entry: Size = { width: ctx.host.clientWidth || DEFAULT_WIDTH };
    size = entry;
    sizes.set(ctx.host, entry);
    if (typeof ResizeObserver !== 'undefined') {
      entry.observer = new ResizeObserver((records) => {
        const width = Math.round(records[records.length - 1].contentRect.width);
        if (Math.round(width / TIME_LABEL_PX) === Math.round(entry.width / TIME_LABEL_PX)) return;
        entry.width = width;
        ctx.requestUpdate();
      });
      entry.observer.observe(ctx.host);
    }
  }
  return size.width;
}

/** Stop watching the card's width (it leaves the page); the next draw starts again. */
export function stopChartWidth(host: HTMLElement): void {
  sizes.get(host)?.observer?.disconnect();
  sizes.delete(host);
}

/** Rough width of the plot itself in px: the card less its padding and value labels. */
export function plotWidth(ctx: ChartContext): number {
  const y = axisOptions(ctx.raw);
  return Math.max(0, chartWidth(ctx) - 32 - (y.y && y.labels === 'outside' ? 40 : 0));
}

export interface PlotScales {
  x: (t: number) => number;
  y: (v: number) => number;
  domain: [number, number];
}

/** Everything a history chart needs to draw its frame: options, ticks and the scales they fit. */
export interface PlotAxes {
  options: AxisOptions;
  value: ValueAxis;
  times: number[];
  unit: TimeUnit;
  range: Range;
  scales: PlotScales;
  /** The text under each time label, when a chart names its own (a column's day); else the time's. */
  label?: (t: number) => string;
}

/**
 * Work out the axes for readings spanning `data` over `range`, sized to the plot (or to `width`
 * px, for a chart drawn smaller than the card) and `gaps` value labels.
 */
export function plotAxes(
  ctx: ChartContext,
  range: Range,
  data: [number, number] | undefined,
  width?: number,
  gaps = VALUE_GAPS,
): PlotAxes {
  const options = axisOptions(ctx.raw);
  // Only the line chart draws on a log scale: columns and stacked areas stand on zero.
  const log = options.scale === 'log' && ctx.raw.style === 'line';
  const value = log ? logAxis(data, options, gaps) : valueAxis(data, options, gaps);
  // Count labels across the plot itself, not the card: the value labels take part of the width.
  const count = Math.max(2, Math.min(8, Math.floor((width ?? plotWidth(ctx)) / TIME_LABEL_PX)));
  const { unit, ticks } = timeTicks(range, count, zoneOffset(timeZoneOf(ctx.hass)));
  return {
    options,
    value,
    times: ticks,
    unit,
    range,
    scales: {
      x: linear([range.start, range.end], [0, VIEW_W]),
      y: (log ? logScale : linear)(value.domain, [VIEW_H, 0]),
      domain: value.domain,
    },
  };
}

/** Gridlines behind the data: across at each value label, down at each time label. */
function gridLines(axes: PlotAxes): SVGTemplateResult {
  const { options, scales } = axes;
  return svg`<g class="grid">
    ${options.horizontal ? (axes.value.minor ?? []).map((v) => svg`<line class="minor" x1="0" x2=${VIEW_W} y1=${scales.y(v)} y2=${scales.y(v)}></line>`) : nothing}
    ${options.horizontal ? axes.value.ticks.map((v) => svg`<line x1="0" x2=${VIEW_W} y1=${scales.y(v)} y2=${scales.y(v)}></line>`) : nothing}
    ${options.vertical ? axes.times.map((t) => svg`<line x1=${scales.x(t)} x2=${scales.x(t)} y1="0" y2=${VIEW_H}></line>`) : nothing}
  </g>`;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** The text of the i-th value label: log axes give each tick its own decimals and shorten big ones. */
function tickText(value: ValueAxis, i: number, ctx: ChartContext): string {
  const v = value.ticks[i];
  return value.tickDecimals
    ? logTickText(v, value.tickDecimals[i], ctx.hass)
    : formatNumber(v, value.decimals, ctx.hass);
}

function valueLabels(axes: PlotAxes, ctx: ChartContext, format?: (v: number) => string) {
  const { scales, value } = axes;
  return value.ticks.map((v, i) => {
    const top = scales.y(v) / VIEW_H;
    // Inside the plot the top label hangs below its line, so it doesn't leave the chart.
    const end = top < 0.08 ? 'top' : top > 0.92 ? 'bottom' : '';
    return html`<span class="axis-label ${end}" style="top:${pct(top)}"
      >${format ? format(v) : tickText(value, i, ctx)}</span
    >`;
  });
}

function timeLabels(axes: PlotAxes, ctx: ChartContext, format?: (v: number) => string) {
  const { scales, range } = axes;
  const offset = zoneOffset(timeZoneOf(ctx.hass));
  return axes.times.map((t) => {
    const left = scales.x(t) / VIEW_W;
    // Labels near an edge line up with it instead of centring off the chart.
    const edge = left < 0.05 ? 'start' : left > 0.95 ? 'end' : '';
    return html`<span class="axis-label ${edge}" style="left:${pct(left)}"
      >${format ? format(t) : axes.label ? axes.label(t) : timeLabel(t, axes.unit, range.end - range.start, ctx.hass, offset)}</span
    >`;
  });
}

/** A second value axis, up the right side, for series in another unit. */
export interface RightAxis {
  value: ValueAxis;
  /** Value to plot units, as `PlotScales.y`. */
  y: (v: number) => number;
}

function rightLabels(right: RightAxis, ctx: ChartContext) {
  return right.value.ticks.map((v) => {
    const top = right.y(v) / VIEW_H;
    const end = top < 0.08 ? 'top' : top > 0.92 ? 'bottom' : '';
    return html`<span class="axis-label ${end}" style="top:${pct(top)}"
      >${formatNumber(v, right.value.decimals, ctx.hass)}</span
    >`;
  });
}

export interface ChartAreaOptions {
  axes: PlotAxes;
  ctx: ChartContext;
  /** The data, drawn in the stretched SVG over the gridlines. */
  content: SVGTemplateResult;
  label: string;
  defs?: SVGTemplateResult | typeof nothing;
  /** HTML over the plot (point labels, a tooltip), positioned in percent of the plot. */
  overlay?: TemplateResult | typeof nothing;
  /** Pointer handlers for a hover tooltip; the plot then takes sideways touch drags. */
  hover?: Hover;
  /** A second value axis on the right. */
  right?: RightAxis;
  /** Text for each label along the bottom or up the side, when they aren't times and plain values. */
  xLabel?: (v: number) => string;
  yLabel?: (v: number) => string;
  /** Fuller pointer handling (zoom and pan), wrapping the tooltip's; used instead of `hover`. */
  gestures?: Gestures;
  /** Extra classes on the plot area, for a feature's own look (`zoomable`, `zoomed`). */
  classes?: string;
  /** Under the plot and its time labels, lined up with the plot (an overview strip). */
  below?: TemplateResult | typeof nothing;
  /** Extra classes and inline style on the whole frame, for what `below` needs (its height). */
  wrapClasses?: string;
  wrapStyle?: string;
}

/** Every pointer handler the plot area can take. */
export interface Gestures {
  down(ev: PointerEvent): void;
  move(ev: PointerEvent): void;
  up(ev: PointerEvent): void;
  cancel(ev: PointerEvent): void;
  leave(ev: PointerEvent): void;
  wheel(ev: WheelEvent): void;
  dblclick(ev: MouseEvent): void;
}

/**
 * The plot with its gridlines and axis labels. Text stays in HTML, positioned in percent, so the
 * stretched SVG never distorts it. Outside labels get their own column and row; inside ones sit
 * over the plot's left and bottom edges.
 */
export function chartArea({
  axes,
  ctx,
  content,
  label,
  defs = nothing,
  overlay = nothing,
  hover,
  right,
  xLabel,
  yLabel,
  gestures,
  classes = '',
  below = nothing,
  wrapClasses = '',
  wrapStyle = '',
}: ChartAreaOptions) {
  const { options } = axes;
  const outside = options.labels === 'outside';
  const y = options.y && axes.value.ticks.length > 0;
  const x = options.x && axes.times.length > 0;
  const yTicks = y ? valueLabels(axes, ctx, yLabel) : [];
  const yLabels = y ? html`<div class="y-axis">${yTicks}</div>` : nothing;
  const xLabels = x ? html`<div class="x-axis">${timeLabels(axes, ctx, xLabel)}</div>` : nothing;
  const sizer = y
    ? html`<span class="axis-sizer" aria-hidden="true"
        >${axes.value.ticks
          .map((v, i) => (yLabel ? yLabel(v) : tickText(axes.value, i, ctx)))
          .reduce((a, b) => (b.length > a.length ? b : a), '')}</span
      >`
    : nothing;
  const r = right && options.y && right.value.ticks.length > 0 ? right : undefined;
  const rSizer = r
    ? html`<span class="axis-sizer" aria-hidden="true"
        >${r.value.ticks
          .map((v) => formatNumber(v, r.value.decimals, ctx.hass))
          .reduce((a, b) => (b.length > a.length ? b : a), '')}</span
      >`
    : nothing;
  const rLabels = r
    ? html`<div class="y-axis right">${outside ? rSizer : nothing}${rightLabels(r, ctx)}</div>`
    : nothing;
  const wrap = `plot-wrap axes-${options.labels} ${y ? 'has-y' : ''} ${x ? 'has-x' : ''} ${r ? 'has-right' : ''} ${below === nothing ? '' : 'has-overview'} ${wrapClasses}`;
  return html`<div class=${wrap} style=${wrapStyle}>
    ${outside && y ? html`<div class="y-axis">${sizer}${yTicks}</div>` : nothing}
    <div
      class="plot-area ${hover ? 'hoverable' : ''} ${classes}"
      @pointerdown=${gestures?.down ?? hover?.move}
      @pointermove=${gestures?.move ?? hover?.move}
      @pointerup=${gestures?.up}
      @pointerleave=${gestures?.leave ?? hover?.leave}
      @pointercancel=${gestures?.cancel ?? hover?.leave}
      @wheel=${gestures?.wheel}
      @dblclick=${gestures?.dblclick}
    >
      ${plot(content, label, defs, gridLines(axes))} ${outside ? nothing : html`${yLabels}${rLabels}${xLabels}`}
      ${overlay}
    </div>
    ${outside ? html`${rLabels}${xLabels}` : nothing} ${below}
  </div>`;
}

/** Shared look of the frame: the grid layout, gridlines and axis labels, light and dark. */
export const gridStyles = css`
  .plot-wrap {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .plot-area {
    position: relative;
    grid-column: 2;
    grid-row: 1;
    min-height: 0;
  }
  .plot .grid line {
    stroke: var(--divider-color, rgba(127, 127, 127, 0.25));
    stroke-width: 1;
  }
  .plot .grid line.minor {
    opacity: 0.45;
  }
  .axis-label {
    position: absolute;
    font-size: 11px;
    line-height: 1;
    color: var(--secondary-text-color);
    white-space: nowrap;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  /* Room for half of the top value label, which is centred on the plot's top edge. */
  .plot-wrap.axes-outside.has-y {
    padding-top: 6px;
    box-sizing: border-box;
  }
  .axes-outside .y-axis {
    position: relative;
    grid-column: 1;
    grid-row: 1;
    padding-right: 6px;
  }
  .axes-outside .y-axis .axis-label {
    right: 6px;
    transform: translateY(-50%);
  }
  .axis-sizer {
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .axes-outside .x-axis {
    position: relative;
    grid-column: 2;
    grid-row: 2;
    height: 18px;
  }
  .axes-outside .x-axis .axis-label {
    top: 5px;
  }
  .x-axis .axis-label {
    transform: translateX(-50%);
  }
  .x-axis .axis-label.start {
    transform: none;
  }
  .x-axis .axis-label.end {
    transform: translateX(-100%);
  }
  .plot-wrap.has-right {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .axes-outside .y-axis.right {
    grid-column: 3;
    padding-right: 0;
    padding-left: 6px;
  }
  .axes-outside .y-axis.right .axis-label {
    right: auto;
    left: 6px;
  }
  .axes-inside .y-axis.right .axis-label {
    left: auto;
    right: 2px;
  }
  .axes-inside .y-axis,
  .axes-inside .x-axis {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .axes-inside .y-axis .axis-label {
    left: 2px;
    transform: translateY(calc(-100% - 2px));
    font-size: 10px;
  }
  /* Over the plot, the bottom value label would collide with the first time label. */
  .axes-inside.has-x .y-axis .axis-label.bottom {
    visibility: hidden;
  }
  .axes-inside .y-axis .axis-label.top {
    transform: translateY(3px);
  }
  .axes-inside .x-axis .axis-label {
    bottom: 3px;
    font-size: 10px;
  }
  .axes-inside .axis-label {
    padding: 0 2px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--card-background-color, #fff) 70%, transparent);
  }
`;
