import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { FieldBinding } from '../editor/schemas';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';
import { axisOptions, valueAxis } from './axes';
import { VIEW_H, VIEW_W } from './frame';
import { chartWidth } from './grid';
import type { PlotAxes } from './grid';
import { linear } from './scale';
import { TOUCH_LINGER_MS, tooltipSide } from './tooltip';
import type { Hover } from './tooltip';

/**
 * Shared pieces for charts whose bottom axis is a value, not time (histogram, scatter, bubble,
 * box plot): the value axes, an x range from YAML, and a tooltip that picks one mark under the
 * pointer rather than a moment in time.
 */

/** Room each bottom label needs, in px, when choosing how many fit. */
const X_LABEL_PX = 70;
/** Gaps between value labels on a full-height plot: about one per 40 px. */
const Y_GAPS = 4;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Throw a readable error for a bad `x_min` / `x_max`. */
export function validateXRange(raw: CardConfig): void {
  for (const k of ['x_min', 'x_max'] as const) {
    if (raw[k] !== undefined && !isNumber(raw[k])) throw new Error(`"${k}" must be a number`);
  }
  if (isNumber(raw.x_min) && isNumber(raw.x_max) && raw.x_min >= raw.x_max) {
    throw new Error('"x_min" must be below "x_max"');
  }
}

/** Editor fields for `x_min` / `x_max`: empty fits the readings. */
export const X_RANGE_FIELDS: FieldBinding[] = [
  { name: 'x_min', path: ['x_min'] },
  { name: 'x_max', path: ['x_max'] },
];

/** The x range as one row of the editor form. */
export const X_RANGE_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'x_min', selector: { number: { mode: 'box', step: 'any' } } },
      { name: 'x_max', selector: { number: { mode: 'box', step: 'any' } } },
    ],
  },
];

/** The fixed ends of the bottom axis, when set. */
export function xRange(raw: CardConfig): { min?: number; max?: number } {
  return { min: isNumber(raw.x_min) ? raw.x_min : undefined, max: isNumber(raw.x_max) ? raw.x_max : undefined };
}

export interface ValueAxesOptions {
  /** Fixed ends of the bottom axis (kept exactly). */
  x?: { min?: number; max?: number };
  /** Where the side axis starts when the card doesn't fix it (0 for counts). */
  yFloor?: number;
}

/**
 * Axes for a chart with values along the bottom: round steps on both, sized to the card, the side
 * axis honouring the card's `y_min` / `y_max`. Returned in the shape `chartArea` draws, with the
 * bottom ticks in `times` and the bottom span in `range`.
 */
export function valueAxes(
  ctx: ChartContext,
  xData: [number, number] | undefined,
  yData: [number, number] | undefined,
  opts: ValueAxesOptions = {},
): PlotAxes {
  const options = axisOptions(ctx.raw);
  const count = Math.max(2, Math.min(8, Math.round(chartWidth(ctx) / X_LABEL_PX)));
  const x = valueAxis(xData, opts.x ?? {}, count);
  const yFixed = { min: options.min ?? opts.yFloor, max: options.max };
  const value = valueAxis(yData, yFixed, Y_GAPS);
  return {
    options,
    value,
    times: x.ticks,
    unit: 'minute',
    range: { start: x.domain[0], end: x.domain[1] },
    scales: {
      x: linear(x.domain, [0, VIEW_W]),
      y: linear(value.domain, [VIEW_H, 0]),
      domain: value.domain,
    },
  };
}

/** Decimals that print the bottom axis' round steps exactly. */
export function xDecimals(axes: PlotAxes): number {
  const [a, b] = axes.times;
  if (a === undefined || b === undefined) return 0;
  return Math.max(0, -Math.floor(Math.log10(Math.abs(b - a)) + 1e-9));
}

/* ------------------------------------------------------------- picking ------------------------------------------------------------- */

interface PickState {
  i?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const picks = new WeakMap<HTMLElement, PickState>();

function pickState(host: HTMLElement): PickState {
  let s = picks.get(host);
  if (!s) {
    s = {};
    picks.set(host, s);
  }
  return s;
}

/** The mark the pointer is on, if any (an index the chart chose). */
export function pickedIndex(host: HTMLElement): number | undefined {
  return picks.get(host)?.i;
}

/** Forget the pointer (the card leaves the page). */
export function stopPick(host: HTMLElement): void {
  const s = picks.get(host);
  if (s?.timer !== undefined) clearTimeout(s.timer);
  picks.delete(host);
}

/**
 * Pointer handlers that ask `pick` which mark is under the pointer, given where it is as a
 * fraction of the element across and down, and the element's size in px. The card redraws only
 * when the answer changes. A mouse leaving clears it at once; a finger lifting leaves it up for a
 * moment so it can be read.
 */
export function pickHandlers(
  ctx: Pick<ChartContext, 'host' | 'requestUpdate'>,
  pick: (fx: number, fy: number, width: number, height: number) => number | undefined,
): Hover {
  const state = pickState(ctx.host);
  const set = (i: number | undefined) => {
    if (i === state.i) return;
    state.i = i;
    ctx.requestUpdate();
  };
  const cancel = () => {
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
  };
  return {
    move(ev) {
      cancel();
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const fx = rect.width > 0 ? Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) : 0;
      const fy = rect.height > 0 ? Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)) : 0;
      set(pick(fx, fy, rect.width, rect.height));
    },
    leave(ev) {
      cancel();
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

/**
 * The index of the point nearest the pointer in screen distance, or undefined when none is within
 * `reach` px. Points are in the plot's view box (VIEW_W × VIEW_H), which stretches to `width` ×
 * `height` px; `fx`, `fy` are the pointer as fractions of that box.
 */
export function nearestPoint(
  points: readonly (readonly [number, number])[],
  fx: number,
  fy: number,
  width: number,
  height: number,
  reach = 24,
): number | undefined {
  let best: number | undefined;
  let bestD = reach * reach;
  const px = fx * width;
  const py = fy * height;
  points.forEach(([x, y], i) => {
    const dx = (x / VIEW_W) * width - px;
    const dy = (y / VIEW_H) * height - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export interface PickRow {
  color?: string;
  name: string;
  value: string;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/**
 * A tooltip box for one picked mark, beside a point at (`x`, `y`) given as fractions of the plot,
 * with a heading and rows of name and value. `dot` puts a ring on the point; `band` shades a
 * column from `band[0]` to `band[1]` across instead (a bin or a box).
 */
export function pickTooltip(opts: {
  x: number;
  y: number;
  plotWidth: number;
  title: string;
  rows: PickRow[];
  dot?: string;
  band?: [number, number];
}): TemplateResult | typeof nothing {
  const { x, y, plotWidth, title, rows, dot, band } = opts;
  if (!(x >= 0 && x <= 1)) return nothing;
  const side = tooltipSide(x, plotWidth);
  return html`<div class="hover-layer" aria-hidden="true">
    ${band ? html`<div class="pick-band" style="left:${pct(band[0])};width:${pct(band[1] - band[0])}"></div>` : nothing}
    ${
      dot && y >= 0 && y <= 1
        ? html`<span class="hover-dot" style="left:${pct(x)};top:${pct(y)};background:${dot}"></span>`
        : nothing
    }
    <div class="tooltip ${side}" style=${side.startsWith('pin') ? '' : `left:${pct(x)}`}>
      <div class="tooltip-time">${title}</div>
      ${rows.map(
        (r) =>
          html`<div class="tooltip-row">
            ${r.color ? html`<span class="swatch" style="background:${r.color}"></span>` : nothing}
            <span class="tooltip-name">${r.name}</span>
            <span class="tooltip-value">${r.value}</span>
          </div>`,
      )}
    </div>
  </div>`;
}

/** The shaded column behind a picked bin or box; the rest comes from tooltipStyles. */
export const pickStyles = css`
  .pick-band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
`;
