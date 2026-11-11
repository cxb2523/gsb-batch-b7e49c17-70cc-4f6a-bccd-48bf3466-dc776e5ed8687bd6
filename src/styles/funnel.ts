import { css, html, nothing, svg } from 'lit';
import { baseColor, onFillText } from '../bands';
import { SERIES_COLORS } from '../chart/colors';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { isInteractive } from '../actions';
import { formatNumber } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';

export const FUNNEL_SHAPES = ['funnel', 'pyramid'] as const;
export const PERCENT_OF = ['first', 'previous', 'none'] as const;
export const FUNNEL_COLOR_BY = ['series', 'bands'] as const;
export type FunnelShape = (typeof FUNNEL_SHAPES)[number];
export type PercentOf = (typeof PERCENT_OF)[number];

/** A stage below this width (percent of the widest) is too narrow for its percentage inside. */
const NARROW = 22;
/** How much the last funnel stage narrows towards its bottom edge. */
const TAPER = 0.8;

/** Each stage's width as a percentage of the largest; no number (or none above 0) is 0. */
export function stageWidths(values: (number | null)[]): number[] {
  const max = Math.max(0, ...values.map((v) => (v !== null && v > 0 ? v : 0)));
  return values.map((v) => (max > 0 && v !== null && v > 0 ? (v / max) * 100 : 0));
}

/**
 * Each stage as a percentage of the first, or of the stage before (the first is then 100).
 * Null where there is nothing to divide by or no value.
 */
export function stagePercents(values: (number | null)[], of: PercentOf): (number | null)[] {
  if (of === 'none') return values.map(() => null);
  return values.map((v, i) => {
    if (v === null) return null;
    if (of === 'previous' && i === 0) return 100;
    const base = of === 'first' ? values[0] : values[i - 1];
    return base !== null && base !== undefined && base > 0 ? (v / base) * 100 : null;
  });
}

/**
 * The top and bottom widths of each stage's trapezoid, in the order the stages are listed.
 * Funnel: a stage narrows to the width of the one below it; the last narrows a little. Pyramid
 * (first stage at the bottom): a stage narrows to the width of the one above it; the top one
 * comes to a point. A stage next to one without a value narrows a little instead.
 */
export function stageEdges(widths: number[], shape: FunnelShape): { top: number; bottom: number }[] {
  return widths.map((w, i) => {
    if (w <= 0) return { top: 0, bottom: 0 };
    const next = widths[i + 1];
    const last = i === widths.length - 1;
    if (shape === 'pyramid') {
      const top = last ? 0 : next > 0 ? next : w * TAPER;
      return { top, bottom: w };
    }
    return { top: w, bottom: !last && next > 0 ? next : w * TAPER };
  });
}

/** The trapezoid's corners, centred in a 100 × 10 box, as an SVG `points` attribute. */
export function trapezoid(top: number, bottom: number): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  const t = r((100 - top) / 2);
  const b = r((100 - bottom) / 2);
  return `${t},0 ${r(100 - t)},0 ${r(100 - b)},10 ${b},10`;
}

const FIELDS: FieldBinding[] = [
  { name: 'funnel_shape', path: ['shape'], default: 'funnel' },
  { name: 'funnel_percent_of', path: ['percent_of'], default: 'first' },
  { name: 'funnel_color_by', path: ['color_by'], default: 'series' },
];

function funnelEditor(ctx: ChartEditorContext) {
  const schema = cachedSchema('funnel', ctx.hass, () => [
    { name: 'funnel_shape', selector: choice(ctx.hass, 'funnel_shape', FUNNEL_SHAPES) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'funnel_percent_of', selector: choice(ctx.hass, 'funnel_percent_of', PERCENT_OF) },
        { name: 'funnel_color_by', selector: choice(ctx.hass, 'funnel_color_by', FUNNEL_COLOR_BY) },
      ],
    },
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS);
}

function check(raw: CardConfig, key: string, allowed: readonly string[]): void {
  const v = raw[key];
  if (v !== undefined && !allowed.includes(v as string)) {
    throw new Error(`"${key}" must be one of: ${allowed.join(', ')}`);
  }
}

/** The colour name (palette or CSS) a stage is filled with. */
function stageColor(e: ResolvedEntity, index: number, byBands: boolean): string {
  if (byBands) return e.band.color;
  const own = (e.config as { color?: unknown }).color;
  return typeof own === 'string' && own ? own : SERIES_COLORS[index % SERIES_COLORS.length];
}

export const funnel: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 240,
  styles: css`
    .style-funnel .funnel {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px 0;
    }
    .style-funnel .stage {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      align-items: center;
      gap: 12px;
    }
    .style-funnel .funnel.no-labels .stage {
      grid-template-columns: minmax(0, 1fr);
    }
    .style-funnel .shape {
      position: relative;
      height: 44px;
    }
    .style-funnel .shape svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      transform: scaleX(0);
      transform-origin: 50% 50%;
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .style-funnel .shape svg {
      transform: scaleX(1);
    }
    .style-funnel polygon.empty {
      fill: none;
      stroke: var(--secondary-text-color);
      stroke-width: 1;
      stroke-dasharray: 4 3;
      vector-effect: non-scaling-stroke;
    }
    .style-funnel .percent {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }
    .style-funnel .percent.dark {
      color: #1d1f24;
      text-shadow: none;
    }
    .style-funnel .percent.theme {
      color: var(--primary-text-color);
      text-shadow: none;
    }
    .style-funnel .label {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: 1.25;
    }
    .style-funnel .name {
      color: var(--secondary-text-color);
      font-size: 0.875em;
      overflow: hidden;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .style-funnel .value {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .style-funnel .unavailable .value {
      color: var(--secondary-text-color);
      font-weight: 400;
    }
  `,
  thumbnail: () => svg`
    <polygon points="6,4 58,4 48,15 16,15" fill="var(--warning-color, #f59e0b)" />
    <polygon points="16,17 48,17 41,27 23,27" fill="var(--success-color, #1fae7a)" />
    <polygon points="23,29 41,29 38,37 26,37" fill="var(--primary-color, #03a9f4)" />`,
  validate(raw: CardConfig) {
    check(raw, 'shape', FUNNEL_SHAPES);
    check(raw, 'percent_of', PERCENT_OF);
    check(raw, 'color_by', FUNNEL_COLOR_BY);
  },
  editor: funnelEditor,
  render(ctx) {
    const { items, raw, hass, config } = ctx;
    const shape = (raw.shape as FunnelShape | undefined) ?? 'funnel';
    const byBands = raw.color_by === 'bands';
    const values = items.map((e) => (e.available ? e.value : null));
    const widths = stageWidths(values);
    const edges = stageEdges(widths, shape);
    const percents = stagePercents(values, (raw.percent_of as PercentOf | undefined) ?? 'first');
    const { show } = config;
    const labels = show.name || show.value;
    const stages = items.map((e, i) => {
      const color = stageColor(e, i, byBands);
      const percent = percents[i];
      const percentText = percent === null ? '' : `${formatNumber(percent, 0, hass)}%`;
      const textTone = widths[i] < NARROW ? 'theme' : onFillText(color);
      const interactive = isInteractive(e.config);
      const { top, bottom } = edges[i];
      const drawn = widths[i] > 0;
      return html`<div
        class="entity stage ${interactive ? 'interactive' : ''} ${e.available ? '' : 'unavailable'}"
        data-index=${i}
        role="img"
        aria-label=${percentText ? `${e.label}, ${percentText}` : e.label}
        tabindex=${interactive ? 0 : nothing}
      >
        <div class="shape">
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
            ${
              drawn
                ? svg`<polygon points=${trapezoid(top, bottom)} fill=${baseColor(color)}></polygon>`
                : svg`<polygon class="empty" points=${trapezoid(30, 30)}></polygon>`
            }
          </svg>
          ${percentText ? html`<div class="percent ${textTone}" aria-hidden="true">${percentText}</div>` : nothing}
        </div>
        ${
          labels
            ? html`<div class="label" aria-hidden="true">
                ${show.name ? html`<span class="name">${e.name}</span>` : nothing}
                ${show.value ? html`<span class="value">${e.display}</span>` : nothing}
              </div>`
            : nothing
        }
      </div>`;
    });
    // A pyramid builds up from its first stage, so the first is drawn at the bottom.
    if (shape === 'pyramid') stages.reverse();
    const label = localize(hass, 'funnel_aria', {
      style: localize(hass, `editor_funnel_shape_${shape}`).replace(/ \(.*\)$/, ''),
      names: items.map((e) => e.name).join(', '),
    });
    return html`<div class="funnel ${labels ? '' : 'no-labels'}" role="group" aria-label=${label}>${stages}</div>`;
  },
};
