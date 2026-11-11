import { css, html, nothing, svg } from 'lit';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import { entityMark, markStyles, rangeFill, rangeSegments, targetText } from '../chart/marks';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';

export const RANGE_MODES = ['shades', 'colours'] as const;
export type RangeMode = (typeof RANGE_MODES)[number];

function bulletRow(e: ResolvedEntity, index: number, ctx: ChartContext, mode: RangeMode) {
  const { show } = ctx.config;
  const segments = rangeSegments(e);
  const sub = show.target ? targetText(e, ctx.hass) : undefined;
  const value = show.value || !e.available;
  const inner = html`
    ${
      show.name
        ? html`<div class="label">
            <span class="name">${e.name}</span>${sub ? html`<span class="sub">${sub}</span>` : nothing}
          </div>`
        : nothing
    }
    <div class="track">
      ${segments.map(
        (s) =>
          html`<div
            class="range"
            style="left:${s.from * 100}%;width:${(s.to - s.from) * 100}%;background:${rangeFill(s, segments.length, mode)}"
          ></div>`,
      )}
      ${e.available ? html`<div class="fill"></div>` : nothing}
      ${show.target && e.available && e.targetPosition !== null ? html`<div class="target"></div>` : nothing}
    </div>
    ${value ? html`<span class="value">${e.display}</span>` : html`<span></span>`}
  `;
  return entityMark(e, index, inner, 'bullet-row');
}

export const bullet: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 120,
  styles: css`
    ${markStyles}
    .style-bullet .bullets {
      display: grid;
      grid-template-columns: minmax(0, auto) minmax(96px, 1fr) fit-content(8em);
      column-gap: 12px;
    }
    .style-bullet .bullets.no-name {
      grid-template-columns: minmax(96px, 1fr) fit-content(8em);
    }
    .style-bullet .bullet-row {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: center;
      padding: 6px 0;
    }
    .style-bullet .label {
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-width: 14em;
    }
    .style-bullet .track {
      position: relative;
      height: 28px;
      border-radius: 6px;
      overflow: hidden;
      background: var(--cd-track);
    }
    .style-bullet .range {
      position: absolute;
      top: 0;
      bottom: 0;
    }
    .style-bullet .fill {
      position: absolute;
      top: 30%;
      bottom: 30%;
      left: calc(var(--start) * 100%);
      width: calc((var(--end) - var(--start)) * 100%);
      border-radius: 4px;
      background: var(--c-start);
      background-image: linear-gradient(90deg, var(--c-start), color-mix(in srgb, var(--c-start) 80%, #fff));
      transition:
        left var(--cd-duration) var(--cd-easing),
        width var(--cd-duration) var(--cd-easing);
    }
    .style-bullet .target {
      position: absolute;
      top: 3px;
      bottom: 3px;
      width: 3px;
      border-radius: 2px;
      left: calc(var(--target) * (100% - 3px));
      background: var(--primary-text-color);
      transition: left var(--cd-duration) var(--cd-easing);
    }
    .style-bullet .value {
      text-align: right;
      min-width: calc(var(--cd-value-ch, 4) * 0.62em);
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="8" width="56" height="10" rx="2" fill="var(--primary-text-color, #212121)" opacity="0.08" />
    <rect x="4" y="8" width="30" height="10" rx="2" fill="var(--primary-text-color, #212121)" opacity="0.12" />
    <rect x="4" y="11" width="38" height="4" rx="2" fill="var(--primary-color, #03a9f4)" />
    <rect x="46" y="6" width="2" height="14" rx="1" fill="var(--primary-text-color, #212121)" />
    <rect x="4" y="24" width="56" height="10" rx="2" fill="var(--primary-text-color, #212121)" opacity="0.08" />
    <rect x="4" y="24" width="24" height="10" rx="2" fill="var(--primary-text-color, #212121)" opacity="0.12" />
    <rect x="4" y="27" width="48" height="4" rx="2" fill="var(--warning-color, #f59e0b)" />
    <rect x="40" y="22" width="2" height="14" rx="1" fill="var(--primary-text-color, #212121)" />`,
  validate(raw: CardConfig) {
    if (raw.ranges !== undefined && !RANGE_MODES.includes(raw.ranges as RangeMode)) {
      throw new Error(`"ranges" must be one of: ${RANGE_MODES.join(', ')}`);
    }
  },
  editor(ctx: ChartEditorContext) {
    const schema = cachedSchema('bullet', ctx.hass, () => [
      { name: 'ranges', selector: choice(ctx.hass, 'ranges', RANGE_MODES) },
    ]);
    return chartForm(ctx, 'chart', schema, [{ name: 'ranges', path: ['ranges'], default: 'shades' }]);
  },
  render(ctx) {
    const mode = (ctx.raw.ranges as RangeMode | undefined) ?? 'shades';
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_bullet'),
      names: ctx.items.map((e) => e.name).join(', '),
    });
    return html`<div class="compare bullets ${ctx.config.show.name ? '' : 'no-name'}" role="group" aria-label=${label}>
      ${ctx.items.map((e, i) => bulletRow(e, i, ctx, mode))}
    </div>`;
  },
};
