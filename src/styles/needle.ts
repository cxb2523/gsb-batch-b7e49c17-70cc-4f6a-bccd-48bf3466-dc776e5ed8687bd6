import { css, html, nothing, svg } from 'lit';
import { baseColor } from '../bands';
import { formatNumber } from '../format';
import {
  angleAt,
  arcBox,
  centerContent,
  customAngles,
  gaugeAngles,
  labelPlacement,
  scaleTicks,
  tickDecimals,
  tickStep,
  union,
} from '../gauge';
import type { Box } from '../gauge';
import { arcPath, needlePath, polar } from '../geometry';
import { ghostFor, ghostMarks, ghostStyles } from '../gauge-ghost';
import { fitStatusText } from '../status-text';
import type { ResolvedBand } from '../types';
import type { ValueStyleModule } from './index';
import { iconOverride } from '../resolve';

const CX = 65;
const CY = 66;
const R = 50;
const GAP = 1;
const DEFAULT_ANGLES: [number, number] = [-90, 90];
/** Tick labels sit just outside the band arc (outer edge R + 6), or past the target marker (R + 14). */
const LABEL_R = R + 10;
const LABEL_R_TARGET = R + 17;
const LABEL_SIZE = 9;
/** The value line's baseline under the hub in the fixed layout. */
const VALUE_Y = 94;

/** A short plain number for inline style (no float noise, no -0). */
const num = (x: number) => String(Math.round(x * 1000) / 1000 + 0);

/**
 * Each band's [from, nextFrom) clipped to [min, max] and mapped to 0..1; empty segments are dropped.
 * The first band also covers everything below its `from`, matching bandFor().
 */
export function bandSegments(
  bands: ResolvedBand[],
  min: number,
  max: number,
): { from: number; to: number; color: string }[] {
  const range = max - min;
  const out: { from: number; to: number; color: string }[] = [];
  if (!(range > 0)) return out;
  bands.forEach((band, i) => {
    const lo = i === 0 ? min : Math.max(band.from, min);
    const hi = Math.min(i + 1 < bands.length ? bands[i + 1].from : Infinity, max);
    if (!(hi > lo)) return;
    out.push({ from: (lo - min) / range, to: (hi - min) / range, color: band.color });
  });
  return out;
}

/**
 * Status text inside the dial, above the hub, for a compact gauge: one or two lines, shrunk to
 * fit between the ticks, the last line's baseline at y 55 (just above the hub).
 */
function statusInDial(text: string) {
  return statusLines(text, 58, 11, 7, 55);
}

/** Status text in the value's place under a full-height gauge, fitted to the tile's width. */
function statusBelow(text: string, baseline = VALUE_Y) {
  // One line whenever it fits at full size (126 / (0.58 × 12) ≈ 18 characters).
  return statusLines(text, 126, 12, 8, baseline, 18);
}

function statusLines(text: string, width: number, max: number, min: number, lastBaseline: number, splitAbove = 11) {
  const { lines, size } = fitStatusText(text, width, max, min, splitAbove);
  const top = lastBaseline - (lines.length - 1) * 1.2 * size;
  return svg`<text class="na" text-anchor="middle" style="font-size: ${size}px">${lines.map(
    (line, i) => svg`<tspan x=${CX} y=${num(top + i * 1.2 * size)}>${line}</tspan>`,
  )}</text>`;
}

/** Half-circle gauge: banded arc, ticks, and a needle that overshoots into place. */
export const needle: ValueStyleModule = {
  layout: 'tiles',
  group: 'gauges',
  height: 140,
  minColumnWidth: 134,
  styles: css`
    ${ghostStyles}
    /* A definite width that shrinks with a narrow tile (the svg inside is sized in %). */
    .needle-gauge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 6px 0;
      width: 130px;
      max-width: 100%;
      margin: 0 auto;
    }
    /* 130 px wide, smaller only when the tile is narrower. */
    .needle-gauge svg {
      display: block;
      width: min(130px, 100%);
      height: auto;
      aspect-ratio: 130 / 104;
      overflow: visible;
    }
    .needle-gauge svg.compact {
      aspect-ratio: 130 / 82;
    }
    .needle-gauge .seg {
      fill: none;
      stroke-width: 12px;
      stroke-linecap: round;
    }
    .needle-gauge .tickmark {
      stroke: var(--secondary-text-color);
      stroke-width: 1.2px;
    }
    .needle-gauge .needle {
      fill: var(--primary-text-color);
      transform-box: view-box;
      transform-origin: 65px 66px;
      transition: transform 0.9s cubic-bezier(0.22, 1.4, 0.36, 1);
    }
    :host(:not([ready])) .needle-gauge .needle {
      transform: rotate(-90deg) !important;
    }
    :host(:not([ready])) .needle-gauge.fitted .needle {
      transform: rotate(var(--needle-start)) !important;
    }
    .needle-gauge .hub {
      fill: var(--primary-text-color);
    }
    .needle-gauge .hub-dot {
      fill: var(--card-background-color, var(--ha-card-background));
    }
    .needle-gauge .target-mark {
      fill: var(--primary-text-color);
    }
    .needle-gauge .value {
      font-size: 15px;
      font-weight: 500;
      fill: var(--primary-text-color);
    }
    .needle-gauge .tick-label {
      font-size: 9px;
      fill: var(--secondary-text-color);
    }
    .needle-gauge .center-text {
      font-size: 15px;
      font-weight: 500;
      fill: var(--primary-text-color);
    }
    .needle-gauge .na {
      font-size: 12px;
      fill: var(--secondary-text-color);
    }
    .needle-gauge .icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      --mdc-icon-size: 18px;
    }
    .needle-gauge .name {
      display: flex;
      align-items: center;
      gap: 4px;
      max-width: 130px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .needle-gauge .name span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  render(e, { show, hass, requestUpdate }) {
    const options = e.config.gauge;
    const angles = gaugeAngles(DEFAULT_ANGLES, options);
    const at = (t: number) => angleAt(angles, t);
    const segs = bandSegments(e.bands, e.min, e.max);
    const arcs = segs.map((s, i) => {
      const a0 = at(s.from) + (i > 0 ? GAP : 0);
      const a1 = at(s.to) - (i < segs.length - 1 ? GAP : 0);
      if (!(a1 > a0)) return nothing;
      return svg`<path class="seg" d=${arcPath(CX, CY, R, a0, a1)} stroke=${baseColor(s.color)}></path>`;
    });
    const tickmark = (deg: number) => {
      const [x1, y1] = polar(CX, CY, 36, deg);
      const [x2, y2] = polar(CX, CY, 40, deg);
      return svg`<line class="tickmark" x1=${x1.toFixed(2)} y1=${y1.toFixed(2)} x2=${x2.toFixed(2)} y2=${y2.toFixed(2)}></line>`;
    };
    // With tick labels, a mark at each labelled value; otherwise ten even steps.
    const values = options?.tickLabels ? scaleTicks(e.min, e.max) : [];
    const range = e.max - e.min;
    const ticks = values.length
      ? values.map((v) => tickmark(at((v - e.min) / range)))
      : Array.from({ length: 11 }, (_, i) => tickmark(at(i / 10)));
    const step = tickStep(range);
    // The last day's (or week's) range inside the band arc, under the ticks.
    const ghost = ghostMarks(
      ghostFor(hass, e.entityId, e.config.attribute, options?.ghost, requestUpdate),
      e,
      options?.ghost,
      { cx: CX, cy: CY, r: 40.5, width: 6, tick: [36, 44], at },
      hass,
    );
    const hasTarget = show.target && e.targetPosition !== null;
    const labelR = hasTarget ? LABEL_R_TARGET : LABEL_R;
    const fitted = customAngles(options) || values.length > 0;
    // A sweep that comes down past the hub would run through the value line: put it under the arc.
    const valueY = fitted ? Math.max(VALUE_Y, Math.ceil(arcBox(CX, CY, R, angles[0], angles[1], 6).y1) + 14) : VALUE_Y;
    const labels = values.map((v) => {
      const deg = at((v - e.min) / range);
      const [x, y] = polar(CX, CY, labelR, deg);
      const { anchor, dy } = labelPlacement(deg);
      return svg`<text class="tick-label" x=${x.toFixed(2)} y=${y.toFixed(2)} dy="${dy}em" text-anchor=${anchor}>${formatNumber(v, tickDecimals(v, step), hass)}</text>`;
    });
    let mark: unknown = nothing;
    if (show.target && e.targetPosition !== null && e.available) {
      const deg = at(e.targetPosition);
      const [tx, ty] = polar(CX, CY, R + 7, deg);
      const [lx, ly] = polar(CX, CY, R + 14, deg - 3);
      const [rx, ry] = polar(CX, CY, R + 14, deg + 3);
      mark = svg`<polygon class="target-mark" points="${tx.toFixed(2)},${ty.toFixed(2)} ${lx.toFixed(2)},${ly.toFixed(2)} ${rx.toFixed(2)},${ry.toFixed(2)}"></polygon>`;
    }
    // Without a value line under the hub, the drawing ends at the hub and the name moves up.
    const compact = !show.value;
    const center = e.available ? centerContent(e, options) : { kind: 'value' as const };
    // A custom sweep or tick labels: fit the drawing to what is drawn instead of the fixed box.
    let view = { x: 0, y: 0, w: 130, h: compact ? 82 : 104 };
    if (fitted) {
      const box = drawingBox(e, angles, values, step, { hasTarget, labelR, valueY, compact }, hass);
      view = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
    }
    const style = fitted
      ? `width: min(${num(view.w)}px, 100%); aspect-ratio: ${num(view.w)} / ${num(view.h)}`
      : undefined;
    return html`<div
      class="needle-gauge ${fitted ? 'fitted' : ''}"
      style=${fitted ? `--needle-start: ${num(angles[0])}deg; width: ${num(Math.max(130, view.w))}px` : nothing}
    >
      <svg
        class=${compact ? 'compact' : ''}
        viewBox="${num(view.x)} ${num(view.y)} ${num(view.w)} ${num(view.h)}"
        style=${style ?? nothing}
        aria-hidden="true"
      >
        ${arcs} ${ghost} ${ticks} ${labels} ${mark}
        ${
          e.available
            ? svg`<g class="needle" style="transform: rotate(${num(at(e.position))}deg)"><path d=${needlePath(CX, CY, 42, 3)}></path></g>`
            : nothing
        }
        <circle class="hub" cx=${CX} cy=${CY} r="6"></circle>
        <circle class="hub-dot" cx=${CX} cy=${CY} r="2.5"></circle>
        ${
          e.available
            ? show.value
              ? center.kind === 'value'
                ? svg`<text class="value" x=${CX} y=${valueY} text-anchor="middle">${e.display}</text>`
                : center.kind === 'text'
                  ? svg`<text
                      class="center-text"
                      x=${CX}
                      y=${valueY}
                      text-anchor="middle"
                      style=${center.band ? `fill: ${baseColor(e.band.color)}` : nothing}
                    >${center.text}</text>`
                  : nothing
              : nothing
            : compact
              ? statusInDial(e.display)
              : statusBelow(e.display, valueY)
        }
      </svg>
      ${
        (show.name && options?.center !== 'name') || show.icon
          ? html`<div class="name">
              ${
                show.icon
                  ? html`<ha-state-icon
                      class="icon"
                      .hass=${hass}
                      .stateObj=${e.stateObj}
                      .icon=${iconOverride(e)}
                    ></ha-state-icon>`
                  : nothing
              }
              ${show.name && options?.center !== 'name' ? html`<span class="name-text">${e.name}</span>` : nothing}
            </div>`
          : nothing
      }
    </div>`;
  },
};

/**
 * The box around a needle gauge as drawn: its band arc, hub and needle, the value line (or status
 * text) under the hub, the target marker and the tick labels, with a little margin.
 */
function drawingBox(
  e: { min: number; max: number },
  angles: [number, number],
  ticks: number[],
  step: number,
  layout: { hasTarget: boolean; labelR: number; valueY: number; compact: boolean },
  hass: Parameters<typeof formatNumber>[2],
): Box {
  const boxes: Box[] = [
    arcBox(CX, CY, R, angles[0], angles[1], layout.hasTarget ? 15 : 7),
    // The needle reaches 42 from the hub, all the way round.
    arcBox(CX, CY, 43, angles[0], angles[1], 0),
    { x0: CX - 8, y0: CY - 8, x1: CX + 8, y1: CY + 8 },
    // The value (or status) line under the hub, as in the fixed layout.
    layout.compact
      ? { x0: 2, y0: 40, x1: 128, y1: 82 }
      : { x0: 2, y0: layout.valueY - 16, x1: 128, y1: layout.valueY + 6 },
  ];
  const range = e.max - e.min;
  for (const v of ticks) {
    const deg = angleAt(angles, (v - e.min) / range);
    const [x, y] = polar(CX, CY, layout.labelR, deg);
    const { anchor, dy } = labelPlacement(deg);
    // About 0.6 em per character for these digits.
    const width = formatNumber(v, tickDecimals(v, step), hass).length * LABEL_SIZE * 0.6;
    const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    const base = y + dy * LABEL_SIZE;
    boxes.push({ x0: left, y0: base - LABEL_SIZE, x1: left + width, y1: base + 2 });
  }
  const box = union(...boxes);
  return {
    x0: Math.floor(box.x0 - 2),
    y0: Math.floor(box.y0 - 2),
    x1: Math.ceil(box.x1 + 2),
    y1: Math.ceil(box.y1 + 2),
  };
}
