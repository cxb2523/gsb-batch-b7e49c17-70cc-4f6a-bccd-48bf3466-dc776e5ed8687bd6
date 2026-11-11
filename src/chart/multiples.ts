import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';
import type { ChartSeries, HistoryFrame } from './frame';
import { chartWidth, plotAxes } from './grid';
import type { PlotAxes } from './grid';
import { extent } from './scale';
import { nearestIndex } from './tooltip';

/** How small multiples share their value axis: one scale for all, or each its own. */
export const MULTIPLES_SCALES = ['auto', 'shared', 'independent'] as const;
export type MultiplesScale = (typeof MULTIPLES_SCALES)[number];

export const MAX_MULTIPLES_COLUMNS = 6;
/** Narrowest a small chart gets when the card picks the number of columns, px. */
export const MIN_PANEL_PX = 150;
/** Room between small charts, px (matches the grid's gap). */
const GAP_PX = 12;
/** Fewer value labels on a small chart. */
const PANEL_GAPS = 2;

export interface MultiplesOptions {
  scale: MultiplesScale;
  /** Columns in the grid; undefined lets the card fit as many as are at least MIN_PANEL_PX. */
  columns?: number;
}

export function validateMultiples(raw: CardConfig): void {
  if (raw.multiples !== undefined && typeof raw.multiples !== 'boolean') {
    throw new Error('"multiples" must be true or false');
  }
  if (raw.multiples_scale !== undefined && !MULTIPLES_SCALES.includes(raw.multiples_scale as MultiplesScale)) {
    throw new Error(`"multiples_scale" must be one of: ${MULTIPLES_SCALES.join(', ')}`);
  }
  const c = raw.multiples_columns;
  if (c !== undefined && !(Number.isInteger(c) && (c as number) >= 1 && (c as number) <= MAX_MULTIPLES_COLUMNS)) {
    throw new Error(`"multiples_columns" must be a whole number from 1 to ${MAX_MULTIPLES_COLUMNS}`);
  }
}

/** The card's small-multiples options, or undefined when it draws one chart. */
export function multiplesOptions(raw: CardConfig): MultiplesOptions | undefined {
  if (raw.multiples !== true) return undefined;
  return {
    scale: (raw.multiples_scale as MultiplesScale | undefined) ?? 'auto',
    columns: raw.multiples_columns as number | undefined,
  };
}

/** A set number of columns drops to fewer before a chart gets narrower than this, px. */
export const MIN_SET_PANEL_PX = 110;

/**
 * Columns the grid will have for `count` charts on a card `width` px wide: as many as fit at
 * MIN_PANEL_PX, or the number asked for while each stays at least MIN_SET_PANEL_PX.
 */
export function multiplesColumns(count: number, width: number, columns?: number): number {
  const fits = (px: number) => Math.max(1, Math.floor((width + GAP_PX) / (px + GAP_PX)));
  const cols = columns === undefined ? fits(MIN_PANEL_PX) : Math.min(columns, fits(MIN_SET_PANEL_PX));
  return Math.max(1, Math.min(count, cols));
}

/** Width of one small chart, px, for `cols` columns on a card `width` px wide. */
export function panelWidth(width: number, cols: number): number {
  return Math.max(0, (width - (cols - 1) * GAP_PX) / cols);
}

/** A small chart's title value: its reading at the guide while one is shown, else its current value. */
function titleValue(s: ChartSeries, t: number | undefined, ctx: ChartContext): string {
  if (t === undefined) return s.entity.display;
  const i = nearestIndex(s.points, t);
  const p = i < 0 ? undefined : s.points[i];
  if (!p || p.v === null) return '—';
  return withUnit(formatNumber(p.v, s.entity.decimals, ctx.hass), s.entity.unit);
}

/**
 * One small chart per series in a grid, sharing the time axis and (with `scale: shared`) the
 * value axis, so many sensors compare at a glance. `draw` draws one series into its own plot,
 * with its axes and its width in px. Each chart's title is the series' name and value, which
 * opens it like the header does; while the pointer is over any chart, every title shows its
 * reading at that moment.
 */
export function multiplesGrid(
  ctx: ChartContext,
  frame: HistoryFrame,
  options: MultiplesOptions,
  hover: number | undefined,
  draw: (series: ChartSeries, axes: PlotAxes, width: number) => TemplateResult,
): TemplateResult {
  const width = Math.max(0, chartWidth(ctx) - 32);
  const cols = multiplesColumns(frame.series.length, width, options.columns);
  const panel = panelWidth(width, cols);
  // Automatic: one scale when every entity reads in the same unit; a scale each when they don't
  // (temperatures on a power scale would be flat lines).
  const units = new Set(frame.series.map((s) => s.entity.unit).filter((u) => u !== ''));
  const share = options.scale === 'shared' || (options.scale === 'auto' && units.size <= 1);
  // A series' faint line of hidden readings (`hidden`) fits on its axis too.
  const lists = (s: ChartSeries) => (s.hidden ? [s.points, s.hidden] : [s.points]);
  const shared = share ? extent(frame.series.flatMap(lists)) : undefined;
  const { show } = ctx.config;
  const grid = `grid-template-columns:repeat(${cols}, minmax(0, 1fr))`;
  return html`<div class="multiples" style=${grid}>
    ${frame.series.map((s) => {
      const axes = plotAxes(ctx, frame.range, shared ?? extent(lists(s)), panel, PANEL_GAPS);
      const title =
        show.name || show.value
          ? html`<div class="entity panel-title" data-index=${s.index} tabindex="0" aria-label=${s.entity.label}>
              <span class="swatch" style="background:${s.color}"></span>
              ${show.name ? html`<span class="series-name">${s.entity.name}</span>` : nothing}
              ${show.value ? html`<span class="series-value">${titleValue(s, hover, ctx)}</span>` : nothing}
            </div>`
          : nothing;
      // An entity with no readings in the span (unavailable, missing) says so in its own place.
      const body = s.points.some((p) => p.v !== null)
        ? draw(s, axes, panel)
        : html`<div class="chart-message">${localize(ctx.hass, 'chart_no_data')}</div>`;
      return html`<div class="panel">${title}${body}</div>`;
    })}
  </div>`;
}

export const multiplesStyles = css`
  .multiples {
    display: grid;
    gap: 8px ${GAP_PX}px;
  }
  .panel {
    min-width: 0;
  }
  .panel-title {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    padding-bottom: 2px;
    cursor: pointer;
    border-radius: 4px;
  }
  .panel-title:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }
  .panel-title .series-name {
    flex: 0 1 auto;
  }
  .panel-title .series-value {
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.9375em;
    font-variant-numeric: tabular-nums;
  }
  .multiples .plot-wrap,
  .multiples .chart-message {
    height: 100px;
  }
  .frame.compact .multiples .plot-wrap,
  .frame.compact .multiples .chart-message {
    height: 70px;
  }
  .multiples .chart-message {
    font-size: 0.8125em;
  }
  .frame.compact .multiples {
    gap: 4px 10px;
  }
  /* The guide shows on every small chart; the box only on the one being pointed at. */
  .panel:not(:hover) .tooltip {
    display: none;
  }
`;
