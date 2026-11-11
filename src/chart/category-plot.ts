import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { hour12Of, niceStep, valueAxis } from './axes';
import { chartWidth } from './grid';
import type { XY } from './paths';
import { linear } from './scale';
import { choice } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber } from '../format';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';

/**
 * A plot of one band per category (an entity, or an entity's day) along a value axis, across
 * (horizontal: one row each, values left to right) or up (vertical: one column each, values
 * bottom to top). Shared by the distribution charts (violin, raincloud, beeswarm): they draw into
 * a band with `at(value, band, offset)` and never need to know which way round it is.
 */

export const ORIENTATIONS = ['horizontal', 'vertical'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** Plot units along the value axis; each band is BAND units across. */
export const VALUE_LEN = 1000;
export const BAND = 100;

/** Row height (px) per category across, and how much of it a compact card keeps. */
const ROW_PX = 64;
const COMPACT_ROW = 0.69;
/** Plot height (px) when the categories stand up, normal and compact. */
const COLUMN_PX = 180;
const COMPACT_COLUMN_PX = 110;
/** Room a value label needs along the axis (px), when choosing how many fit. */
const LABEL_PX = 64;

export interface Category {
  /** Index into the card's items, for its tap action. */
  index: number;
  name: string;
  /** A second line under the name: a median, a count. */
  detail: string;
  color: string;
  /** Read out for the category. */
  label: string;
}

/** The value axis: its ends, where the labels go and how they read. */
export interface ValueScale {
  domain: [number, number];
  ticks: number[];
  format(v: number): string;
}

export interface CategoryGeometry {
  orientation: Orientation;
  count: number;
  /** The SVG's coordinate box. */
  width: number;
  height: number;
  /** Plot position of value `v` in band `i`, `f` across the band (−0.5…0.5, 0 is its middle). */
  at(v: number, i: number, f?: number): XY;
  /** Roughly how many px the value axis and one band are on screen. */
  valuePx: number;
  bandPx: number;
}

/** The distribution charts' shared axis options: orientation, value labels, lines, fixed ends. */
export interface CategoryOptions {
  orientation: Orientation;
  axis: boolean;
  grid: boolean;
  min?: number;
  max?: number;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The editor fields every distribution chart shares (see `categorySchema`). */
export const CATEGORY_FIELDS: FieldBinding[] = [
  { name: 'orientation', path: ['orientation'], default: 'horizontal' },
  { name: 'value_axis', path: ['value_axis'], default: true },
  { name: 'value_grid', path: ['value_grid'], default: true },
  { name: 'value_min', path: ['value_min'] },
  { name: 'value_max', path: ['value_max'] },
  { name: 'tooltip', path: ['tooltip'], default: true },
  { name: 'compact', path: ['compact'], default: false },
];

/** Direction, the value axis, the hover box and compact spacing, as ha-form schema. */
export function categorySchema(hass: HomeAssistant | undefined): unknown[] {
  return [
    { name: 'orientation', selector: choice(hass, 'orientation', ORIENTATIONS) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'value_axis', selector: { boolean: {} } },
        { name: 'value_grid', selector: { boolean: {} } },
        { name: 'value_min', selector: { number: { mode: 'box', step: 'any' } } },
        { name: 'value_max', selector: { number: { mode: 'box', step: 'any' } } },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'tooltip', selector: { boolean: {} } },
        { name: 'compact', selector: { boolean: {} } },
      ],
    },
  ];
}

/** Checks the shared options; `compact` and `tooltip` too, as these charts don't use the line chart's checks. */
export function validateCategoryOptions(raw: CardConfig): void {
  for (const k of ['compact', 'tooltip']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  if (raw.orientation !== undefined && !ORIENTATIONS.includes(raw.orientation as Orientation)) {
    throw new Error(`"orientation" must be one of: ${ORIENTATIONS.join(', ')}`);
  }
  for (const k of ['value_axis', 'value_grid']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  for (const k of ['value_min', 'value_max']) {
    if (raw[k] !== undefined && !isNumber(raw[k])) throw new Error(`"${k}" must be a number`);
  }
  if (isNumber(raw.value_min) && isNumber(raw.value_max) && raw.value_min >= raw.value_max) {
    throw new Error('"value_min" must be below "value_max"');
  }
}

export function categoryOptions(raw: CardConfig): CategoryOptions {
  return {
    orientation: (raw.orientation as Orientation | undefined) ?? 'horizontal',
    axis: raw.value_axis !== false,
    grid: raw.value_grid !== false,
    min: isNumber(raw.value_min) ? raw.value_min : undefined,
    max: isNumber(raw.value_max) ? raw.value_max : undefined,
  };
}

/** Width of the name column across (px) for a card `width` wide: 30 %, between 64 and 140 px. */
export function labelColumn(width: number): number {
  return Math.min(140, Math.max(64, Math.round((width - 32) * 0.3)));
}

/** Where everything goes for `count` categories on this card; `rowPx` is a row's height across. */
export function categoryGeometry(
  ctx: Pick<ChartContext, 'host' | 'requestUpdate' | 'raw'>,
  count: number,
  scale: Pick<ValueScale, 'domain'>,
  rowPx = ROW_PX,
): CategoryGeometry {
  const o = categoryOptions(ctx.raw);
  const compact = ctx.raw.compact === true;
  const width = chartWidth(ctx);
  const n = Math.max(1, count);
  if (o.orientation === 'horizontal') {
    const x = linear(scale.domain, [0, VALUE_LEN]);
    return {
      orientation: o.orientation,
      count: n,
      width: VALUE_LEN,
      height: n * BAND,
      at: (v, i, f = 0) => [x(v), (i + 0.5 + f) * BAND],
      valuePx: Math.max(40, width - 32 - labelColumn(width) - 8),
      // Many rows (a violin per day for a month) get thinner, so the card stays a sensible height.
      bandPx: Math.min(compact ? Math.round(rowPx * COMPACT_ROW) : rowPx, n > 12 ? 28 : n > 6 ? 40 : Infinity),
    };
  }
  const y = linear(scale.domain, [VALUE_LEN, 0]);
  const plotPx = Math.max(40, width - 32 - (o.axis ? 40 : 0));
  return {
    orientation: o.orientation,
    count: n,
    width: n * BAND,
    height: VALUE_LEN,
    at: (v, i, f = 0) => [(i + 0.5 + f) * BAND, y(v)],
    valuePx: compact ? COMPACT_COLUMN_PX : COLUMN_PX,
    bandPx: plotPx / n,
  };
}

/** How many value labels fit along an axis `px` long. */
export function labelCount(px: number, orientation: Orientation): number {
  return orientation === 'horizontal' ? Math.max(2, Math.min(8, Math.floor(px / LABEL_PX))) : px > 140 ? 4 : 3;
}

/** A value axis over readings spanning `data`, labelled as the entity reads. */
export function numberScale(
  data: [number, number] | undefined,
  raw: CardConfig,
  count: number,
  hass: HomeAssistant | undefined,
): ValueScale {
  const o = categoryOptions(raw);
  const axis = valueAxis(data, { min: o.min, max: o.max }, count);
  return { domain: axis.domain, ticks: axis.ticks, format: (v) => formatNumber(v, axis.decimals, hass) };
}

/** Hours of the day, 0 to 24, labelled as clock times in the user's clock (24 or 12 hour). */
export function clockScale(count: number, hass: HomeAssistant | undefined): ValueScale {
  const step = niceHours(24 / Math.max(1, count));
  const ticks: number[] = [];
  for (let h = 0; h <= 24; h += step) ticks.push(h);
  let format: Intl.DateTimeFormat;
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: hour12Of(hass),
  };
  try {
    format = new Intl.DateTimeFormat(hass?.locale?.language ?? hass?.language ?? 'en', options);
  } catch {
    format = new Intl.DateTimeFormat('en', options);
  }
  return { domain: [0, 24], ticks, format: (v) => format.format(Date.UTC(2000, 0, 1, 0, Math.round(v * 60))) };
}

/** 1, 2, 3, 4, 6 or 12 hours: steps that divide a day evenly. */
function niceHours(span: number): number {
  for (const h of [1, 2, 3, 4, 6, 12]) if (h >= span) return h;
  return Math.max(12, niceStep(span, 1));
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** Tooltip state: which band the pointer is over, per card. */
const hovered = new WeakMap<HTMLElement, number>();

export function hoveredBand(host: HTMLElement): number | undefined {
  return hovered.get(host);
}

export function stopCategoryHover(host: HTMLElement): void {
  hovered.delete(host);
}

/** Pointer handlers that track which band is under the pointer and redraw when it changes. */
function hoverHandlers(ctx: Pick<ChartContext, 'host' | 'requestUpdate'>, geometry: CategoryGeometry) {
  const set = (i: number | undefined) => {
    if (hovered.get(ctx.host) === i) return;
    if (i === undefined) hovered.delete(ctx.host);
    else hovered.set(ctx.host, i);
    ctx.requestUpdate();
  };
  return {
    move(ev: PointerEvent) {
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const across = geometry.orientation === 'horizontal';
      const size = across ? rect.height : rect.width;
      const at = across ? ev.clientY - rect.top : ev.clientX - rect.left;
      if (!(size > 0)) return;
      set(Math.min(geometry.count - 1, Math.max(0, Math.floor((at / size) * geometry.count))));
    },
    leave() {
      set(undefined);
    },
  };
}

/** A box of name–value rows beside band `i`, for the band under the pointer. */
export function bandTooltip(
  geometry: CategoryGeometry,
  i: number,
  title: string,
  rows: [string, string][],
  color: string,
): TemplateResult {
  const middle = (i + 0.5) / geometry.count;
  const across = geometry.orientation === 'horizontal';
  // Across, the box sits below its row (above it in the bottom half); up, beside its column.
  const place = across
    ? middle > 0.5
      ? `top:auto;bottom:${pct(1 - i / geometry.count)};right:0`
      : `top:${pct((i + 1) / geometry.count)};right:0`
    : middle > 0.5
      ? `top:0;right:${pct(1 - i / geometry.count)}`
      : `top:0;left:${pct((i + 1) / geometry.count)}`;
  return html`<div class="hover-layer" aria-hidden="true">
    <div class="tooltip band-tooltip" style=${place}>
      <div class="tooltip-time"><span class="swatch" style="background:${color}"></span> ${title}</div>
      ${rows.map(
        ([name, value]) =>
          html`<div class="tooltip-row">
            <span class="tooltip-name">${name}</span>
            <span class="tooltip-value">${value}</span>
          </div>`,
      )}
    </div>
  </div>`;
}

export interface CategoryPlotOptions {
  ctx: ChartContext;
  geometry: CategoryGeometry;
  categories: Category[];
  scale: ValueScale;
  /** The drawing, in the geometry's coordinates. */
  content: SVGTemplateResult;
  label: string;
  /** HTML over the plot (a tooltip). */
  overlay?: TemplateResult | typeof nothing;
  /** Whether to follow the pointer for a tooltip. */
  hover?: boolean;
}

/** The plot, its value labels and gridlines, and a name (and detail) for each category. */
export function categoryPlot({
  ctx,
  geometry,
  categories,
  scale,
  content,
  label,
  overlay = nothing,
  hover = false,
}: CategoryPlotOptions): TemplateResult {
  const o = categoryOptions(ctx.raw);
  const across = geometry.orientation === 'horizontal';
  const position = (v: number) => {
    const [x, y] = geometry.at(v, 0);
    return across ? x / geometry.width : y / geometry.height;
  };
  const ticks = scale.ticks.filter((v) => v >= scale.domain[0] && v <= scale.domain[1]);
  const grid = o.grid
    ? svg`<g class="grid">${ticks.map((v) => {
        const [x, y] = geometry.at(v, 0);
        return across
          ? svg`<line x1=${x} x2=${x} y1="0" y2=${geometry.height}></line>`
          : svg`<line x1="0" x2=${geometry.width} y1=${y} y2=${y}></line>`;
      })}</g>`
    : nothing;
  const values =
    o.axis && ticks.length
      ? html`<div class="cat-axis">
          ${
            across
              ? nothing
              : html`<span class="cat-sizer" aria-hidden="true"
                  >${ticks.map(scale.format).reduce((a, b) => (b.length > a.length ? b : a), '')}</span
                >`
          }
          ${ticks.map((v) => {
            const at = position(v);
            const edge = across ? (at < 0.04 ? 'start' : at > 0.96 ? 'end' : '') : at < 0.08 ? 'top' : '';
            return html`<span class="axis-label ${edge}" style="${across ? 'left' : 'top'}:${pct(at)}"
              >${scale.format(v)}</span
            >`;
          })}
        </div>`
      : nothing;
  const handlers = hover ? hoverHandlers(ctx, geometry) : undefined;
  const names = html`<div class="cat-labels">
    ${categories.map(
      (c) =>
        html`<div class="entity cat-label" data-index=${c.index} tabindex="0" aria-label=${c.label}>
          <span class="cat-name"><span class="swatch" style="background:${c.color}"></span>${c.name}</span>
          ${c.detail ? html`<span class="cat-detail">${c.detail}</span>` : nothing}
        </div>`,
    )}
  </div>`;
  const size = across ? `height:${geometry.count * geometry.bandPx}px` : `height:${geometry.valuePx}px`;
  const dense = across && geometry.bandPx < 40;
  return html`<div
    class="cat-plot ${geometry.orientation} ${values === nothing ? '' : 'has-axis'} ${dense ? 'dense' : ''}"
  >
    ${across ? names : values}
    <div
      class="plot-area ${hover ? 'hoverable' : ''}"
      style=${size}
      @pointerdown=${handlers?.move}
      @pointermove=${handlers?.move}
      @pointerleave=${handlers?.leave}
      @pointercancel=${handlers?.leave}
    >
      <svg
        class="plot"
        viewBox="0 0 ${geometry.width} ${geometry.height}"
        preserveAspectRatio="none"
        role="img"
        aria-label=${label}
      >
        ${grid}
        <g class="cat-content">${content}</g>
      </svg>
      ${overlay}
    </div>
    ${across ? values : names}
  </div>`;
}

export const categoryStyles = css`
  .cat-plot {
    display: grid;
    gap: 0 8px;
  }
  .cat-plot.horizontal {
    grid-template-columns: clamp(64px, 30%, 140px) minmax(0, 1fr);
  }
  .cat-plot.vertical {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .cat-plot .plot-area {
    position: relative;
    min-width: 0;
  }
  .cat-plot.horizontal .plot-area,
  .cat-plot.vertical .plot-area {
    grid-column: 2;
    grid-row: 1;
  }
  .cat-plot .plot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .cat-plot .plot path,
  .cat-plot .plot line,
  .cat-plot .plot rect {
    vector-effect: non-scaling-stroke;
  }
  .cat-plot .grid line {
    stroke: var(--divider-color, rgba(127, 127, 127, 0.25));
    stroke-width: 1;
  }
  .cat-content {
    opacity: 0;
    transition: opacity var(--cd-duration) var(--cd-easing);
  }
  :host([ready]) .cat-content {
    opacity: 1;
  }
  :host([static]) .cat-content {
    transition: none;
  }
  .cat-labels {
    display: flex;
    min-width: 0;
  }
  .horizontal .cat-labels {
    grid-column: 1;
    grid-row: 1;
    flex-direction: column;
  }
  .vertical .cat-labels {
    grid-column: 2;
    grid-row: 2;
    padding-top: 4px;
  }
  .cat-label {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    flex: 1 1 0;
    cursor: pointer;
    border-radius: 4px;
  }
  .vertical .cat-label {
    align-items: center;
    text-align: center;
  }
  .cat-label:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
  .cat-name,
  .cat-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .cat-name {
    font-size: 0.875em;
  }
  .cat-name .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    vertical-align: middle;
  }
  .cat-detail {
    font-size: 0.75em;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }
  .frame.compact .cat-detail,
  .cat-plot.dense .cat-detail {
    display: none;
  }
  .cat-axis {
    position: relative;
  }
  .horizontal .cat-axis {
    grid-column: 2;
    grid-row: 2;
    height: 18px;
  }
  .horizontal .cat-axis .axis-label {
    top: 5px;
    transform: translateX(-50%);
  }
  .horizontal .cat-axis .axis-label.start {
    transform: none;
  }
  .horizontal .cat-axis .axis-label.end {
    transform: translateX(-100%);
  }
  .vertical .cat-axis {
    grid-column: 1;
    grid-row: 1;
    min-width: 24px;
  }
  .vertical .cat-axis .axis-label {
    right: 0;
    transform: translateY(-50%);
  }
  .vertical .cat-axis .axis-label.top {
    transform: none;
  }
  .cat-plot .axis-label {
    position: absolute;
    font-size: 11px;
    line-height: 1;
    color: var(--secondary-text-color);
    white-space: nowrap;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .cat-sizer {
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .band-tooltip {
    position: absolute;
    min-width: 120px;
  }
  .band-tooltip .tooltip-time {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .band-tooltip .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
`;
