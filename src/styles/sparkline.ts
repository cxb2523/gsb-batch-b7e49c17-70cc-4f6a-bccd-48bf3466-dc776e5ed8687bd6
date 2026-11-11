import { boundaries, zoneFor } from '../history/timezone';
import { groupHistory } from '../history/group';
import type { Aggregate } from '../history/group';
import type { Point, Range } from '../history/types';
import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor, colorStops } from '../bands';
import { downsample } from '../chart/downsample';
import { disconnectHistory, frameStyles, historyFrame, periodNav, validateHistoryOptions } from '../chart/frame';
import type { ChartSeries } from '../chart/frame';
import { CURVES, runPath, runs } from '../chart/paths';
import type { XY } from '../chart/paths';
import { linear, padDomain } from '../chart/scale';
import { MAX_LINE_WIDTH, MIN_LINE_WIDTH } from '../chart/series-style';
import {
  HISTORY_FIELDS,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  historyVariant,
} from '../editor/chart-editors';
import { LINE_WIDTH_SELECTOR } from '../editor/schemas';
import type { FieldBinding } from '../editor/schemas';
import { localize } from '../localize';
import { iconOverride } from '../resolve';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

/** Kinds of sparkline. */
export const SPARK_KINDS = ['line', 'area', 'column'] as const;
export type SparkKind = (typeof SPARK_KINDS)[number];

/** A sparkline's drawing box; it stretches to its cell, strokes don't. */
const W = 100;
const H = 24;
/** Points kept per sparkline: it is only a hundred or so pixels wide. */
const MAX_POINTS = 120;
/** A sparkline is thin: its default line is lighter than a line chart's. */
const SPARK_LINE_WIDTH = 1.5;

/**
 * Which kind a row draws: its own `spark`, else the card's, else a line. Columns of raw readings
 * would be hairlines, so an ungrouped column sparkline is grouped by hour (two days or less) or
 * by day: see `sparkRaw`.
 */
export function sparkKind(e: ResolvedEntity, raw: CardConfig): SparkKind {
  const own = (e.config as { spark?: SparkKind }).spark;
  return own ?? (raw.spark as SparkKind | undefined) ?? 'line';
}

/** The grouping an ungrouped column sparkline gets: by hour up to two days, else by day. */
export function columnUnit(raw: CardConfig): 'hour' | 'day' {
  const period = (raw.period ?? {}) as { last?: number; unit?: string; calendar?: string };
  const hours = (period.last ?? 24) * ({ hour: 1, day: 24, week: 168, month: 720 }[period.unit ?? 'hour'] ?? 1);
  const short = period.calendar ? period.calendar === 'day' : hours <= 48;
  return short ? 'hour' : 'day';
}

/**
 * When every row is a column sparkline and nothing is grouped, group the whole card (statistics
 * can then be asked for in the right period). Mixed cards stay ungrouped, so line and area rows
 * keep every reading; their column rows are grouped on their own (see `columnPoints`).
 */
export function sparkRaw(raw: CardConfig, kinds: SparkKind[]): CardConfig {
  if (raw.group_by !== undefined || kinds.length === 0 || !kinds.every((k) => k === 'column')) return raw;
  return { ...raw, group_by: columnUnit(raw), aggregate: raw.aggregate ?? 'mean' };
}

/** A column row's points in a card left ungrouped: averaged per hour or day in HA's time zone. */
export function columnPoints(points: Point[], raw: CardConfig, range: Range, hass: HomeAssistant | undefined): Point[] {
  const bounds = boundaries(columnUnit(raw), range.start, range.end, zoneFor(hass));
  return groupHistory(points, bounds, (raw.aggregate as Aggregate | undefined) ?? 'mean', Date.now());
}

/** The value range a sparkline is drawn over: its own readings, padded; zero kept in for columns. */
export function sparkDomain(values: number[], zero: boolean): [number, number] | undefined {
  if (values.length === 0) return undefined;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    return lo === hi ? [lo, lo + 1] : [lo, hi];
  }
  [lo, hi] = padDomain([lo, hi], 0.1);
  return [lo, hi];
}

/** One sparkline: a line, a filled area or columns, in the row's colour. */
export function sparkline(s: ChartSeries, kind: SparkKind, range: { start: number; end: number }, width: number) {
  const points = downsample(s.points, MAX_POINTS);
  const values = points.filter((p) => p.v !== null).map((p) => p.v as number);
  const domain = sparkDomain(values, kind === 'column');
  if (!domain) return svg``;
  const x = linear([range.start, range.end], [0, W]);
  // A pixel of room at top and bottom, so a line along the edge isn't cut in half.
  const y = linear(domain, [H - 1, 1]);
  const base = y(Math.min(Math.max(0, domain[0]), domain[1]));
  if (kind === 'column') {
    const bars: SVGTemplateResult[] = [];
    points.forEach((p, i) => {
      if (p.v === null) return;
      const end = p.end ?? points[i + 1]?.t ?? range.end;
      const x0 = x(p.t);
      const w = Math.max(0, Math.min(W, x(end)) - x0);
      if (w <= 0) return;
      const top = Math.min(y(p.v), base);
      bars.push(svg`<rect x=${x0 + w * 0.12} width=${w * 0.76} y=${top} height=${Math.abs(y(p.v) - base)}></rect>`);
    });
    return svg`<g class="spark-columns" fill=${s.color}>${bars}</g>`;
  }
  const pieces = runs(points).map((r) => r.map((p) => [x(p.t), y(p.v as number)] as XY));
  const line = pieces.map((pts) => runPath(pts, s.curve)).join('');
  const fill =
    kind === 'area'
      ? pieces
          .filter((pts) => pts.length > 1)
          .map(
            (pts) =>
              `${runPath(pts, s.curve === 'step' ? 'straight' : s.curve)}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z`,
          )
          .join('')
      : '';
  return svg`${fill ? svg`<path class="spark-fill" d=${fill} fill=${s.color} stroke="none"></path>` : nothing}
    <path class="spark-line" d=${line} fill="none" stroke=${s.color} style="stroke-width:${width}px"></path>`;
}

/** The 1.0 thin bar: the current value between min and max, in its band's colour, with the target. */
function bar(e: ResolvedEntity, showTarget: boolean) {
  const stops = colorStops(e.band.color);
  return html`<div
    class="spark-track"
    style="--start:${e.span[0]};--end:${e.span[1]};--c-start:${stops.start};--c-end:${stops.end};--target:${
      e.targetPosition ?? 0
    }"
  >
    <div class="spark-bar"></div>
    ${showTarget && e.targetPosition !== null && e.available ? html`<div class="spark-target"></div>` : nothing}
  </div>`;
}

function render(ctx0: ChartContext): TemplateResult {
  const kinds = ctx0.items.map((e) => sparkKind(e, ctx0.raw));
  const ctx = { ...ctx0, raw: sparkRaw(ctx0.raw, kinds) };
  const frame = historyFrame(ctx);
  const { show } = ctx.config;
  const withBar = ctx.raw.bar === true;
  const width = (ctx.raw.line_width as number | undefined) ?? SPARK_LINE_WIDTH;
  const message =
    frame.status === 'error'
      ? html`<div class="spark-message error">${localize(ctx.hass, 'chart_error', { error: frame.error ?? '' })}</div>`
      : nothing;
  const rows = frame.series.map((s, i) => {
    const e = s.entity;
    // A row is coloured like the 1.0 bars (its value's band) unless the entity sets a colour.
    const own = (e.config as { color?: string }).color;
    const color = own ? baseColor(own) : baseColor(e.band.color);
    const grouped = sparkKind(e, ctx0.raw) === 'column' && ctx.raw.group_by === undefined;
    const series = { ...s, color, points: grouped ? columnPoints(s.points, ctx.raw, frame.range, ctx.hass) : s.points };
    const lineWidth = (e.config as { line_width?: number }).line_width ?? width;
    const name = show.name ? html`<span class="name">${e.name}</span>` : nothing;
    const value = show.value || !e.available ? html`<span class="value">${e.display}</span>` : nothing;
    return html`<div
      class="entity spark-row ${withBar ? 'with-bar' : ''} ${e.available ? '' : 'unavailable'}"
      data-index=${i}
      tabindex="0"
      aria-label=${e.label}
    >
      ${
        show.icon
          ? html`<ha-state-icon
              class="icon"
              .hass=${ctx.hass}
              .stateObj=${e.stateObj}
              .icon=${iconOverride(e)}
            ></ha-state-icon>`
          : nothing
      }
      ${
        withBar
          ? html`<div class="spark-body">
              <div class="top">${name}${value}</div>
              ${bar(e, show.target)}
            </div>`
          : name
      }
      <svg
        class="spark ${frame.status === 'loading' ? 'loading' : ''}"
        viewBox="0 0 ${W} ${H}"
        preserveAspectRatio="none"
        role="img"
        aria-label=${localize(ctx.hass, 'spark_aria', { name: e.name })}
      >
        ${frame.status === 'ready' ? sparkline(series, kinds[i], frame.range, lineWidth) : nothing}
      </svg>
      ${withBar ? nothing : value}
    </div>`;
  });
  return html`${periodNav(frame, ctx)}${message}
    <div class="spark-rows ${show.icon ? 'icons' : ''} ${withBar ? 'bars' : ''}">${rows}</div>`;
}

const SPARK_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'spark', path: ['spark'], default: 'line' },
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'line_width', path: ['line_width'], default: SPARK_LINE_WIDTH },
  { name: 'spark_bar', path: ['bar'], default: false },
];

export function sparklineEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`sparkline|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ctx.config),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'spark', selector: choice(ctx.hass, 'spark', SPARK_KINDS) },
        { name: 'curve', selector: choice(ctx.hass, 'curve', CURVES) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
        { name: 'spark_bar', selector: { boolean: {} } },
      ],
    },
  ]);
  return chartForm(ctx, 'chart', schema, SPARK_FIELDS);
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'spark', path: ['spark'] },
  { name: 'spark_color', path: ['color'] },
];

function validate(raw: CardConfig): void {
  validateHistoryOptions(raw);
  const kinds = [
    raw.spark,
    ...(raw.entities ?? []).map((e) => (typeof e === 'object' ? (e as { spark?: unknown }).spark : undefined)),
  ];
  for (const k of kinds) {
    if (k !== undefined && !SPARK_KINDS.includes(k as SparkKind)) {
      throw new Error(`"spark" must be one of: ${SPARK_KINDS.join(', ')}`);
    }
  }
  if (raw.bar !== undefined && typeof raw.bar !== 'boolean') throw new Error('"bar" must be true or false');
  const w = raw.line_width;
  if (w !== undefined && (typeof w !== 'number' || w < MIN_LINE_WIDTH || w > MAX_LINE_WIDTH)) {
    throw new Error(`"line_width" must be a number from ${MIN_LINE_WIDTH} to ${MAX_LINE_WIDTH}`);
  }
}

export const sparklineStyle: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 120,
  styles: css`
    ${frameStyles}
    /* One grid for every row, so the sparklines line up whatever each value's width. */
    .spark-rows {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(64px, 38%) auto;
      column-gap: 12px;
    }
    .spark-rows.icons {
      grid-template-columns: auto minmax(0, 1fr) minmax(64px, 38%) auto;
    }
    .spark-rows.bars {
      grid-template-columns: minmax(0, 1fr) minmax(64px, 38%);
    }
    .spark-rows.icons.bars {
      grid-template-columns: auto minmax(0, 1fr) minmax(64px, 38%);
    }
    .spark-row {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: subgrid;
      align-items: center;
      padding: 6px 0;
      min-height: 28px;
      border-radius: 6px;
      cursor: pointer;
    }
    .spark-row:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .spark-row .icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      --mdc-icon-size: 22px;
    }
    .spark-row .name {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .spark-row .value {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      text-align: right;
      min-width: calc(var(--cd-value-ch, 4) * 1ch);
      font-variant-numeric: tabular-nums;
    }
    .spark-row.unavailable .value {
      color: var(--secondary-text-color);
      font-weight: 400;
      font-size: 13px;
      max-width: 7em;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Narrow cards: the names keep their room, the sparklines give some up. */
    @container (max-width: 360px) {
      .spark-rows {
        grid-template-columns: minmax(0, 1fr) minmax(48px, 30%) auto;
      }
      .spark-rows.icons {
        grid-template-columns: auto minmax(0, 1fr) minmax(48px, 30%) auto;
      }
      .spark-rows.bars {
        grid-template-columns: minmax(0, 1fr) minmax(48px, 30%);
      }
      .spark-rows.icons.bars {
        grid-template-columns: auto minmax(0, 1fr) minmax(48px, 30%);
      }
    }
    .spark {
      width: 100%;
      height: 28px;
      overflow: visible;
    }
    .spark path {
      vector-effect: non-scaling-stroke;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .spark .spark-fill {
      fill-opacity: 0.22;
    }
    .spark-body {
      min-width: 0;
    }
    .spark-body .top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .spark-body .value {
      font-weight: 400;
      font-size: 13px;
      color: var(--secondary-text-color);
      min-width: 0;
    }
    .spark-track {
      position: relative;
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
      background: var(--cd-track);
    }
    .spark-bar {
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(var(--start) * 100%);
      width: calc((var(--end) - var(--start)) * 100%);
      border-radius: 4px;
      background: var(--c-start);
      background-image: linear-gradient(90deg, var(--c-start), var(--c-end));
    }
    .spark-target {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      left: calc(var(--target) * (100% - 2px));
      background: var(--primary-text-color);
    }
    .spark-message {
      color: var(--secondary-text-color);
      font-size: 0.875em;
      padding: 4px 0;
    }
    .spark-message.error {
      color: var(--error-color, #db4437);
    }
  `,
  thumbnail: () => svg`
    <path d="M4 12 L12 9 L20 13 L28 6 L36 10" fill="none" stroke="var(--primary-color, #03a9f4)"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <rect x="42" y="7" width="18" height="4" rx="2" fill="var(--secondary-text-color, #888)" opacity="0.5" />
    <path d="M4 27 L12 25 L20 29 L28 23 L36 26 V32 H4 Z" fill="var(--warning-color, #f59e0b)" opacity="0.3" />
    <path d="M4 27 L12 25 L20 29 L28 23 L36 26" fill="none" stroke="var(--warning-color, #f59e0b)"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <rect x="42" y="25" width="14" height="4" rx="2" fill="var(--secondary-text-color, #888)" opacity="0.5" />`,
  validate,
  editor: sparklineEditor,
  entityFields: (hass) => ({
    schema: cachedSchema('sparkline-entity', hass, () => [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'spark', selector: choice(hass, 'spark', SPARK_KINDS) },
          { name: 'spark_color', selector: { text: {} } },
        ],
      },
    ]),
    fields: ENTITY_FIELDS,
  }),
  disconnect(host) {
    disconnectHistory(host);
  },
  render,
};
