import { css, html, nothing, svg } from 'lit';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import { entityMark, markStyles } from '../chart/marks';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';

export const ORIENTATIONS = ['vertical', 'horizontal'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** The stem, dot and target ring, placed by the entity's drawing variables. */
function stick(e: ResolvedEntity, ctx: ChartContext, withValue: boolean) {
  const { show } = ctx.config;
  return html`<div class="lane">
    <div class="scale">
      ${
        e.available
          ? html`<div class="stem"></div>
              ${show.target && e.targetPosition !== null ? html`<div class="target"></div>` : nothing}
              <div class="dot"></div>
              ${withValue && show.value ? html`<span class="value tip">${e.display}</span>` : nothing}`
          : withValue
            ? html`<span class="value tip">${e.display}</span>`
            : nothing
      }
    </div>
  </div>`;
}

function verticalItem(e: ResolvedEntity, index: number, ctx: ChartContext) {
  const { show } = ctx.config;
  const inner = html`${stick(e, ctx, true)} ${show.name ? html`<span class="name">${e.name}</span>` : nothing}`;
  return entityMark(e, index, inner, 'pop');
}

function horizontalItem(e: ResolvedEntity, index: number, ctx: ChartContext) {
  const { show } = ctx.config;
  const value = show.value || !e.available;
  const inner = html`${show.name ? html`<span class="name">${e.name}</span>` : nothing} ${stick(e, ctx, false)}
  ${value ? html`<span class="value">${e.display}</span>` : html`<span></span>`}`;
  return entityMark(e, index, inner, 'pop');
}

export const lollipop: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 200,
  styles: css`
    ${markStyles}
    .style-lollipop .lane {
      position: relative;
    }
    .style-lollipop .scale {
      position: absolute;
    }
    .style-lollipop .stem {
      position: absolute;
      background: var(--c-start);
      border-radius: 2px;
    }
    .style-lollipop .dot {
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--c-start);
      background-image: radial-gradient(
        circle at 35% 30%,
        color-mix(in srgb, var(--c-start) 70%, #fff),
        var(--c-start)
      );
    }
    .style-lollipop .target {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 2px solid var(--primary-text-color);
      background: var(--card-background-color, #fff);
      box-sizing: content-box;
    }

    /* Upright: one column per entity over a shared baseline. */
    .style-lollipop .vertical {
      display: flex;
      align-items: stretch;
    }
    .style-lollipop .vertical .pop {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .style-lollipop .vertical .lane {
      align-self: stretch;
      height: 150px;
      border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .style-lollipop .vertical .scale {
      left: 50%;
      top: 26px;
      bottom: 0;
    }
    .style-lollipop .vertical .stem {
      left: -1.5px;
      width: 3px;
      bottom: calc(var(--start) * 100%);
      height: calc((var(--end) - var(--start)) * 100%);
      transition:
        bottom var(--cd-duration) var(--cd-easing),
        height var(--cd-duration) var(--cd-easing);
    }
    .style-lollipop .vertical .dot {
      left: -7px;
      bottom: calc(var(--pos) * 100% - 7px);
      transition: bottom var(--cd-duration) var(--cd-easing);
    }
    .style-lollipop .vertical .target {
      left: -6px;
      bottom: calc(var(--target) * 100% - 6px);
    }
    .style-lollipop .vertical .tip {
      position: absolute;
      left: 0;
      bottom: calc(var(--pos) * 100% + 10px);
      transform: translateX(-50%);
      font-size: 0.875em;
      line-height: 1.2;
      padding: 0 3px;
      border-radius: 3px;
      background: var(--card-background-color, #fff);
      z-index: 1;
      transition: bottom var(--cd-duration) var(--cd-easing);
    }
    .style-lollipop .vertical .name {
      max-width: 100%;
      color: var(--secondary-text-color);
      font-size: 0.875em;
      padding: 0 2px;
    }
    .style-lollipop .vertical .entity.unavailable .value {
      font-size: 0.75em;
      white-space: nowrap;
    }

    /* Across: one row per entity, stems growing to the right. */
    .style-lollipop .horizontal {
      display: grid;
      grid-template-columns: minmax(0, auto) minmax(96px, 1fr) fit-content(8em);
      column-gap: 12px;
    }
    .style-lollipop .horizontal.no-name {
      grid-template-columns: minmax(96px, 1fr) fit-content(8em);
    }
    .style-lollipop .horizontal .pop {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: center;
      padding: 6px 0;
    }
    .style-lollipop .horizontal .name {
      max-width: 14em;
    }
    .style-lollipop .horizontal .lane {
      height: 20px;
      border-left: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .style-lollipop .horizontal .scale {
      top: 50%;
      left: 0;
      right: 7px;
    }
    .style-lollipop .horizontal .stem {
      top: -1.5px;
      height: 3px;
      left: calc(var(--start) * 100%);
      width: calc((var(--end) - var(--start)) * 100%);
      transition:
        left var(--cd-duration) var(--cd-easing),
        width var(--cd-duration) var(--cd-easing);
    }
    .style-lollipop .horizontal .dot {
      top: -7px;
      left: calc(var(--pos) * 100% - 7px);
      transition: left var(--cd-duration) var(--cd-easing);
    }
    .style-lollipop .horizontal .target {
      top: -6px;
      left: calc(var(--target) * 100% - 6px);
    }
    .style-lollipop .horizontal .value {
      text-align: right;
    }
  `,
  thumbnail: () => svg`
    <line x1="4" y1="36" x2="60" y2="36" stroke="var(--divider-color, #ccc)" stroke-width="1" />
    <line x1="14" y1="36" x2="14" y2="14" stroke="var(--success-color, #1fae7a)" stroke-width="2.5" />
    <circle cx="14" cy="14" r="5" fill="var(--success-color, #1fae7a)" />
    <line x1="32" y1="36" x2="32" y2="22" stroke="var(--success-color, #1fae7a)" stroke-width="2.5" />
    <circle cx="32" cy="22" r="5" fill="var(--success-color, #1fae7a)" />
    <line x1="50" y1="36" x2="50" y2="8" stroke="var(--success-color, #1fae7a)" stroke-width="2.5" />
    <circle cx="50" cy="8" r="5" fill="var(--success-color, #1fae7a)" />`,
  validate(raw: CardConfig) {
    if (raw.orientation !== undefined && !ORIENTATIONS.includes(raw.orientation as Orientation)) {
      throw new Error(`"orientation" must be one of: ${ORIENTATIONS.join(', ')}`);
    }
  },
  editor(ctx: ChartEditorContext) {
    const schema = cachedSchema('lollipop', ctx.hass, () => [
      { name: 'orientation', selector: choice(ctx.hass, 'orientation', ORIENTATIONS) },
    ]);
    return chartForm(ctx, 'chart', schema, [{ name: 'orientation', path: ['orientation'], default: 'vertical' }]);
  },
  render(ctx) {
    const orientation = (ctx.raw.orientation as Orientation | undefined) ?? 'vertical';
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_lollipop'),
      names: ctx.items.map((e) => e.name).join(', '),
    });
    const item = orientation === 'vertical' ? verticalItem : horizontalItem;
    return html`<div
      class="compare ${orientation} ${ctx.config.show.name ? '' : 'no-name'}"
      role="group"
      aria-label=${label}
    >
      ${ctx.items.map((e, i) => item(e, i, ctx))}
    </div>`;
  },
};
