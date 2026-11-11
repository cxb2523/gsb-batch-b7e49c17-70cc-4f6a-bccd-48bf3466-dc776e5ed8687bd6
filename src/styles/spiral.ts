import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
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
import { colorExtent, fraction, shade } from '../chart/heatmap-grid';
import {
  SPIRAL_TURNS,
  ringRadius,
  spiralGeometry,
  spiralPoint,
  spokes,
  stretchAt,
  stretchPath,
  turnAngle,
  turnUnder,
  turnsAt,
} from '../chart/spiral';
import type { SpiralGeometry, SpiralTurn, Stretch } from '../chart/spiral';
import { tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import { pickHandlers, pickTooltip, pickedIndex, stopPick } from '../chart/xy';
import { HISTORY_FIELDS, cachedSchema, chartForm, choice } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { AGGREGATES } from '../history/group';
import { SOURCES } from '../chart/frame';
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

/** Turns a spiral draws when `turns` isn't set: a week of days, or four weeks. */
export const DEFAULT_TURNS: Record<SpiralTurn, number> = { day: 7, week: 4 };
/** The most turns: a month of days, or a quarter of weeks. Thinner rings stop being readable. */
export const MAX_TURNS: Record<SpiralTurn, number> = { day: 31, week: 13 };
/** How much of the space between turns each ring fills, in percent. */
export const DEFAULT_RING = 80;
export const MIN_RING = 20;
export const MAX_RING = 100;
export const SPIRAL_COLORS = ['scale', 'bands'] as const;

/** The drawing's coordinate box, square. */
const VIEW = 200;
/** Room round the spiral for the hour labels, in the drawing's units. */
const MARGIN = 16;
/** Grid, stretch: one number for the picked stretch (the pointer state holds a single index). */
const PER_SPIRAL = 100_000;
/** Largest a spiral is drawn, px; the legend sits beside it on a card wide enough. */
const MAX_PX = 300;
const SIDE_PX = 150;

type Raw = CardConfig & {
  turn?: unknown;
  turns?: unknown;
  ring_width?: unknown;
  color_min?: unknown;
  color_max?: unknown;
};

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface SpiralOptions {
  turn: SpiralTurn;
  turns: number;
  /** 0–1 of the space between turns. */
  ring: number;
}

export function spiralOptions(raw: CardConfig): SpiralOptions {
  const r = raw as Raw;
  const turn = (r.turn as SpiralTurn | undefined) ?? 'day';
  return {
    turn,
    turns: isNumber(r.turns) ? r.turns : DEFAULT_TURNS[turn],
    ring: (isNumber(r.ring_width) ? r.ring_width : DEFAULT_RING) / 100,
  };
}

/**
 * The card's options as the history frame reads them: the span is `turns` days (or weeks) back
 * from now, read an hour at a time. The period's offset and buttons stay the card's; its length
 * and any calendar span are the spiral's.
 */
export function spiralRaw(raw: CardConfig): CardConfig {
  const o = spiralOptions(raw);
  const period = (raw.period ?? {}) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const k of ['offset', 'navigate']) if (period[k] !== undefined) kept[k] = period[k];
  return { ...raw, group_by: 'hour', period: { ...kept, last: o.turns, unit: o.turn } };
}

function validate(raw: CardConfig): void {
  const r = raw as Raw;
  if (r.turn !== undefined && !SPIRAL_TURNS.includes(r.turn as SpiralTurn)) {
    throw new Error(`"turn" must be one of: ${SPIRAL_TURNS.join(', ')}`);
  }
  const turn = (r.turn as SpiralTurn | undefined) ?? 'day';
  const max = MAX_TURNS[turn];
  if (r.turns !== undefined && !(Number.isInteger(r.turns) && (r.turns as number) >= 1 && (r.turns as number) <= max)) {
    throw new Error(`"turns" must be a whole number from 1 to ${max}`);
  }
  if (r.ring_width !== undefined && !(isNumber(r.ring_width) && r.ring_width >= MIN_RING && r.ring_width <= MAX_RING)) {
    throw new Error(`"ring_width" must be a number from ${MIN_RING} to ${MAX_RING}`);
  }
  if (r.color_by !== undefined && !SPIRAL_COLORS.includes(r.color_by as (typeof SPIRAL_COLORS)[number])) {
    throw new Error(`"color_by" must be one of: ${SPIRAL_COLORS.join(', ')}`);
  }
  for (const k of ['color_min', 'color_max'] as const) {
    if (r[k] !== undefined && !isNumber(r[k])) throw new Error(`"${k}" must be a number`);
  }
  if (isNumber(r.color_min) && isNumber(r.color_max) && r.color_min >= r.color_max) {
    throw new Error('"color_min" must be below "color_max"');
  }
  if (r.legend !== undefined && typeof r.legend !== 'boolean') throw new Error('"legend" must be true or false');
  validateHistoryOptions(spiralRaw(raw));
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

/** The labels round the outside: hours of the day, or the weekdays from the zone's first. */
function spokeLabels(turn: SpiralTurn, frame: HistoryFrame, hass: HomeAssistant | undefined, wide: boolean) {
  if (turn === 'week') {
    const day = dateFormat(hass, 'UTC', { weekday: 'short' });
    // 1 Jan 2024 was a Monday: weekday n (1 = Monday) is 2024-01-n.
    return spokes('week').map((f, i) => ({
      f,
      text: day.format(Date.UTC(2024, 0, ((frame.zone.firstDay - 1 + i) % 7) + 1)),
    }));
  }
  const hour = dateFormat(hass, 'UTC', { hour: 'numeric', hour12: hour12Of(hass) });
  return spokes('day', wide ? 3 : 6).map((f) => ({ f, text: hour.format(Date.UTC(2024, 0, 1, Math.round(f * 24))) }));
}

/* -------------------------------------------------------------- drawing -------------------------------------------------------------- */

/** One group of readings placed on the spiral. */
interface Piece extends Stretch {
  t: number;
  end: number;
  v: number;
}

/** The spiral's groups, as stretches of turns from the start of the span; gaps are left out. */
export function piecesOf(
  points: { t: number; v: number | null; end?: number }[],
  start: number,
  until: number,
  turn: SpiralTurn,
  zone: HistoryFrame['zone'],
): Piece[] {
  const origin = turnsAt(start, turn, zone);
  const out: Piece[] = [];
  for (const p of points) {
    if (p.v === null || p.t >= until) continue;
    const end = Math.min(p.end ?? p.t + 3_600_000, until);
    const u0 = turnsAt(p.t, turn, zone) - origin;
    const u1 = turnsAt(end, turn, zone) - origin;
    // The hour the clocks go back happens twice on the wall clock: both draw over the same stretch.
    if (u1 > u0) out.push({ t: p.t, end, v: p.v, u0, u1 });
  }
  return out.sort((a, b) => a.u0 - b.u0);
}

function legend(s: ChartSeries, extent: [number, number] | undefined, byBands: boolean, ctx: ChartContext) {
  const e = s.entity;
  const fmt = (v: number) => formatNumber(v, e.decimals, ctx.hass);
  if (byBands) {
    return html`<div class="sp-legend bands">
      ${legendItems(e.bands, fmt, e.unit).map(
        (item) =>
          html`<span class="sp-key"
            ><span class="sp-swatch" style="background:${item.color}"></span>${item.text}</span
          >`,
      )}
    </div>`;
  }
  if (!extent) return nothing;
  return html`<div class="sp-legend scale">
    <span class="sp-end">${fmt(extent[0])}</span>
    <span class="sp-gradient" style="background:linear-gradient(to right, ${shade(s.color, 0)}, ${s.color})"></span>
    <span class="sp-end">${withUnit(fmt(extent[1]), e.unit)}</span>
  </div>`;
}

/** The spiral's size on screen, and whether its legend fits beside it. */
export function spiralLayout(width: number): { px: number; side: boolean } {
  const inner = Math.max(120, width - 32);
  const side = inner >= MAX_PX * 0.8 + SIDE_PX + 16;
  return { px: Math.round(Math.min(MAX_PX, side ? inner - SIDE_PX - 16 : inner)), side };
}

function drawSpiral(s: ChartSeries, frame: HistoryFrame, ctx: ChartContext, now: number): TemplateResult {
  const raw = ctx.raw as Raw;
  const o = spiralOptions(ctx.raw);
  const byBands = raw.color_by === 'bands';
  const { range, zone } = frame;
  const until = Math.min(range.end, now);
  const pieces = piecesOf(s.points, range.start, until, o.turn, zone);
  const turns = turnsAt(range.end, o.turn, zone) - turnsAt(range.start, o.turn, zone);
  const g: SpiralGeometry = spiralGeometry(VIEW, turns, turnsAt(range.start, o.turn, zone), o.ring, VIEW / 2 - MARGIN);
  const width = chartWidth(ctx);
  const layout = spiralLayout(width);
  const unitPx = VIEW / layout.px;
  const extent = colorExtent(
    pieces.map((p) => p.v),
    {
      min: isNumber(raw.color_min) ? raw.color_min : undefined,
      max: isNumber(raw.color_max) ? raw.color_max : undefined,
    },
  );
  const fillOf = (v: number) => {
    if (byBands) return baseColor(bandFor(v, s.entity.bands).color);
    return extent ? shade(s.color, fraction(v, extent)) : s.color;
  };
  const picked = pickedIndex(ctx.host);
  const mine = picked !== undefined && Math.floor(picked / PER_SPIRAL) === s.index ? picked % PER_SPIRAL : undefined;
  const pickedPiece = mine === undefined ? undefined : pieces[mine];
  const tooltip = tooltipEnabled(ctx.raw);
  const hover = tooltip
    ? pickHandlers(ctx, (fx, fy, w) => {
        const u = turnUnder(g, fx * VIEW, fy * VIEW, (6 * VIEW) / Math.max(1, w));
        const i = u === undefined ? undefined : stretchAt(pieces, u);
        return i === undefined ? undefined : s.index * PER_SPIRAL + i;
      })
    : undefined;
  let overlay: TemplateResult | typeof nothing = nothing;
  if (pickedPiece) {
    const mid = (pickedPiece.u0 + pickedPiece.u1) / 2;
    const [x, y] = spiralPoint(g, ringRadius(g, mid), turnAngle(g, mid));
    const day = dateFormat(ctx.hass, zone.timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
    const time = dateFormat(ctx.hass, zone.timeZone, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: hour12Of(ctx.hass),
    });
    overlay = pickTooltip({
      x: x / VIEW,
      y: y / VIEW,
      plotWidth: layout.px,
      title: `${day.format(pickedPiece.t)} ${time.format(pickedPiece.t)} – ${time.format(pickedPiece.end)}`,
      rows: [
        {
          color: fillOf(pickedPiece.v),
          name: s.entity.name,
          value: withUnit(formatNumber(pickedPiece.v, s.entity.decimals, ctx.hass), s.entity.unit),
        },
      ],
    });
  }
  const labels = spokeLabels(o.turn, frame, ctx.hass, layout.px >= 220);
  const labelR = VIEW / 2 - MARGIN / 2;
  const font = 11 * unitPx;
  // Faint guide behind the whole span, so hours with no readings still show where they would be.
  const track = stretchPath(g, 0, g.turns);
  const nowMark =
    frame.live && pieces.length
      ? (() => {
          const [x, y] = spiralPoint(g, ringRadius(g, g.turns), turnAngle(g, g.turns));
          return svg`<circle class="sp-now" cx=${x} cy=${y} r=${Math.min(g.width / 2, 4 * unitPx)}></circle>`;
        })()
      : nothing;
  const turnCount = Math.round(turns);
  const label = localize(ctx.hass, 'spiral_aria', { name: s.entity.name, n: turnCount });
  const { show } = ctx.config;
  const multi = frame.series.length > 1;
  const describe = localize(ctx.hass, o.turn === 'week' ? 'spiral_turn_week_note' : 'spiral_turn_day_note', {
    n: turnCount,
  });
  return html`<div class="sp ${layout.side ? 'side' : 'stacked'}">
    <div
      class="sp-plot ${hover ? 'hoverable' : ''}"
      style="width:${layout.px}px;height:${layout.px}px"
      @pointerdown=${hover?.move}
      @pointermove=${hover?.move}
      @pointerleave=${hover?.leave}
      @pointercancel=${hover?.leave}
    >
      <svg class="sp-svg" viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label=${label}>
        <path class="sp-track" d=${track}></path>
        <g class="entity sp-pieces" data-index=${s.index}>
          ${pieces.map((p) => svg`<path class="sp-piece" d=${stretchPath(g, p.u0, p.u1)} style="fill:${fillOf(p.v)};stroke:${fillOf(p.v)}"></path>`)}
        </g>
        ${pickedPiece ? svg`<path class="sp-picked" d=${stretchPath(g, pickedPiece.u0, pickedPiece.u1)}></path>` : nothing}
        ${nowMark}
        <g class="sp-labels" aria-hidden="true" style="font-size:${font}px">
          ${labels.map(({ f, text }) => {
            const [x, y] = spiralPoint(g, labelR, f * Math.PI * 2);
            return svg`<text x=${x} y=${y}>${text}</text>`;
          })}
        </g>
      </svg>
      ${overlay}
    </div>
    <div class="sp-side">
      ${
        show.name || show.value || multi
          ? html`<div class="entity series-item" data-index=${s.index} tabindex="0" aria-label=${s.entity.label}>
              ${byBands ? nothing : html`<span class="swatch" style="background:${s.color}"></span>`}
              ${show.name || multi ? html`<span class="series-name">${s.entity.name}</span>` : nothing}
              ${show.value ? html`<span class="series-value">${s.entity.display}</span>` : nothing}
            </div>`
          : nothing
      }
      <div class="sp-note">${describe}</div>
      <div class="sp-note">${localize(ctx.hass, 'spiral_inner_oldest')}</div>
      ${raw.legend === false ? nothing : legend(s, extent, byBands, ctx)}
    </div>
  </div>`;
}

/* -------------------------------------------------------------- editor -------------------------------------------------------------- */

const SPIRAL_FIELDS: FieldBinding[] = [
  { name: 'spiral_turn', path: ['turn'], default: 'day' },
  { name: 'spiral_turns', path: ['turns'] },
  ...HISTORY_FIELDS.filter((f) => ['period_offset', 'period_navigate', 'source', 'aggregate'].includes(f.name)),
  { name: 'color_by', path: ['color_by'], default: 'scale' },
  { name: 'spiral_ring_width', path: ['ring_width'], default: DEFAULT_RING },
  { name: 'color_min', path: ['color_min'] },
  { name: 'color_max', path: ['color_max'] },
  { name: 'legend', path: ['legend'], default: true },
  { name: 'tooltip', path: ['tooltip'], default: true },
];

function spiralEditor(ctx: ChartEditorContext): TemplateResult {
  const o = spiralOptions(ctx.config);
  const schema = cachedSchema(`spiral|${o.turn}`, ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'spiral_turn', selector: choice(ctx.hass, 'spiral_turn', SPIRAL_TURNS) },
        {
          name: 'spiral_turns',
          selector: { number: { min: 1, max: MAX_TURNS[o.turn], mode: 'box', placeholder: DEFAULT_TURNS[o.turn] } },
        },
        { name: 'period_offset', selector: { number: { min: 0, mode: 'box' } } },
      ],
    },
    { name: 'period_navigate', selector: { boolean: {} } },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'source', selector: choice(ctx.hass, 'source', SOURCES) },
        { name: 'aggregate', selector: choice(ctx.hass, 'aggregate', AGGREGATES) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', SPIRAL_COLORS) },
        {
          name: 'spiral_ring_width',
          selector: { number: { min: MIN_RING, max: MAX_RING, step: 5, mode: 'slider', unit_of_measurement: '%' } },
        },
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
  return chartForm(ctx, 'chart', schema, SPIRAL_FIELDS);
}

/* -------------------------------------------------------------- module -------------------------------------------------------------- */

export const spiral: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 340,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .sp {
      display: flex;
      align-items: center;
      gap: 8px 16px;
    }
    .sp.stacked {
      flex-direction: column;
      align-items: stretch;
    }
    .sp + .sp {
      margin-top: 12px;
    }
    .sp-plot {
      position: relative;
      flex: none;
      max-width: 100%;
    }
    .sp.stacked .sp-plot {
      align-self: center;
    }
    .sp-plot.hoverable {
      cursor: crosshair;
    }
    .sp-svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
      opacity: 0;
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .sp-svg {
      opacity: 1;
    }
    :host([static]) .sp-svg {
      transition: none;
    }
    .sp-track {
      fill: var(--cd-track);
    }
    .sp-piece {
      /* Drawn in its own colour, so neighbouring hours meet without a hairline seam. */
      stroke-width: 0.3px;
    }
    .sp-picked {
      fill: none;
      stroke: var(--primary-text-color);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .sp-now {
      fill: var(--primary-text-color);
      stroke: var(--card-background-color, #fff);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .sp-labels text {
      fill: var(--secondary-text-color);
      text-anchor: middle;
      dominant-baseline: central;
      pointer-events: none;
    }
    .sp-side {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      flex: 1 1 0;
    }
    .sp-side .series-item {
      padding-bottom: 2px;
    }
    .sp-note {
      font-size: 0.8125em;
      color: var(--secondary-text-color);
    }
    .sp-legend {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 10px;
      padding-top: 6px;
      font-size: 11px;
      color: var(--secondary-text-color);
      font-variant-numeric: tabular-nums;
    }
    .sp-legend.scale {
      gap: 6px;
      flex-wrap: nowrap;
    }
    .sp-gradient {
      flex: 1 1 auto;
      min-width: 40px;
      max-width: 160px;
      height: 8px;
      border-radius: 4px;
    }
    .sp-key {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .sp-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
  `,
  thumbnail: () => {
    const g = spiralGeometry(40, 3, 0, 0.7, 19);
    return svg`<g transform="translate(12 0)">
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(
        (k) => svg`<path d=${stretchPath(g, k / 4, (k + 1) / 4)} fill="var(--primary-color, #03a9f4)"
          fill-opacity=${0.2 + 0.8 * (((k * 5) % 12) / 11)}></path>`,
      )}
    </g>`;
  },
  validate,
  editor: spiralEditor,
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
    const now = Date.now();
    const frame = historyFrame({ ...ctx, raw: spiralRaw(ctx.raw) }, now);
    const nav = periodNav(frame, ctx);
    const message = frameMessage(frame, ctx);
    if (message) return html`<div class="frame">${nav}${message}</div>`;
    return html`<div class="frame">${nav}${frame.series.map((s) => drawSpiral(s, frame, ctx, now))}</div>`;
  },
};
