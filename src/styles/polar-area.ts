import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { PALETTE, baseColor } from '../bands';
import { seriesColor, shade } from '../chart/colors';
import { axisAngle, labelAnchor, polar, sectorPath } from '../chart/polar';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const POLAR_SCALES = ['shared', 'limits'] as const;
export type PolarScale = (typeof POLAR_SCALES)[number];
export const POLAR_COLOR_BY = ['series', 'shades', 'bands'] as const;
export type PolarColorBy = (typeof POLAR_COLOR_BY)[number];

const HALF_W = 170;
const HALF_H = 120;
const RADIUS = 92;
/** A small hole in the middle, so thin slices don't meet in a point. */
const HOLE = 6;
/** Angle left empty either side of each slice (radians). */
const GAP = 0.02;
const RINGS = 3;

/** How far out a slice reaches, 0–1: its share of the largest value, or its place between its limits. */
export function sliceLength(e: ResolvedEntity, scale: PolarScale, largest: number): number | null {
  if (!e.available || e.value === null) return null;
  if (scale === 'limits') return e.position;
  return largest > 0 ? Math.min(1, Math.max(0, e.value / largest)) : 0;
}

/** Slice `i` of `n`, centred on its spoke, with a thin gap either side; one slice is a whole disc. */
export function sliceAngles(i: number, n: number): [number, number] {
  if (n <= 1) return [0, Math.PI * 2];
  const half = Math.PI / n;
  const mid = axisAngle(i, n);
  return [mid - half + GAP, mid + half - GAP];
}

/** The slice's fill: its series colour, a shade of one colour by length, or its band colour. */
export function sliceColor(e: ResolvedEntity, i: number, length: number, colorBy: PolarColorBy, base: string): string {
  if (colorBy === 'bands') return baseColor(e.band.color);
  if (colorBy === 'shades') return shade(baseColor(base), 30 + 70 * length);
  return seriesColor(i);
}

/** Dashed rings at even steps, and (separately, drawn over the slices) their values. */
function rings(): SVGTemplateResult {
  return svg`${Array.from({ length: RINGS }, (_, k) => svg`<circle class="ring" r=${(RADIUS * (k + 1)) / RINGS}></circle>`)}`;
}

function ringLabels(ctx: ChartContext, scale: PolarScale, largest: number): SVGTemplateResult {
  const first = ctx.items.find((e) => e.available);
  // Values only make sense on a shared scale; with per-entity limits each slice has its own.
  if (scale !== 'shared' || !first || largest <= 0) return svg``;
  // Along the gap between the first two slices, where no slice covers it.
  const angle = ctx.items.length > 1 ? Math.PI / ctx.items.length : 0;
  return svg`${Array.from({ length: RINGS }, (_, k) => {
    const r = (RADIUS * (k + 1)) / RINGS;
    const [x, y] = polar(r, angle);
    const text = withUnit(formatNumber((largest * (k + 1)) / RINGS, first.decimals, ctx.hass), first.unit);
    return svg`<text class="ring-label" x=${x + 3} y=${y - 2}>${text}</text>`;
  })}`;
}

function labels(ctx: ChartContext): SVGTemplateResult {
  const n = ctx.items.length;
  const { show } = ctx.config;
  if (!show.name && !show.value) return svg``;
  return svg`${ctx.items.map((e, i) => {
    const angle = axisAngle(i, n);
    const [x, y] = polar(RADIUS + 12, angle);
    const below = Math.cos(angle) < -0.2;
    const lines = show.name && show.value ? 2 : 1;
    const dy = below ? 10 : Math.abs(Math.cos(angle)) <= 0.2 ? 4 - (lines - 1) * 6 : -(lines - 1) * 13;
    return svg`<text class="slice-label ${e.available ? '' : 'muted'}" x=${x} y=${y + dy} text-anchor=${labelAnchor(angle)}>
      ${show.name ? svg`<tspan>${e.name}</tspan>` : nothing}
      ${show.value ? svg`<tspan class="slice-value" x=${x} dy=${show.name ? 13 : 0}>${e.display}</tspan>` : nothing}
    </text>`;
  })}`;
}

const FIELDS: FieldBinding[] = [
  { name: 'polar_scale', path: ['scale'], default: 'shared' },
  { name: 'polar_color_by', path: ['color_by'], default: 'series' },
  { name: 'polar_color', path: ['color'], default: 'primary' },
];

const PALETTE_NAMES = Object.keys(PALETTE);

export function polarAreaEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('polar_area', ctx.hass, () => [
    { name: 'polar_scale', selector: choice(ctx.hass, 'polar_scale', POLAR_SCALES) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'polar_color_by', selector: choice(ctx.hass, 'polar_color_by', POLAR_COLOR_BY) },
        {
          name: 'polar_color',
          selector: {
            select: {
              mode: 'dropdown',
              custom_value: true,
              options: PALETTE_NAMES.map((value) => ({ value, label: localize(ctx.hass, `editor_color_${value}`) })),
            },
          },
        },
      ],
    },
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS);
}

export const polarArea: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 260,
  styles: css`
    .polar-plot {
      display: block;
      width: 100%;
      height: 240px;
      overflow: visible;
    }
    .polar-plot .ring {
      fill: none;
      stroke: var(--divider-color, rgba(127, 127, 127, 0.25));
      stroke-dasharray: 3 3;
    }
    .polar-plot .ring:last-of-type {
      stroke-dasharray: none;
    }
    .polar-plot .ring-label {
      fill: var(--secondary-text-color);
      font-size: 10px;
      paint-order: stroke;
      stroke: var(--card-background-color, #fff);
      stroke-width: 3px;
      stroke-linejoin: round;
    }
    .polar-plot .slice-label {
      fill: var(--secondary-text-color);
      font-size: 12px;
    }
    .polar-plot .slice-value {
      fill: var(--primary-text-color);
      font-weight: 500;
    }
    .polar-plot .slice-label.muted .slice-value {
      fill: var(--secondary-text-color);
      font-weight: 400;
    }
    .polar-plot .slice {
      cursor: pointer;
      outline: none;
      stroke: var(--card-background-color, #fff);
      stroke-width: 0.5;
    }
    .polar-plot .slice:focus-visible {
      stroke: var(--primary-text-color);
      stroke-width: 2;
    }
    .polar-grow {
      transform-box: fill-box;
      transform-origin: center;
      transform: scale(0);
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .polar-grow {
      transform: scale(1);
    }
    :host([static]) .polar-grow {
      transition: none;
    }
  `,
  thumbnail: () => svg`
    <g transform="translate(32 21)">
      <path d=${sectorPath(0, 18, -0.6, 0.6)} fill="var(--primary-color, #03a9f4)" />
      <path d=${sectorPath(0, 12, 0.65, 1.85)} fill="var(--warning-color, #ffa600)" />
      <path d=${sectorPath(0, 15, 1.9, 3.1)} fill="var(--success-color, #43a047)" />
      <path d=${sectorPath(0, 9, 3.15, 4.35)} fill="var(--error-color, #db4437)" />
      <path d=${sectorPath(0, 13, 4.4, 5.6)} fill="var(--purple-color, #8b6cff)" />
    </g>`,
  validate(raw: CardConfig) {
    if (raw.scale !== undefined && !POLAR_SCALES.includes(raw.scale as PolarScale)) {
      throw new Error(`"scale" must be one of: ${POLAR_SCALES.join(', ')}`);
    }
    if (raw.color_by !== undefined && !POLAR_COLOR_BY.includes(raw.color_by as PolarColorBy)) {
      throw new Error(`"color_by" must be one of: ${POLAR_COLOR_BY.join(', ')}`);
    }
    if (raw.color !== undefined && (typeof raw.color !== 'string' || !raw.color)) {
      throw new Error('"color" must be a colour name, such as "primary", or any CSS colour');
    }
  },
  editor: polarAreaEditor,
  render(ctx) {
    const scale: PolarScale = (ctx.raw.scale as PolarScale | undefined) ?? 'shared';
    const colorBy: PolarColorBy = (ctx.raw.color_by as PolarColorBy | undefined) ?? 'series';
    const base = (ctx.raw.color as string | undefined) ?? 'primary';
    const n = ctx.items.length;
    const values = ctx.items.filter((e) => e.available && e.value !== null).map((e) => e.value as number);
    const largest = values.length ? Math.max(0, ...values) : 0;
    const slices = ctx.items.map((e, i) => {
      const length = sliceLength(e, scale, largest);
      if (length === null || length <= 0) return nothing;
      const [a0, a1] = sliceAngles(i, n);
      const r = HOLE + (RADIUS - HOLE) * length;
      return svg`<path class="entity slice" data-index=${i} tabindex="0" role="img" aria-label=${e.label}
        d=${sectorPath(HOLE, r, a0, a1)} fill=${sliceColor(e, i, length, colorBy, base)}></path>`;
    });
    const label = localize(ctx.hass, 'polar_area_aria', { names: ctx.items.map((e) => e.name).join(', ') });
    return html`<svg
      class="polar-plot"
      viewBox="${-HALF_W} ${-HALF_H} ${HALF_W * 2} ${HALF_H * 2}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label=${label}
    >
      ${rings()}
      <g class="polar-grow">
        <circle r=${RADIUS} fill="none" stroke="none"></circle>
        ${slices}
      </g>
      ${ringLabels(ctx, scale, largest)} ${labels(ctx)}
    </svg>`;
  },
};
