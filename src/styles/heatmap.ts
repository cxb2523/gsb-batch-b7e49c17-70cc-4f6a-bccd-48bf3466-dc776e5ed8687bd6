import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { bandFor, baseColor, legendItems } from '../bands';
import { hour12Of } from '../chart/axes';
import {
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartWidth, stopChartWidth } from '../chart/grid';
import { HEX_ROW, calendarCells, colorExtent, fraction, hexPath, shade, weekCells } from '../chart/heatmap-grid';
import { tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import { pickHandlers, pickTooltip, pickedIndex, stopPick } from '../chart/xy';
import {
  HISTORY_FIELDS,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  historyVariant,
} from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { AGGREGATES } from '../history/group';
import { localize } from '../localize';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig, HomeAssistant } from '../types';

export const HEATMAP_GRIDS = ['hours', 'calendar'] as const;
export type HeatmapGrid = (typeof HEATMAP_GRIDS)[number];
export const HEATMAP_COLORS = ['scale', 'bands'] as const;
export const CELL_SHAPES = ['square', 'rounded', 'hexagon'] as const;
export type CellShape = (typeof CELL_SHAPES)[number];

/** Cell pitch in the drawing's own units; cells are drawn a little smaller to leave a gap. */
const CELL = 10;
const GAP = 1.2;
/** Grid, cell: one number for the picked cell (the pointer state holds a single index). */
const PER_GRID = 10_000;

/**
 * What each layout covers and reads from when the card doesn't say: four weeks of history by
 * hour (enough for each weekday hour to average a few days, inside the recorder's default 10 days
 * of keeping… mostly), or twelve months of daily statistics (history rarely goes back a year).
 */
const DEFAULTS: Record<HeatmapGrid, { last: number; unit: string; source: string }> = {
  hours: { last: 4, unit: 'week', source: 'history' },
  calendar: { last: 12, unit: 'month', source: 'statistics' },
};

type Raw = CardConfig & { grid?: unknown; cell_shape?: unknown; color_min?: unknown; color_max?: unknown };

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function gridOf(raw: CardConfig): HeatmapGrid {
  return ((raw as Raw).grid as HeatmapGrid | undefined) ?? 'hours';
}

/** The card's options with the layout's grouping, and its default span and source filled in. */
export function heatmapRaw(raw: CardConfig): CardConfig {
  const grid = gridOf(raw);
  const d = DEFAULTS[grid];
  const period = (raw.period ?? {}) as Record<string, unknown>;
  return {
    ...raw,
    group_by: grid === 'hours' ? 'hour' : 'day',
    source: raw.source ?? d.source,
    period:
      period.calendar !== undefined ? period : { ...period, last: period.last ?? d.last, unit: period.unit ?? d.unit },
  };
}

function validate(raw: CardConfig): void {
  const r = raw as Raw;
  const one = (key: string, values: readonly string[]) => {
    const v = (r as Record<string, unknown>)[key];
    if (v !== undefined && !values.includes(v as string))
      throw new Error(`"${key}" must be one of: ${values.join(', ')}`);
  };
  one('grid', HEATMAP_GRIDS);
  one('color_by', HEATMAP_COLORS);
  one('cell_shape', CELL_SHAPES);
  for (const k of ['color_min', 'color_max'] as const) {
    if (r[k] !== undefined && !isNumber(r[k])) throw new Error(`"${k}" must be a number`);
  }
  if (isNumber(r.color_min) && isNumber(r.color_max) && r.color_min >= r.color_max) {
    throw new Error('"color_min" must be below "color_max"');
  }
  if (r.legend !== undefined && typeof r.legend !== 'boolean') throw new Error('"legend" must be true or false');
  validateHistoryOptions(heatmapRaw(raw));
  validateTooltipOptions(raw);
}

/* -------------------------------------------------------------- labels -------------------------------------------------------------- */

const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(hass: HomeAssistant | undefined, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  const language = hass?.locale?.language ?? hass?.language ?? 'en';
  const k = `${language}|${timeZone}|${JSON.stringify(opts)}`;
  let f = formats.get(k);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(language, { ...opts, timeZone });
    } catch {
      f = new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' });
    }
    formats.set(k, f);
  }
  return f;
}

/** A weekday's short name, 1 = Monday … 7 = Sunday (1 Jan 2024 was a Monday). */
function weekdayName(day: number, hass?: HomeAssistant): string {
  return dateFormat(hass, 'UTC', { weekday: 'short' }).format(Date.UTC(2024, 0, day));
}

/** An hour of the day on the user's clock: "14" or "2 PM". */
function hourName(hour: number, hass?: HomeAssistant, minutes = false): string {
  return dateFormat(hass, 'UTC', {
    hour: 'numeric',
    ...(minutes ? { minute: '2-digit' } : {}),
    hour12: hour12Of(hass),
  }).format(Date.UTC(2024, 0, 1, hour));
}

/* -------------------------------------------------------------- drawing -------------------------------------------------------------- */

interface Cell {
  col: number;
  row: number;
  v: number | null;
  /** Tooltip heading. */
  title: () => string;
  count?: number;
}

interface Geometry {
  width: number;
  height: number;
  centre(col: number, row: number): [number, number];
  /** The cell under a point given as fractions of the drawing. */
  at(fx: number, fy: number): [number, number];
}

function geometry(cols: number, rows: number, shape: CellShape): Geometry {
  if (shape === 'hexagon') {
    const r = CELL / Math.sqrt(3);
    const pitch = CELL * HEX_ROW;
    const width = cols * CELL + CELL / 2;
    const height = (rows - 1) * pitch + 2 * r;
    return {
      width,
      height,
      centre: (col, row) => [col * CELL + CELL / 2 + (row % 2) * (CELL / 2), r + row * pitch],
      at(fx, fy) {
        const row = Math.min(rows - 1, Math.max(0, Math.round((fy * height - r) / pitch)));
        const col = Math.floor((fx * width - (row % 2) * (CELL / 2)) / CELL);
        return [Math.min(cols - 1, Math.max(0, col)), row];
      },
    };
  }
  return {
    width: cols * CELL,
    height: rows * CELL,
    centre: (col, row) => [col * CELL + CELL / 2, row * CELL + CELL / 2],
    at: (fx, fy) => [Math.min(cols - 1, Math.floor(fx * cols)), Math.min(rows - 1, Math.floor(fy * rows))],
  };
}

function cellMark(
  g: Geometry,
  cell: Cell,
  shape: CellShape,
  fill: string | undefined,
  cls = 'cell',
): SVGTemplateResult {
  const [cx, cy] = g.centre(cell.col, cell.row);
  const style = fill ? `fill:${fill}` : '';
  const empty = fill ? '' : 'empty';
  if (shape === 'hexagon') {
    return svg`<path class="${cls} ${empty}" d=${hexPath(cx, cy, CELL - GAP)} style=${style}></path>`;
  }
  const s = CELL - GAP;
  return svg`<rect class="${cls} ${empty}" x=${cx - s / 2} y=${cy - s / 2} width=${s} height=${s}
    rx=${shape === 'rounded' ? 2 : 0.4} style=${style}></rect>`;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

interface Built {
  cells: Cell[];
  cols: number;
  rows: number;
  rowLabels: { row: number; text: string }[];
  colLabels: { col: number; text: string }[];
}

function hoursGrid(s: ChartSeries, frame: HistoryFrame, hass: HomeAssistant, wide: boolean): Built {
  const { zone } = frame;
  const weekday = (row: number) => ((zone.firstDay - 1 + row) % 7) + 1;
  const cells = weekCells(s.points, zone).map((c): Cell => ({
    col: c.hour,
    row: c.row,
    v: c.v,
    count: c.count,
    title: () =>
      `${weekdayName(weekday(c.row), hass)} ${hourName(c.hour, hass, true)} – ${hourName((c.hour + 1) % 24, hass, true)}`,
  }));
  const every = wide ? 3 : 6;
  return {
    cells,
    cols: 24,
    rows: 7,
    rowLabels: [0, 1, 2, 3, 4, 5, 6].map((row) => ({ row, text: weekdayName(weekday(row), hass) })),
    colLabels: Array.from({ length: 24 / every }, (_, i) => ({ col: i * every, text: hourName(i * every, hass) })),
  };
}

function calendarGrid(s: ChartSeries, frame: HistoryFrame, hass: HomeAssistant): Built {
  const { zone } = frame;
  const cal = calendarCells(s.points, zone);
  const day = dateFormat(hass, zone.timeZone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const month = dateFormat(hass, zone.timeZone, { month: 'short' });
  const weekday = (row: number) => ((zone.firstDay - 1 + row) % 7) + 1;
  return {
    cells: cal.cells.map((c) => ({ col: c.col, row: c.row, v: c.v, title: () => day.format(c.t) })),
    cols: Math.max(1, cal.weeks),
    rows: 7,
    rowLabels: [0, 1, 2, 3, 4, 5, 6].map((row) => ({ row, text: weekdayName(weekday(row), hass) })),
    colLabels: cal.months.map((m) => ({ col: m.col, text: month.format(m.t) })),
  };
}

function legend(s: ChartSeries, extent: [number, number] | undefined, byBands: boolean, ctx: ChartContext) {
  const e = s.entity;
  const fmt = (v: number) => formatNumber(v, e.decimals, ctx.hass);
  if (byBands) {
    return html`<div class="hm-legend bands">
      ${legendItems(e.bands, fmt, e.unit).map(
        (item) =>
          html`<span class="hm-key"
            ><span class="hm-swatch" style="background:${item.color}"></span>${item.text}</span
          >`,
      )}
    </div>`;
  }
  if (!extent) return nothing;
  return html`<div class="hm-legend scale">
    <span class="hm-end">${fmt(extent[0])}</span>
    <span class="hm-gradient" style="background:linear-gradient(to right, ${shade(s.color, 0)}, ${s.color})"></span>
    <span class="hm-end">${withUnit(fmt(extent[1]), e.unit)}</span>
  </div>`;
}

function drawGrid(s: ChartSeries, frame: HistoryFrame, ctx: ChartContext, multi: boolean): TemplateResult {
  const raw = ctx.raw as Raw;
  const grid = gridOf(ctx.raw);
  const shape = (raw.cell_shape as CellShape | undefined) ?? 'rounded';
  const byBands = raw.color_by === 'bands';
  const width = chartWidth(ctx);
  const built = grid === 'hours' ? hoursGrid(s, frame, ctx.hass, width >= 400) : calendarGrid(s, frame, ctx.hass);
  const g = geometry(built.cols, built.rows, shape);
  // Rough size of a cell on screen (the card less its padding and the weekday labels), so labels
  // that would collide on a narrow card are thinned out.
  const cellPx = (Math.max(0, width - 72) / g.width) * CELL;
  const rowStep = Math.ceil(13 / Math.max(1, cellPx * (shape === 'hexagon' ? HEX_ROW : 1)));
  const rowLabels = built.rowLabels.filter((l) => l.row % rowStep === 0);
  let last = -Infinity;
  const colLabels = built.colLabels.filter((l) => {
    if ((l.col - last) * cellPx < 32) return false;
    last = l.col;
    return true;
  });
  const extent = colorExtent(
    built.cells.map((c) => c.v),
    {
      min: isNumber(raw.color_min) ? raw.color_min : undefined,
      max: isNumber(raw.color_max) ? raw.color_max : undefined,
    },
  );
  const fillOf = (v: number | null) => {
    if (v === null) return undefined;
    if (byBands) return baseColor(bandFor(v, s.entity.bands).color);
    return extent ? shade(s.color, fraction(v, extent)) : s.color;
  };
  const picked = pickedIndex(ctx.host);
  const mine = picked !== undefined && Math.floor(picked / PER_GRID) === s.index ? picked % PER_GRID : undefined;
  const byPos = new Map(built.cells.map((c, i) => [c.col * 8 + c.row, i]));
  const tooltip = tooltipEnabled(ctx.raw);
  const hover = tooltip
    ? pickHandlers(ctx, (fx, fy) => {
        const [col, row] = g.at(fx, fy);
        const i = byPos.get(col * 8 + row);
        return i === undefined ? undefined : s.index * PER_GRID + i;
      })
    : undefined;
  const pickedCell = mine === undefined ? undefined : built.cells[mine];
  let overlay: TemplateResult | typeof nothing = nothing;
  if (pickedCell) {
    const [cx, cy] = g.centre(pickedCell.col, pickedCell.row);
    const value =
      pickedCell.v === null
        ? localize(ctx.hass, 'heatmap_empty')
        : withUnit(formatNumber(pickedCell.v, s.entity.decimals, ctx.hass), s.entity.unit);
    overlay = pickTooltip({
      x: cx / g.width,
      y: cy / g.height,
      plotWidth: Math.max(0, width - 80),
      title: pickedCell.title(),
      rows: [
        { color: fillOf(pickedCell.v) ?? 'var(--cd-track)', name: s.entity.name, value },
        ...(pickedCell.count !== undefined && pickedCell.v !== null
          ? [{ name: localize(ctx.hass, 'heatmap_hours'), value: String(pickedCell.count) }]
          : []),
      ],
    });
  }
  const { show } = ctx.config;
  const head =
    show.name || show.value || multi
      ? html`<div class="series-header">
          <div class="entity series-item" data-index=${s.index} tabindex="0" aria-label=${s.entity.label}>
            ${byBands ? nothing : html`<span class="swatch" style="background:${s.color}"></span>`}
            ${show.name || multi ? html`<span class="series-name">${s.entity.name}</span>` : nothing}
            ${show.value ? html`<span class="series-value">${s.entity.display}</span>` : nothing}
          </div>
        </div>`
      : nothing;
  const label = localize(ctx.hass, 'heatmap_aria', { name: s.entity.name });
  return html`<div class="hm grid-${grid} shape-${shape}">
    ${head}
    <div class="hm-body">
      <div class="hm-rows" aria-hidden="true">
        ${rowLabels.map(
          (l) => html`<span class="hm-label" style="top:${pct(g.centre(0, l.row)[1] / g.height)}">${l.text}</span>`,
        )}
      </div>
      <div
        class="hm-plot ${hover ? 'hoverable' : ''}"
        @pointerdown=${hover?.move}
        @pointermove=${hover?.move}
        @pointerleave=${hover?.leave}
        @pointercancel=${hover?.leave}
      >
        <svg class="hm-svg" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label=${label}>
          ${built.cells.map((c) => cellMark(g, c, shape, fillOf(c.v)))}
          ${pickedCell ? cellMark(g, pickedCell, shape, 'none', 'cell picked') : nothing}
        </svg>
        ${overlay}
      </div>
      <div class="hm-cols" aria-hidden="true">
        ${colLabels.map(
          (l) => html`<span class="hm-label" style="left:${pct((l.col * CELL) / g.width)}">${l.text}</span>`,
        )}
      </div>
    </div>
    ${raw.legend === false ? nothing : legend(s, extent, byBands, ctx)}
  </div>`;
}

/* -------------------------------------------------------------- editor -------------------------------------------------------------- */

const fieldCache = new Map<HeatmapGrid, FieldBinding[]>();

/** The history fields without grouping (the layout sets it), defaulting to the layout's span. */
function heatmapFields(grid: HeatmapGrid): FieldBinding[] {
  let fields = fieldCache.get(grid);
  if (!fields) {
    const d = DEFAULTS[grid];
    const own: Record<string, unknown> = { period_last: d.last, period_unit: d.unit, source: d.source };
    fields = [
      { name: 'grid', path: ['grid'], default: 'hours' },
      ...HISTORY_FIELDS.filter((f) => f.name !== 'group_by').map((f) =>
        f.name in own ? { ...f, default: own[f.name] } : f,
      ),
      { name: 'color_by', path: ['color_by'], default: 'scale' },
      { name: 'cell_shape', path: ['cell_shape'], default: 'rounded' },
      { name: 'color_min', path: ['color_min'] },
      { name: 'color_max', path: ['color_max'] },
      { name: 'legend', path: ['legend'], default: true },
      { name: 'tooltip', path: ['tooltip'], default: true },
    ];
    fieldCache.set(grid, fields);
  }
  return fields;
}

function heatmapEditor(ctx: ChartEditorContext): TemplateResult {
  const grid = gridOf(ctx.config);
  const variant = historyVariant({ ...ctx.config, group_by: undefined });
  const schema = cachedSchema(`heatmap|${variant}`, ctx.hass, () => [
    { name: 'grid', selector: choice(ctx.hass, 'grid', HEATMAP_GRIDS) },
    // The span and source; grouping is the layout's, so only how to combine readings stays.
    ...historySchema(ctx.hass, { ...ctx.config, group_by: undefined }).filter(
      (s) => !JSON.stringify(s).includes('"group_by"'),
    ),
    { name: 'aggregate', selector: choice(ctx.hass, 'aggregate', AGGREGATES) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', HEATMAP_COLORS) },
        { name: 'cell_shape', selector: choice(ctx.hass, 'cell_shape', CELL_SHAPES) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'color_min', selector: { number: { mode: 'box', step: 'any' } } },
        { name: 'color_max', selector: { number: { mode: 'box', step: 'any' } } },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'legend', selector: { boolean: {} } },
        { name: 'tooltip', selector: { boolean: {} } },
      ],
    },
  ]);
  return chartForm(ctx, 'chart', schema, heatmapFields(grid));
}

/* -------------------------------------------------------------- module -------------------------------------------------------------- */

export const heatmap: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 220,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .hm + .hm {
      margin-top: 12px;
    }
    .hm-body {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: auto auto;
      column-gap: 6px;
    }
    .hm-rows {
      position: relative;
      grid-column: 1;
      grid-row: 1;
      min-width: 2em;
    }
    .hm-plot {
      position: relative;
      grid-column: 2;
      grid-row: 1;
    }
    .hm-plot.hoverable {
      cursor: crosshair;
    }
    .hm-svg {
      display: block;
      width: 100%;
      height: auto;
      opacity: 0;
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .hm-svg {
      opacity: 1;
    }
    :host([static]) .hm-svg {
      transition: none;
    }
    .hm-svg .cell.empty {
      fill: var(--cd-track);
    }
    .hm-svg .cell.picked {
      fill: none;
      stroke: var(--primary-text-color);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .hm-cols {
      position: relative;
      grid-column: 2;
      grid-row: 2;
      height: 16px;
    }
    .hm-label {
      position: absolute;
      font-size: 11px;
      line-height: 1;
      color: var(--secondary-text-color);
      white-space: nowrap;
      pointer-events: none;
    }
    .hm-rows .hm-label {
      right: 0;
      transform: translateY(-50%);
    }
    .hm-cols .hm-label {
      top: 4px;
    }
    .grid-calendar .hm-label {
      font-size: 10px;
    }
    .hm-legend {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 10px;
      padding-top: 6px;
      font-size: 11px;
      color: var(--secondary-text-color);
      font-variant-numeric: tabular-nums;
    }
    .hm-legend.scale {
      justify-content: flex-end;
      gap: 6px;
    }
    .hm-gradient {
      width: min(160px, 40%);
      height: 8px;
      border-radius: 4px;
    }
    .hm-key {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .hm-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
  `,
  thumbnail: () => svg`
    ${[0, 1, 2, 3].map((r) =>
      [0, 1, 2, 3, 4, 5, 6].map((c) => {
        const f = ((c * 3 + r * 5) % 7) / 6;
        return svg`<rect x=${4 + c * 8} y=${4 + r * 8.5} width="7" height="7.5" rx="1.5"
          fill="var(--primary-color, #03a9f4)" fill-opacity=${0.15 + 0.85 * f}></rect>`;
      }),
    )}`,
  validate,
  editor: heatmapEditor,
  entityFields: () => ({
    schema: [{ name: 'series_color', selector: { text: {} } }],
    fields: [{ name: 'series_color', path: ['color'] }],
  }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopPick(host);
  },
  render(ctx) {
    const frame = historyFrame({ ...ctx, raw: heatmapRaw(ctx.raw) });
    const nav = periodNav(frame, ctx);
    const message = frameMessage(frame, ctx);
    if (message) return html`<div class="frame">${nav}${message}</div>`;
    const multi = frame.series.length > 1;
    return html`<div class="frame">${nav}${frame.series.map((s) => drawGrid(s, frame, ctx, multi))}</div>`;
  },
};
