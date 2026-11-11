import { css, html, nothing, svg } from 'lit';
import { baseColor, solidColor } from '../bands';
import { centerContent, customAngles, gaugeAngles, angleAt, arcBox, union } from '../gauge';
import { arcPath, polar, sweepAngles } from '../geometry';
import { iconOverride } from '../resolve';
import { fitStatusText } from '../status-text';
import { ghostFor, ghostMarks, ghostStyles } from '../gauge-ghost';
import type { ValueStyleModule } from './index';

let counter = 0;
const ids = new WeakMap<object, string>();

/** A gradient id that is unique per document and stable across re-renders of the same entity. */
export function gradientId(owner: object): string {
  let id = ids.get(owner);
  if (!id) {
    id = `cd-g-${++counter}`;
    ids.set(owner, id);
  }
  return id;
}

const CX = 60;
const CY = 60;
const R = 46;
const STROKE = 11;

/** A short plain number for inline style (no float noise, no -0). */
const num = (x: number) => String(Math.round(x * 1000) / 1000 + 0);

/**
 * Centre value size: 22 when it fits, smaller for long numbers. At about half an em per
 * character this keeps the text within ~62 units, inside the 68-unit disc.
 */
function valueFontSize(text: string): number {
  return Math.min(22, Math.floor(124 / Math.max(1, text.length)));
}

/** Whether `color` can follow url() as a stroke fallback: no var(), and a colour this browser parses. */
function canPaint(color: string): boolean {
  if (color.includes('var(')) return false;
  return typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports('color', color);
}

/** Status text (Unavailable, Entity not found) on one or two lines, sized to fit the hollow. */
function statusText(text: string) {
  const { lines, size } = fitStatusText(text);
  const top = CY + 4 - ((lines.length - 1) * 1.2 * size) / 2;
  return svg`<text class="na" text-anchor="middle" style="font-size: ${size}px">${lines.map(
    (line, i) => svg`<tspan x=${CX} y=${num(top + i * 1.2 * size)}>${line}</tspan>`,
  )}</text>`;
}

/** Ring (360) and three-quarter arc (270) gauges share one drawing. */
export function radialStyle(sweep: 360 | 270): ValueStyleModule {
  const defaults = sweepAngles(sweep, [0, 1]);
  const defaultTrack = arcPath(CX, CY, R, defaults[0], defaults[1]);
  // The arc's open bottom is empty: crop the drawing just below its round end caps (~98).
  const defaultCropped = sweep < 360;
  return {
    layout: 'tiles',
    group: 'gauges',
    height: defaultCropped ? 135 : 155,
    minColumnWidth: 128,
    styles: css`
      ${ghostStyles}
      /* A definite width: the dial is a size container and can't size the tile itself. */
      .radial {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 6px 0;
        width: 124px;
        max-width: 100%;
        margin: 0 auto;
      }
      /* The dial is 124 px wide, smaller only when its tile is narrower; positions inside it
         are in cqw (1 % of the dial's width) so they scale with it. */
      .radial .dial {
        position: relative;
        container-type: inline-size;
        width: min(124px, 100%);
        aspect-ratio: 124 / 120;
      }
      .radial svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .radial.cropped .dial {
        aspect-ratio: 124 / 100;
      }
      .radial .track {
        fill: none;
        stroke: var(--cd-track);
        stroke-width: 11px;
        stroke-linecap: round;
      }
      .radial .disc {
        fill: var(--cd-track);
        opacity: 0.5;
      }
      .radial .value-arc {
        fill: none;
        stroke-width: 11px;
        stroke-linecap: round;
        transition:
          stroke-dasharray var(--cd-duration) var(--cd-easing),
          stroke-dashoffset var(--cd-duration) var(--cd-easing);
      }
      :host(:not([ready])) .radial .value-arc {
        stroke-dasharray: 0 100 !important;
        stroke-dashoffset: 0 !important;
      }
      .radial .value-arc.empty {
        opacity: 0;
      }
      .radial .stop-start {
        stop-color: var(--c-start);
      }
      .radial .stop-end {
        stop-color: var(--c-end);
      }
      .radial .tick {
        stroke: var(--primary-text-color);
        stroke-width: 2.5px;
      }
      .radial .value {
        font-size: 22px;
        font-weight: 500;
        fill: var(--primary-text-color);
      }
      .radial .center-text {
        font-weight: 500;
        fill: var(--primary-text-color);
      }
      .radial .unit {
        font-size: 11px;
        fill: var(--secondary-text-color);
      }
      .radial .na {
        font-size: 12px;
        fill: var(--secondary-text-color);
      }
      .radial .icon {
        position: absolute;
        left: 50%;
        top: 25cqw;
        transform: translateX(-50%);
        color: var(--state-icon-color, var(--secondary-text-color));
        --mdc-icon-size: 14.52cqw;
      }
      /* With the value hidden, the icon is all that sits in the hollow, so it moves to the
         dial centre (y 60, also on the cropped arc) and grows to fill it. */
      .radial .icon.centre {
        top: 48.39cqw;
        transform: translate(-50%, -50%);
        --mdc-icon-size: 22.58cqw;
      }
      /* A custom sweep crops --y0 drawing units off the top: move the icon up by as much. */
      .radial .dial.fitted .icon {
        top: calc(25cqw - var(--y0) * 0.8065cqw);
      }
      .radial .dial.fitted .icon.centre {
        top: calc(48.39cqw - var(--y0) * 0.8065cqw);
      }
      .radial .name {
        max-width: min(124px, 100%);
        font-size: 12px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
    render(e, { show, hass, requestUpdate }) {
      const id = gradientId(e.config);
      const options = e.config.gauge;
      const angles = gaugeAngles(defaults, options);
      const custom = customAngles(options);
      const trackD = custom ? arcPath(CX, CY, R, angles[0], angles[1]) : defaultTrack;
      // A custom sweep crops the drawing to the arc and the centre disc, full width kept.
      let y0 = 0;
      let h = defaultCropped ? 100 : 120;
      if (custom) {
        const box = union(arcBox(CX, CY, R, angles[0], angles[1], STROKE / 2 + 1), { x0: 26, y0: 26, x1: 94, y1: 94 });
        y0 = Math.max(0, Math.floor(box.y0));
        h = Math.min(120, Math.ceil(box.y1)) - y0;
      }
      const cropped = h < 120;
      const center = e.available && show.value ? centerContent(e, options) : { kind: 'none' as const };
      const empty = e.span[1] - e.span[0] <= 0;
      // Plain numbers (pathLength 100), not calc() on custom properties, so every engine draws them.
      const dash = `stroke-dasharray: ${num((e.span[1] - e.span[0]) * 100)} 100; stroke-dashoffset: ${num(-e.span[0] * 100)}`;
      // A second paint after url() is used if the gradient reference can't be resolved, so
      // the arc still draws. Only for a colour this browser can parse: attributes can't
      // resolve var(), and an unknown colour would void the whole stroke.
      const solid = solidColor(e.band.color);
      const paint = canPaint(solid) ? `url(#${id}) ${solid}` : `url(#${id})`;
      const shift = show.icon ? 6 : 0;
      const size = valueFontSize(e.valueText);
      let tick = nothing as unknown;
      if (show.target && e.targetPosition !== null && e.available) {
        const deg = angleAt(angles, e.targetPosition);
        const [x1, y1] = polar(CX, CY, R - STROKE / 2 - 1, deg);
        const [x2, y2] = polar(CX, CY, R + STROKE / 2 + 1, deg);
        tick = svg`<line class="tick" x1=${x1.toFixed(2)} y1=${y1.toFixed(2)} x2=${x2.toFixed(2)} y2=${y2.toFixed(2)}></line>`;
      }
      // The last day's (or week's) range just inside the track, between it and the centre disc.
      const ghost = ghostMarks(
        ghostFor(hass, e.entityId, e.config.attribute, options?.ghost, requestUpdate),
        e,
        options?.ghost,
        { cx: CX, cy: CY, r: 37.5, width: 4, tick: [35, 40.5], at: (t) => angleAt(angles, t) },
        hass,
      );
      return html`<div class="radial ${cropped ? 'cropped' : ''}">
        <div class="dial ${custom ? 'fitted' : ''}" style=${custom ? `aspect-ratio: 124 / ${h}; --y0: ${y0}` : nothing}>
          <svg viewBox="0 ${y0} 120 ${h}" aria-hidden="true">
            <defs>
              <linearGradient id=${id} x1="0" y1="1" x2="1" y2="0">
                <stop class="stop-start" offset="0"></stop>
                <stop class="stop-end" offset="1"></stop>
              </linearGradient>
            </defs>
            <circle class="disc" cx=${CX} cy=${CY} r="34"></circle>
            <path class="track" d=${trackD}></path>
            ${ghost}
            ${
              e.available
                ? svg`<path
                  class="value-arc ${empty ? 'empty' : ''}"
                  d=${trackD}
                  pathLength="100"
                  style=${dash}
                  stroke=${paint}
                ></path>`
                : nothing
            }
            ${tick}
            ${
              e.available
                ? svg`${
                    center.kind === 'text'
                      ? svg`<text
                        class="center-text"
                        x=${CX}
                        y=${CY + 6 + shift}
                        text-anchor="middle"
                        style="font-size: ${Math.min(18, valueFontSize(center.text))}px${
                          center.band ? `; fill: ${baseColor(e.band.color)}` : ''
                        }"
                      >${center.text}</text>`
                      : center.kind === 'value'
                        ? svg`<text
                        class="value"
                        x=${CX}
                        y=${CY + 4 + shift}
                        text-anchor="middle"
                        style=${size < 22 ? `font-size: ${size}px` : nothing}
                      >${e.valueText}</text>
                      <text class="unit" x=${CX} y=${CY + 20 + shift} text-anchor="middle">${e.unit}</text>`
                        : nothing
                  }`
                : statusText(e.display)
            }
          </svg>
          ${
            show.icon && e.available
              ? html`<ha-state-icon
                  class="icon ${show.value && center.kind !== 'none' ? '' : 'centre'}"
                  .hass=${hass}
                  .stateObj=${e.stateObj}
                  .icon=${iconOverride(e)}
                ></ha-state-icon>`
              : nothing
          }
        </div>
        ${show.name && options?.center !== 'name' ? html`<span class="name">${e.name}</span>` : nothing}
      </div>`;
    },
  };
}

export const ring = radialStyle(360);
export const arc = radialStyle(270);
