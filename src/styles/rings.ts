import { css, html, nothing, svg } from 'lit';
import {
  cachedSchema,
  centreText,
  chartForm,
  checkBoolean,
  checkChoice,
  checkNumber,
  choice,
  partColor,
  partsLabel,
  partsLegend,
  partsStyles,
  segStyle,
  summary,
} from '../chart/parts';
import type { Arc, ColorBy, LegendRow } from '../chart/parts';
import { isInteractive } from '../actions';
import type { FieldBinding } from '../editor/schemas';
import { localize } from '../localize';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';

export const RINGS_CENTER = ['average', 'total', 'none'] as const;
export const RINGS_COLOR_BY: ColorBy[] = ['series', 'bands'];

const OUTER = 48;

export interface RingLayout {
  /** Radius of each ring's centre line, outermost first. */
  radii: number[];
  width: number;
}

/**
 * Ring radii and width for `count` rings: thinner as there are more, with a third of a ring between,
 * always leaving the middle (radius 20) clear for the number.
 */
export function ringLayout(count: number): RingLayout {
  if (count <= 0) return { radii: [], width: 0 };
  const width = Math.min(9, (OUTER - 20) / (count * 1.33));
  const step = width * 1.33;
  return { radii: Array.from({ length: count }, (_, i) => OUTER - width / 2 - i * step), width };
}

/** Each ring's filled arc: its position between min and max, along the sweep. */
export function ringArc(position: number, start: number, end: number): Arc {
  const p = Math.min(1, Math.max(0, position));
  return { start, end: start + p * (end - start) };
}

/**
 * How far down (in the 100-unit box) the rings reach for a sweep, so a half dial isn't drawn in a
 * square with an empty bottom. Leaves room for the round ends and for the number in the middle.
 */
export function dialBottom(start: number, end: number): number {
  const lowest = (deg: number) => -Math.cos((deg * Math.PI) / 180);
  // The sweep passes straight down (180° + a whole turn) somewhere: the full circle is needed.
  const down = Math.ceil((start - 180) / 360) * 360 + 180;
  const reach = down <= end ? 1 : Math.max(lowest(start), lowest(end));
  return Math.min(100, Math.max(66, 50 + OUTER * reach + 6));
}

function options(raw: CardConfig) {
  return {
    start: (raw.start_angle as number | undefined) ?? 0,
    end: (raw.end_angle as number | undefined) ?? 270,
    center: (raw.center as (typeof RINGS_CENTER)[number] | undefined) ?? 'average',
    colorBy: (raw.color_by as ColorBy | undefined) ?? 'series',
    rounded: raw.rounded_ends !== false,
  };
}

function render(ctx: ChartContext) {
  const o = options(ctx.raw);
  const items = ctx.items;
  const { radii, width } = ringLayout(items.length);
  const colors = items.map((e, i) => partColor(e, i, items.length, o.colorBy));
  const cap = o.rounded ? 'round' : 'butt';
  const track = segStyle({ start: o.start, end: o.end });

  const rings = items.map((e, i) => {
    const fill = e.available
      ? svg`<circle class="seg" cx="50" cy="50" r=${radii[i]} pathLength="360" stroke-width=${width}
          stroke-linecap=${cap} style="${segStyle(ringArc(e.position, o.start, o.end))};stroke:${colors[i]}"></circle>`
      : nothing;
    return svg`<g
      class="entity ring ${isInteractive(e.config) ? 'interactive' : ''} ${e.available ? '' : 'unavailable'}"
      data-index=${i}
      aria-label=${e.label}
    >
      <circle class="ring-track" cx="50" cy="50" r=${radii[i]} pathLength="360" stroke-width=${width}
        stroke-linecap=${cap} style=${track}></circle>
      ${fill}
    </g>`;
  });

  const stat = o.center === 'none' ? undefined : summary(items, o.center, ctx.hass);
  const centre = stat ? centreText(stat.text, stat.unit, localize(ctx.hass, `parts_${o.center}`)) : nothing;

  const rows: LegendRow[] = items.map((e, i) => ({ index: i, entity: e, color: colors[i] }));
  const bottom = dialBottom(o.start, o.end);
  return html`<div class="parts">
    <div class="dial" style="aspect-ratio:100 / ${bottom.toFixed(2)}">
      <svg viewBox="0 0 100 ${bottom.toFixed(2)}" role="img" aria-label=${partsLabel(ctx, 'editor_style_rings')}>
        ${rings}
      </svg>
      <div class="centre-box" style="height:${((100 / bottom) * 100).toFixed(2)}%">${centre}</div>
    </div>
    ${partsLegend(rows, ctx)}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'start_angle', path: ['start_angle'], default: 0 },
  { name: 'end_angle', path: ['end_angle'], default: 270 },
  { name: 'center', path: ['center'], default: 'average' },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  { name: 'rounded_ends', path: ['rounded_ends'], default: true },
];

export function ringsEditor(ctx: ChartEditorContext) {
  const schema = cachedSchema('rings', ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'start_angle', selector: { number: { min: -360, max: 360, step: 5, mode: 'box' } } },
        { name: 'end_angle', selector: { number: { min: -360, max: 360, step: 5, mode: 'box' } } },
        { name: 'center', selector: choice(ctx.hass, 'center', RINGS_CENTER) },
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', RINGS_COLOR_BY) },
      ],
    },
    { name: 'rounded_ends', selector: { boolean: {} } },
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS, { start_angle: 'editor_rings_start_angle' });
}

export const rings: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 200,
  styles: css`
    ${partsStyles}
    .style-rings .centre-box {
      position: absolute;
      inset: 0 0 auto 0;
    }
    .style-rings .part-value {
      color: var(--primary-text-color);
      font-size: 1em;
      font-weight: 500;
    }
    .style-rings .ring-track {
      fill: none;
      stroke: var(--cd-track);
      stroke-dasharray: var(--len) 360;
      transform: rotate(var(--a));
      transform-box: view-box;
      transform-origin: 50px 50px;
    }
  `,
  thumbnail: () => svg`
    <circle cx="32" cy="20" r="16" fill="none" stroke="var(--divider-color, rgba(127, 127, 127, 0.3))"
      stroke-width="4" pathLength="100" stroke-dasharray="75 100" transform="rotate(-90 32 20)" stroke-linecap="round" />
    <circle cx="32" cy="20" r="16" fill="none" stroke="var(--success-color, #43a047)" stroke-width="4"
      pathLength="100" stroke-dasharray="62 100" transform="rotate(-90 32 20)" stroke-linecap="round" />
    <circle cx="32" cy="20" r="10" fill="none" stroke="var(--divider-color, rgba(127, 127, 127, 0.3))"
      stroke-width="4" pathLength="100" stroke-dasharray="75 100" transform="rotate(-90 32 20)" stroke-linecap="round" />
    <circle cx="32" cy="20" r="10" fill="none" stroke="var(--primary-color, #03a9f4)" stroke-width="4"
      pathLength="100" stroke-dasharray="48 100" transform="rotate(-90 32 20)" stroke-linecap="round" />`,
  validate(raw: CardConfig) {
    checkNumber(raw, 'start_angle', -360, 360);
    checkNumber(raw, 'end_angle', -360, 360);
    const { start, end } = options(raw);
    if (end <= start || end - start > 360) {
      throw new Error('"end_angle" must be after "start_angle", and at most 360 degrees after it');
    }
    checkChoice(raw, 'center', RINGS_CENTER);
    checkChoice(raw, 'color_by', RINGS_COLOR_BY);
    checkBoolean(raw, 'rounded_ends');
  },
  editor: ringsEditor,
  render,
};
