import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult } from 'lit';
import {
  apportion,
  arcs,
  cachedSchema,
  centreText,
  chartForm,
  checkBoolean,
  checkChoice,
  checkNumber,
  checkText,
  choice,
  degreesFor,
  partColor,
  partValues,
  partsLabel,
  partsLegend,
  partsStyles,
  percentText,
  segStyle,
  shares,
  sharedUnit,
  shrink,
  summary,
} from '../chart/parts';
import type { Arc, ColorBy, LegendRow } from '../chart/parts';
import { isInteractive } from '../actions';
import { ENERGY_TOTALS_FIELDS, energyTotalsSchema, energyTotalsVariant } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';
import { isEnergyTotals } from '../history/energy';
import { localize } from '../localize';

export const SHAPES = ['donut', 'pie'] as const;
export const PIE_CENTER = ['total', 'none'] as const;
export const PIE_COLOR_BY: ColorBy[] = ['series', 'bands', 'shades'];

/** Outer edge of the drawing in a 100 × 100 box. */
const OUTER = 48;
/** Width of a donut's ring. */
const THICKNESS = 13;

/** Where each part's slice runs, with room left for the gap and round ends. */
export function sliceArcs(
  values: number[],
  opts: { shape: 'donut' | 'pie'; gap: number; rounded: boolean },
): (Arc | undefined)[] {
  const fractions = shares(values);
  const drawn = fractions.filter((f) => f > 0).length;
  const radius = opts.shape === 'donut' ? OUTER - THICKNESS / 2 : OUTER / 2;
  // A pie's gaps are separator lines; a donut's are taken off each slice (with its round ends).
  let cut = 0;
  if (opts.shape === 'donut') {
    if (drawn > 1) cut += degreesFor(opts.gap, radius);
    if (opts.rounded) cut += degreesFor(THICKNESS, radius);
  }
  return arcs(fractions).map((arc, i) => (fractions[i] > 0 ? shrink(arc, cut) : undefined));
}

function gradient(id: string, color: string, inner: number): SVGTemplateResult {
  return svg`<radialGradient id=${id} gradientUnits="userSpaceOnUse" cx="50" cy="50" r=${OUTER}>
    <stop offset=${inner} style="stop-color:color-mix(in srgb, ${color} 65%, #fff)"></stop>
    <stop offset="1" style="stop-color:${color}"></stop>
  </radialGradient>`;
}

function options(raw: CardConfig) {
  return {
    shape: (raw.shape as 'donut' | 'pie' | undefined) ?? 'donut',
    center: (raw.center as 'total' | 'none' | undefined) ?? 'total',
    colorBy: (raw.color_by as ColorBy | undefined) ?? 'series',
    shadeColor: (raw.shade_color as string | undefined) || 'primary',
    gap: (raw.gap as number | undefined) ?? 2,
    rounded: raw.rounded === true,
    gradient: raw.gradient === true,
    percent: raw.show_percent !== false,
    centerLabel: (raw.center_label as string | undefined) ?? '',
  };
}

function render(ctx: ChartContext) {
  const o = options(ctx.raw);
  const items = ctx.items;
  const values = partValues(items);
  const colors = items.map((e, i) => partColor(e, i, items.length, o.colorBy, o.shadeColor));
  const sliceAt = sliceArcs(values, o);
  const donut = o.shape === 'donut';
  const radius = donut ? OUTER - THICKNESS / 2 : OUTER / 2;
  const width = donut ? THICKNESS : OUTER;
  const inner = donut ? (OUTER - THICKNESS) / OUTER : 0;
  const drawn = sliceAt.filter(Boolean).length;
  // Energy dashboard totals with nothing in them: an empty ring would read as no data at all.
  if (drawn === 0 && isEnergyTotals(items)) {
    return html`<div class="chart-message">${localize(ctx.hass, 'energy_nothing_flowed')}</div>`;
  }

  const defs = o.gradient
    ? svg`<defs>${items.map((_, i) => (sliceAt[i] ? gradient(`cd-pie-${i}`, colors[i], inner) : nothing))}</defs>`
    : nothing;
  const slices = items.map((e, i) => {
    const arc = sliceAt[i];
    if (!arc) return nothing;
    const paint = o.gradient ? `url(#cd-pie-${i})` : colors[i];
    return svg`<g
      class="entity slice ${isInteractive(e.config) ? 'interactive' : ''}"
      data-index=${i}
      aria-label=${e.label}
    >
      <circle
        class="seg"
        cx="50"
        cy="50"
        r=${radius}
        pathLength="360"
        stroke-width=${width}
        stroke-linecap=${donut && o.rounded ? 'round' : 'butt'}
        style="${segStyle(arc)};stroke:${paint}"
      ></circle>
    </g>`;
  });
  // A pie's slices are parted by lines in the card's colour, so the gap is even all the way in.
  const separators =
    !donut && o.gap > 0 && drawn > 1
      ? sliceAt.map((arc) =>
          arc
            ? svg`<line class="separator" x1="50" y1="50" x2="50" y2=${50 - OUTER - 1}
                stroke-width=${o.gap} style="--a:${arc.start.toFixed(3)}deg"></line>`
            : nothing,
        )
      : nothing;
  const track =
    drawn === 0
      ? svg`<circle class="track" cx="50" cy="50" r=${radius} stroke-width=${width} fill="none"></circle>`
      : nothing;

  const percents = apportion(values);
  const rows: LegendRow[] = items.map((e, i) => ({
    index: i,
    entity: e,
    color: colors[i],
    share: o.percent && values[i] > 0 ? percentText(percents[i], ctx.hass) : undefined,
  }));

  const total = summary(items, 'total', ctx.hass, values);
  const centre =
    donut && o.center === 'total' && total ? centreText(total.text, '', o.centerLabel || sharedUnit(items)) : nothing;

  return html`<div class="parts">
    <div class="dial">
      <svg viewBox="0 0 100 100" role="img" aria-label=${partsLabel(ctx, 'editor_style_pie')}>
        ${defs}${track}${slices}${separators}
      </svg>
      ${centre}
    </div>
    ${partsLegend(rows, ctx)}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'shape', path: ['shape'], default: 'donut' },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  { name: 'center', path: ['center'], default: 'total' },
  { name: 'center_label', path: ['center_label'], default: '' },
  { name: 'gap', path: ['gap'], default: 2 },
  { name: 'shade_color', path: ['shade_color'], default: '' },
  { name: 'rounded', path: ['rounded'], default: false },
  { name: 'gradient', path: ['gradient'], default: false },
  { name: 'show_percent', path: ['show_percent'], default: true },
];

export function pieEditor(ctx: ChartEditorContext) {
  const schema = cachedSchema(`pie|${energyTotalsVariant(ctx.config)}`, ctx.hass, () => [
    ...energyTotalsSchema(ctx.hass, ctx.config),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'shape', selector: choice(ctx.hass, 'shape', SHAPES) },
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', PIE_COLOR_BY) },
        { name: 'center', selector: choice(ctx.hass, 'center', PIE_CENTER) },
        { name: 'center_label', selector: { text: {} } },
        { name: 'gap', selector: { number: { min: 0, max: 10, step: 0.5, mode: 'slider' } } },
        { name: 'shade_color', selector: { text: {} } },
      ],
    },
    { name: 'rounded', selector: { boolean: {} } },
    { name: 'gradient', selector: { boolean: {} } },
    { name: 'show_percent', selector: { boolean: {} } },
  ]);
  return chartForm(ctx, 'chart', schema, [...ENERGY_TOTALS_FIELDS, ...FIELDS]);
}

export const pie: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 200,
  styles: css`
    ${partsStyles}
    .style-pie .track {
      stroke: var(--cd-track);
    }
    .style-pie .separator {
      stroke: var(--card-background-color, #fff);
      transform: rotate(var(--a));
      transform-box: view-box;
      transform-origin: 50% 50%;
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    :host(:not([ready])) .style-pie .separator {
      opacity: 0;
    }
    :host([static]) .style-pie .separator {
      transition: none;
    }
  `,
  thumbnail: () => svg`
    <circle cx="32" cy="20" r="14" fill="none" stroke="var(--primary-color, #03a9f4)" stroke-width="6"
      pathLength="100" stroke-dasharray="44 56" transform="rotate(-90 32 20)" />
    <circle cx="32" cy="20" r="14" fill="none" stroke="var(--warning-color, #f59e0b)" stroke-width="6"
      pathLength="100" stroke-dasharray="28 72" stroke-dashoffset="-46" transform="rotate(-90 32 20)" />
    <circle cx="32" cy="20" r="14" fill="none" stroke="var(--success-color, #43a047)" stroke-width="6"
      pathLength="100" stroke-dasharray="22 78" stroke-dashoffset="-76" transform="rotate(-90 32 20)" />`,
  validate(raw: CardConfig) {
    checkChoice(raw, 'shape', SHAPES);
    checkChoice(raw, 'center', PIE_CENTER);
    checkChoice(raw, 'color_by', PIE_COLOR_BY);
    checkNumber(raw, 'gap', 0, 10);
    checkBoolean(raw, 'rounded');
    checkBoolean(raw, 'gradient');
    checkBoolean(raw, 'show_percent');
    checkText(raw, 'shade_color');
    checkText(raw, 'center_label');
  },
  editor: pieEditor,
  render,
};
