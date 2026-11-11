import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult } from 'lit';
import {
  apportion,
  cachedSchema,
  chartForm,
  checkBoolean,
  checkChoice,
  choice,
  partColor,
  partValues,
  partsLabel,
  partsLegend,
  partsStyles,
  percentText,
  tabFor,
} from '../chart/parts';
import type { ColorBy, LegendRow } from '../chart/parts';
import { isInteractive } from '../actions';
import type { FieldBinding } from '../editor/schemas';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';

export const WAFFLES = ['one', 'each'] as const;
export const WAFFLE_COLOR_BY: ColorBy[] = ['series', 'bands'];
const CELLS = 100;

/** Grid position of square `k` (0..99): filled from the bottom row up, left to right. */
export function cellAt(k: number): { col: number; row: number } {
  return { col: k % 10, row: 9 - Math.floor(k / 10) };
}

/**
 * Squares each entity gets in a shared waffle. One entity fills its position between min and max;
 * several split the 100 squares by their share of the total.
 */
export function waffleCounts(items: ResolvedEntity[]): number[] {
  if (items.length === 1) {
    const e = items[0];
    return e.available ? [apportion([e.position, 1 - e.position])[0]] : [0];
  }
  return apportion(partValues(items), CELLS);
}

function square(k: number, color: string | undefined): SVGTemplateResult {
  const { col, row } = cellAt(k);
  return svg`<rect
    class="cell ${color ? 'filled' : ''}"
    x=${col * 10 + 0.8}
    y=${row * 10 + 0.8}
    width="8.4"
    height="8.4"
    rx="1.6"
    style="--k:${k}${color ? `;fill:${color}` : ''}"
  ></rect>`;
}

/** The 10 × 10 grid: each entity's squares in its own tappable group, then the empty ones. */
function grid(counts: number[], colors: string[], items: ResolvedEntity[], label: string) {
  let at = 0;
  const groups = counts.map((n, i) => {
    const from = at;
    at += n;
    if (!n) return nothing;
    const e = items[i];
    return svg`<g class="entity ${isInteractive(e.config) ? 'interactive' : ''}" data-index=${i}>
      ${Array.from({ length: n }, (_, j) => square(from + j, colors[i]))}
    </g>`;
  });
  const empty = Array.from({ length: CELLS - at }, (_, j) => square(at + j, undefined));
  return html`<svg class="waffle" viewBox="0 0 100 100" role="img" aria-label=${label}>
    ${groups}
    <g class="empty">${empty}</g>
  </svg>`;
}

function options(raw: CardConfig) {
  return {
    waffles: (raw.waffles as (typeof WAFFLES)[number] | undefined) ?? 'one',
    colorBy: (raw.color_by as ColorBy | undefined) ?? 'series',
    headline: raw.headline !== false,
    percent: raw.show_percent !== false,
  };
}

function one(ctx: ChartContext, o: ReturnType<typeof options>) {
  const items = ctx.items;
  const colors = items.map((e, i) => partColor(e, i, items.length, o.colorBy));
  const counts = waffleCounts(items);
  const drawn = (i: number) => counts[i] > 0 || (items.length === 1 && items[i].available);
  const rows: LegendRow[] = items.map((e, i) => ({
    index: i,
    entity: e,
    color: colors[i],
    // A lone entity's share is the headline already.
    share: o.percent && drawn(i) && !(o.headline && items.length === 1) ? percentText(counts[i], ctx.hass) : undefined,
  }));
  const lead = items[0];
  const headline =
    o.headline && lead && drawn(0)
      ? html`<div class="waffle-headline">
          <span class="waffle-big">${percentText(counts[0], ctx.hass)}</span>
          <span class="waffle-caption">${lead.name}</span>
        </div>`
      : nothing;
  return html`<div class="parts">
    <div class="waffle-box">${grid(counts, colors, items, partsLabel(ctx, 'editor_style_waffle'))}</div>
    <div class="waffle-side">${headline}${partsLegend(rows, ctx)}</div>
  </div>`;
}

function each(ctx: ChartContext, o: ReturnType<typeof options>) {
  const { show } = ctx.config;
  return html`<div class="waffles">
    ${ctx.items.map((e, i) => {
      const color = partColor(e, i, ctx.items.length, o.colorBy);
      const [count] = waffleCounts([e]);
      const pct = percentText(count, ctx.hass);
      // The value under the percentage, unless it says the same thing (a 0-100 % sensor).
      const raw = show.value && o.percent && e.available && e.display !== pct;
      return html`<div
        class="entity waffle-item ${isInteractive(e.config) ? 'interactive' : ''} ${e.available ? '' : 'unavailable'}"
        data-index=${i}
        tabindex=${tabFor(e)}
      >
        ${grid([count], [color], [e], e.label)}
        ${show.name ? html`<span class="waffle-name">${e.name}</span>` : nothing}
        <span class="value waffle-value">${e.available && o.percent ? pct : e.display}</span>
        ${raw ? html`<span class="waffle-raw">${e.display}</span>` : nothing}
      </div>`;
    })}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'waffles', path: ['waffles'], default: 'one' },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  { name: 'headline', path: ['headline'], default: true },
  { name: 'show_percent', path: ['show_percent'], default: true },
];

export function waffleEditor(ctx: ChartEditorContext) {
  const schema = cachedSchema('waffle', ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'waffles', selector: choice(ctx.hass, 'waffles', WAFFLES) },
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', WAFFLE_COLOR_BY) },
      ],
    },
    { name: 'headline', selector: { boolean: {} } },
    { name: 'show_percent', selector: { boolean: {} } },
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS);
}

export const waffle: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 210,
  styles: css`
    ${partsStyles}
    .waffle-box {
      flex: none;
      width: 180px;
      max-width: 100%;
    }
    .waffle {
      display: block;
      width: 100%;
      height: auto;
    }
    .cell {
      fill: color-mix(in srgb, var(--primary-text-color, #212121) 10%, transparent);
      transform-box: fill-box;
      transform-origin: center;
      transition:
        opacity calc(var(--cd-duration) / 2) var(--cd-easing),
        transform calc(var(--cd-duration) / 2) var(--cd-easing),
        fill var(--cd-duration) var(--cd-easing);
      transition-delay: calc(var(--k) * 4ms);
    }
    :host(:not([ready])) .cell.filled {
      opacity: 0;
      transform: scale(0.4);
    }
    :host([static]) .cell {
      transition: none;
    }
    @supports not (color: color-mix(in srgb, red 50%, white)) {
      .cell {
        fill: var(--divider-color, rgba(127, 127, 127, 0.2));
      }
    }
    .waffle .entity.interactive {
      cursor: pointer;
    }
    .waffle-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      min-width: 0;
    }
    .waffle-headline {
      display: flex;
      flex-direction: column;
      padding: 0 4px;
    }
    .waffle-big {
      font-size: 32px;
      font-weight: 500;
      line-height: 1.1;
    }
    .waffle-caption {
      color: var(--secondary-text-color);
    }
    .waffles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: 12px 16px;
      padding: 4px 0;
    }
    .waffle-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      min-width: 0;
    }
    .waffle-item .waffle {
      margin-bottom: 4px;
    }
    .waffle-name {
      color: var(--secondary-text-color);
      font-size: 0.875em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .waffle-value {
      font-weight: 500;
    }
    .waffle-raw {
      color: var(--secondary-text-color);
      font-size: 0.75em;
    }
  `,
  thumbnail: () => svg`
    ${Array.from({ length: 25 }, (_, k) => {
      const col = k % 5;
      const row = 4 - Math.floor(k / 5);
      const color =
        k < 9
          ? 'var(--warning-color, #f59e0b)'
          : k < 15
            ? 'var(--primary-color, #03a9f4)'
            : 'var(--divider-color, rgba(127, 127, 127, 0.3))';
      return svg`<rect x=${20 + col * 5} y=${8 + row * 5} width="4" height="4" rx="0.8" fill=${color} />`;
    })}`,
  validate(raw: CardConfig) {
    checkChoice(raw, 'waffles', WAFFLES);
    checkChoice(raw, 'color_by', WAFFLE_COLOR_BY);
    checkBoolean(raw, 'headline');
    checkBoolean(raw, 'show_percent');
  },
  editor: waffleEditor,
  render(ctx) {
    const o = options(ctx.raw);
    return o.waffles === 'each' ? each(ctx, o) : one(ctx, o);
  },
};
