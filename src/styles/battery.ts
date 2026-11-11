import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor, bandFor } from '../bands';
import { DEFAULT_BANDS } from '../config';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ResolvedBand } from '../types';
import type { ChartContext, ChartStyleModule } from './index';

/** Colours when the card sets no bands of its own: red below 20 %, amber below 40 %, green above. */
export const BATTERY_BANDS: ResolvedBand[] = [
  { from: -Infinity, color: 'red' },
  { from: 20, color: 'amber' },
  { from: 40, color: 'green' },
];

/** Narrowest a tile may get, px, before a set `columns` drops to fewer. */
const MIN_TILE = 76;
/** Space between tiles across, px. */
const GAP = 8;
/** The battery body and its terminal, px. */
const BODY_W = 44;
const BODY_H = 22;
const INNER = 3;

/** The colour for an entity: its own (or the card's) bands when set, else the battery defaults. */
export function batteryColor(e: ResolvedEntity): string {
  if (!e.available || e.value === null) return 'grey';
  if (e.config.severity === DEFAULT_BANDS) return bandFor(e.value, BATTERY_BANDS).color;
  return e.band.color;
}

/** The grid's columns: a set count is a maximum (tiles keep a minimum width), else as many as fit. */
export function batteryColumns(columns: number | undefined): string {
  if (columns === undefined) return `grid-template-columns: repeat(auto-fill, minmax(88px, 1fr))`;
  const gaps = (columns - 1) * GAP;
  return `grid-template-columns: repeat(auto-fill, minmax(max(min(${MIN_TILE}px, 100%), calc((100% - ${gaps}px) / ${columns} - 0.5px)), 1fr))`;
}

/** The battery glyph, filled from the left to `level` (0–1). */
function glyph(level: number, color: string | undefined) {
  const w = (BODY_W - INNER * 2) * Math.min(1, Math.max(0, level));
  return svg`<svg class="glyph" viewBox="0 0 ${BODY_W + 5} ${BODY_H}" width=${BODY_W + 5} height=${BODY_H}
    aria-hidden="true">
    <rect class="body ${color ? '' : 'empty'}" x="0.75" y="0.75" width=${BODY_W - 1.5} height=${BODY_H - 1.5} rx="4"></rect>
    <rect class="cap" x=${BODY_W + 1} y=${BODY_H / 2 - 4} width="3" height="8" rx="1"></rect>
    ${
      color && w > 0
        ? svg`<rect class="level" x=${INNER} y=${INNER} width=${w.toFixed(2)} height=${BODY_H - INNER * 2} rx="2"
          fill=${baseColor(color)}></rect>`
        : nothing
    }
  </svg>`;
}

function tile(e: ResolvedEntity, index: number, ctx: ChartContext): TemplateResult {
  const { show } = ctx.config;
  const color = e.available ? batteryColor(e) : undefined;
  return html`<div
    class="entity battery ${e.available ? '' : 'unavailable'}"
    data-index=${index}
    tabindex="0"
    role="img"
    aria-label=${e.label}
    title=${e.label}
  >
    ${glyph(e.available ? e.position : 0, color)}
    ${show.value || !e.available ? html`<span class="battery-value">${e.display}</span>` : nothing}
    ${show.name ? html`<span class="battery-name">${e.name}</span>` : nothing}
  </div>`;
}

export const battery: ChartStyleModule = {
  layout: 'chart',
  group: 'bars',
  height: 230,
  styles: css`
    .battery-grid {
      display: grid;
      gap: 14px ${GAP}px;
      padding: 4px 0;
    }
    .battery-grid .battery {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      min-width: 0;
      padding: 4px 2px;
      cursor: pointer;
    }
    .battery .glyph {
      display: block;
      margin-bottom: 4px;
      overflow: visible;
    }
    .battery .body {
      fill: none;
      stroke: var(--secondary-text-color);
      stroke-width: 1.5;
    }
    .battery .body.empty {
      stroke-dasharray: 3 2;
      opacity: 0.6;
    }
    .battery .cap {
      fill: var(--secondary-text-color);
    }
    .battery .level {
      transition: width var(--cd-duration) var(--cd-easing);
    }
    :host(:not([ready])) .battery .level {
      width: 0;
    }
    :host([static]) .battery .level {
      transition: none;
    }
    .battery-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--primary-text-color);
      white-space: nowrap;
    }
    .battery.unavailable .battery-value {
      font-weight: 400;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .battery-name {
      max-width: 100%;
      font-size: 12px;
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  thumbnail: () => svg`
    ${[
      [4, 4, 0.9, 'var(--success-color, #43a047)'],
      [34, 4, 0.55, 'var(--success-color, #43a047)'],
      [4, 23, 0.3, 'var(--warning-color, #f59e0b)'],
      [34, 23, 0.12, 'var(--error-color, #db4437)'],
    ].map(
      ([x, y, f, c]) => svg`
        <rect x=${x} y=${y} width="22" height="12" rx="2.5" fill="none" stroke="var(--secondary-text-color, #727272)"
          stroke-width="1.2"></rect>
        <rect x=${(x as number) + 22.5} y=${(y as number) + 4} width="2" height="4" rx="0.5"
          fill="var(--secondary-text-color, #727272)"></rect>
        <rect x=${(x as number) + 2} y=${(y as number) + 2} width=${18 * (f as number)} height="8" rx="1" fill=${c}></rect>`,
    )}`,
  render(ctx) {
    const levels = ctx.items.map((e) => e.label).join(', ');
    return html`<div
      class="battery-grid"
      style=${batteryColumns(ctx.config.columns)}
      role="img"
      aria-label=${localize(ctx.hass, 'battery_aria', { levels })}
    >
      ${ctx.items.map((e, i) => tile(e, i, ctx))}
    </div>`;
  },
};
