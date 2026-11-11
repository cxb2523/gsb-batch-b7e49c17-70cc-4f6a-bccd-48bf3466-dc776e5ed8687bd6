import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { formatNumber, withUnit } from '../format';
import { shownValue } from '../history/energy';
import { localize } from '../localize';
import type { Point, Range } from '../history/types';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';
import { formatDateTime } from './axes';
import { VIEW_H, VIEW_W } from './frame';
import type { ChartSeries } from './frame';
import type { PlotScales } from './grid';

/** Room to leave for the tooltip box beside the guide, in px (a guess; names vary). */
const TOOLTIP_PX = 190;

/**
 * Which side of the guide the box goes: right if it fits, else left if it fits there, else
 * pinned to the plot's edge away from the guide (very narrow cards).
 */
export function tooltipSide(x: number, plotWidth: number): 'right' | 'left' | 'pin-left' | 'pin-right' {
  const at = x * plotWidth;
  if (at + TOOLTIP_PX <= plotWidth) return 'right';
  if (at >= TOOLTIP_PX) return 'left';
  return x > 0.5 ? 'pin-left' : 'pin-right';
}

/** How long a tooltip stays up after a finger lifts off, in ms. */
export const TOUCH_LINGER_MS = 3000;

/** Index of the point nearest in time to `t` (points sorted by time), or -1 for none. */
export function nearestIndex(points: readonly { t: number }[], t: number): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first point at or after t; the one before it may be closer.
  return lo > 0 && t - points[lo - 1].t <= points[lo].t - t ? lo - 1 : lo;
}

/** The reading time, across every series, nearest to `t`: where the guide line snaps to. */
export function snapTime(series: readonly Point[][], t: number): number | undefined {
  let best: number | undefined;
  for (const points of series) {
    const i = nearestIndex(points, t);
    if (i < 0) continue;
    const at = points[i].t;
    if (best === undefined || Math.abs(at - t) < Math.abs(best - t)) best = at;
  }
  return best;
}

interface HoverState {
  t?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const states = new WeakMap<HTMLElement, HoverState>();

function stateOf(host: HTMLElement): HoverState {
  let s = states.get(host);
  if (!s) {
    s = {};
    states.set(host, s);
  }
  return s;
}

/** The time the pointer is over on this card's chart, if any. */
export function hoverTime(host: HTMLElement): number | undefined {
  return states.get(host)?.t;
}

/** Forget the pointer (the card leaves the page). */
export function stopHover(host: HTMLElement): void {
  const s = states.get(host);
  if (s?.timer !== undefined) clearTimeout(s.timer);
  states.delete(host);
}

/** Whether the card shows a tooltip; on unless `tooltip: false`. */
export function tooltipEnabled(raw: CardConfig): boolean {
  return (raw as { tooltip?: unknown }).tooltip !== false;
}

export function validateTooltipOptions(raw: CardConfig): void {
  const v = (raw as { tooltip?: unknown }).tooltip;
  if (v !== undefined && typeof v !== 'boolean') throw new Error('"tooltip" must be true or false');
}

export interface Hover {
  move(ev: PointerEvent): void;
  leave(ev: PointerEvent): void;
}

/**
 * Pointer handlers for the plot area. Moving (or touching) snaps the guide to the nearest reading
 * and redraws only when that changes. A mouse leaving hides it at once; a finger lifting leaves
 * it up for a moment so it can be read.
 */
export function hoverHandlers(ctx: ChartContext, range: Range, series: readonly Point[][]): Hover {
  const state = stateOf(ctx.host);
  const set = (t: number | undefined) => {
    if (t === state.t) return;
    state.t = t;
    ctx.requestUpdate();
  };
  const cancelTimer = () => {
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
  };
  return {
    move(ev) {
      cancelTimer();
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const frac = rect.width > 0 ? Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) : 0;
      set(snapTime(series, range.start + frac * (range.end - range.start)));
    },
    leave(ev) {
      cancelTimer();
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
        state.timer = setTimeout(() => {
          state.timer = undefined;
          set(undefined);
        }, TOUCH_LINGER_MS);
      } else {
        set(undefined);
      }
    },
  };
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** One series' line in the tooltip: its value at the guide, formatted as the entity is (energy out reads positive). */
function valueText(p: Point | undefined, s: ChartSeries, ctx: ChartContext): string {
  if (!p || p.v === null) return '—';
  return withUnit(formatNumber(shownValue(s.entity, p.v), s.entity.decimals, ctx.hass), s.entity.unit);
}

/** The units every series shares, or '' when they differ. */
export function sharedUnit(series: readonly ChartSeries[]): string {
  const units = new Set(series.map((s) => s.entity.unit));
  return units.size === 1 ? [...units][0] : '';
}

/** A stack's total, as a tooltip's last row (`footer`). */
export function totalRow(ctx: ChartContext, value: number | null, unit: string, decimals: number): TemplateResult {
  return html`<div class="tooltip-row tooltip-total">
    <span class="swatch"></span>
    <span class="tooltip-name">${localize(ctx.hass, 'chart_total')}</span>
    <span class="tooltip-value">${value === null ? '—' : withUnit(formatNumber(value, decimals, ctx.hass), unit)}</span>
  </div>`;
}

/** What a chart other than a plain line changes in its tooltip. Every key is optional. */
export interface TooltipOptions {
  /** Where a point's dot sits, in plot units (a stacked layer sits on the ones below); null hides it. */
  dotY?: (s: ChartSeries, p: Point) => number | null;
  /** The heading for the hovered time (a whole day for a day's column); default the date and time. */
  heading?: (t: number) => string;
  /** One series' value (a low to high range); default its value with its unit. */
  text?: (s: ChartSeries, p: Point | undefined) => string;
  /** Rows after the series' own, from what each shows (a stack's total). */
  footer?: (rows: { s: ChartSeries; p: Point | undefined }[]) => TemplateResult | typeof nothing;
}

/**
 * The guide line, a dot on each series at its nearest reading, and the tooltip box listing the
 * time and every series' value. Drawn in HTML over the plot so the dots stay round. The box sits
 * beside the guide on whichever side it fits (`plotWidth` is the plot's width in px).
 */
export function tooltipLayer(
  ctx: ChartContext,
  series: readonly ChartSeries[],
  scales: PlotScales,
  t: number | undefined,
  plotWidth: number,
  options: TooltipOptions = {},
): TemplateResult | typeof nothing {
  if (t === undefined) return nothing;
  const x = scales.x(t) / VIEW_W;
  if (!(x >= 0 && x <= 1)) return nothing;
  const side = tooltipSide(x, plotWidth);
  const rows = series.map((s) => {
    const i = nearestIndex(s.points, t);
    return { s, p: i < 0 ? undefined : s.points[i] };
  });
  return html`<div class="hover-layer" aria-hidden="true">
    <div class="crosshair" style="left:${pct(x)}"></div>
    ${rows.map(({ s, p }) => {
      if (!p || p.v === null) return nothing;
      const y = options.dotY ? options.dotY(s, p) : scales.y(p.v);
      if (y === null) return nothing;
      const top = y / VIEW_H;
      if (!(top >= 0 && top <= 1)) return nothing;
      return html`<span
        class="hover-dot"
        style="left:${pct(scales.x(p.t) / VIEW_W)};top:${pct(top)};background:${s.color}"
      ></span>`;
    })}
    <div class="tooltip ${side}" style=${side.startsWith('pin') ? '' : `left:${pct(x)}`}>
      <div class="tooltip-time">${options.heading ? options.heading(t) : formatDateTime(t, ctx.hass)}</div>
      ${rows.map(
        ({ s, p }) =>
          html`<div class="tooltip-row">
            <span class="swatch" style="background:${s.color}"></span>
            <span class="tooltip-name">${s.entity.name}</span>
            <span class="tooltip-value">${options.text ? options.text(s, p) : valueText(p, s, ctx)}</span>
          </div>`,
      )}
      ${options.footer ? options.footer(rows) : nothing}
    </div>
  </div>`;
}

/** The guide, dots and box, themed from the card's own colours for light and dark. */
export const tooltipStyles = css`
  .plot-area.hoverable {
    /* A finger dragging sideways scrubs the chart; up and down still scrolls the page. */
    touch-action: pan-y;
    cursor: crosshair;
  }
  .hover-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }
  .crosshair {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--secondary-text-color);
    opacity: 0.6;
  }
  .hover-dot {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid var(--card-background-color, #fff);
    transform: translate(-50%, -50%);
  }
  .tooltip {
    position: absolute;
    top: 0;
    min-width: 0;
    max-width: 220px;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--primary-text-color);
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .tooltip.right {
    transform: translateX(10px);
  }
  .tooltip.left {
    transform: translateX(calc(-100% - 10px));
  }
  .tooltip.pin-left {
    left: 0;
  }
  .tooltip.pin-right {
    right: 0;
  }
  .tooltip-time {
    color: var(--secondary-text-color);
    margin-bottom: 2px;
    white-space: nowrap;
  }
  .tooltip-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tooltip-row .swatch {
    width: 8px;
    height: 8px;
  }
  .tooltip-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--secondary-text-color);
  }
  .tooltip-value {
    font-weight: 500;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .tooltip-total {
    margin-top: 2px;
    padding-top: 2px;
    border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
  }
  .tooltip-total .swatch {
    background: none;
  }
`;
