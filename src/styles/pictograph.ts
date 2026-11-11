import { css, html, nothing, svg } from 'lit';
import {
  cachedSchema,
  chartForm,
  checkBoolean,
  checkChoice,
  checkNumber,
  checkText,
  choice,
  partColor,
  partsLabel,
  tabFor,
} from '../chart/parts';
import type { ColorBy } from '../chart/parts';
import { isInteractive } from '../actions';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig } from '../types';

export const PICTO_COLOR_BY: ColorBy[] = ['series', 'bands'];
/** More icons than this per entity would be unreadable; the scale is stretched instead. */
export const MAX_ICONS = 100;
/** Shown for a missing entity, which has no icon of its own. */
const FALLBACK_ICON = 'mdi:checkbox-blank-circle';

export interface IconScale {
  /** How many icons make the full range. */
  count: number;
  /** What one icon stands for. */
  per: number;
}

/**
 * How many icons an entity's range takes and what each stands for: one per unit for ranges up to
 * 20 (so "7 of 10" reads as ten icons), else ten icons; at most MAX_ICONS.
 */
export function iconScale(min: number, max: number, perIcon?: number): IconScale {
  const span = max - min;
  if (!(span > 0)) return { count: 0, per: 1 };
  const per = perIcon !== undefined && perIcon > 0 ? perIcon : span <= 20 ? 1 : span / 10;
  const count = Math.ceil(span / per - 1e-9);
  return count > MAX_ICONS ? { count: MAX_ICONS, per: span / MAX_ICONS } : { count, per };
}

/** How full each icon is (0..1) for `value`; without `partial`, only whole icons fill. */
export function iconFills(value: number, min: number, scale: IconScale, partial: boolean): number[] {
  const raw = Math.min(scale.count, Math.max(0, (value - min) / scale.per));
  const filled = partial ? raw : Math.floor(raw + 1e-9);
  return Array.from({ length: scale.count }, (_, i) => Math.min(1, Math.max(0, filled - i)));
}

/** [from, to) index ranges of icons per cluster; one cluster when `size` is 0. */
export function groups(count: number, size: number): [number, number][] {
  if (count <= 0) return [];
  if (!(size > 0)) return [[0, count]];
  const out: [number, number][] = [];
  for (let from = 0; from < count; from += size) out.push([from, Math.min(count, from + size)]);
  return out;
}

function options(raw: CardConfig) {
  return {
    perIcon: raw.per_icon as number | undefined,
    unitIcon: (raw.unit_icon as string | undefined) || undefined,
    groupSize: (raw.group_size as number | undefined) ?? 5,
    partial: raw.partial !== false,
    colorBy: (raw.color_by as ColorBy | undefined) ?? 'series',
  };
}

function row(e: ResolvedEntity, index: number, ctx: ChartContext, o: ReturnType<typeof options>) {
  const { show } = ctx.config;
  const scale = iconScale(e.min, e.max, o.perIcon);
  const fills = e.available
    ? iconFills(e.value as number, e.min, scale, o.partial)
    : scale.count
      ? Array(scale.count).fill(0)
      : [];
  const color = partColor(e, index, ctx.items.length, o.colorBy);
  const icon = e.config.icon ?? o.unitIcon ?? (e.stateObj ? undefined : FALLBACK_ICON);
  const size = scale.count > 20 ? 20 : 28;
  const unit = (fill: number, i: number) => {
    return html`<span class="unit" style="--i:${i};--fill:${(fill * 100).toFixed(1)}%">
      <ha-state-icon class="unit-empty" .hass=${ctx.hass} .stateObj=${e.stateObj} .icon=${icon}></ha-state-icon>
      <span class="unit-full" style="color:${color}"
        ><ha-state-icon .hass=${ctx.hass} .stateObj=${e.stateObj} .icon=${icon}></ha-state-icon
      ></span>
    </span>`;
  };
  const value = e.available
    ? html`<span class="picto-now">${e.valueText}</span
        ><span class="picto-of"
          >/ ${withUnit(formatNumber(e.max, Number.isInteger(e.max) ? 0 : e.decimals, ctx.hass), e.unit)}</span
        >`
    : e.display;
  return html`<div
    class="entity picto-row ${isInteractive(e.config) ? 'interactive' : ''} ${e.available ? '' : 'unavailable'}"
    data-index=${index}
    tabindex=${tabFor(e)}
    aria-label=${e.label}
  >
    ${show.name ? html`<span class="name picto-name">${e.name}</span>` : nothing}
    <div class="picto-icons" style="--mdc-icon-size:${size}px" role="img" aria-label=${e.label}>
      ${groups(fills.length, o.groupSize).map(
        ([from, to]) =>
          html`<span class="picto-group">${fills.slice(from, to).map((f, j) => unit(f, from + j))}</span>`,
      )}
    </div>
    ${show.value ? html`<span class="value picto-value">${value}</span>` : nothing}
  </div>`;
}

function render(ctx: ChartContext) {
  const o = options(ctx.raw);
  return html`<div class="pictograph" role="group" aria-label=${partsLabel(ctx, 'editor_style_pictograph')}>
    ${ctx.items.map((e, i) => row(e, i, ctx, o))}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'unit_icon', path: ['unit_icon'] },
  { name: 'per_icon', path: ['per_icon'] },
  { name: 'group_size', path: ['group_size'], default: 5 },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  { name: 'partial', path: ['partial'], default: true },
];

export function pictographEditor(ctx: ChartEditorContext) {
  const schema = cachedSchema('pictograph', ctx.hass, () => [
    { name: 'unit_icon', selector: { icon: {} } },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'per_icon', selector: { number: { min: 0, step: 'any', mode: 'box' } } },
        { name: 'group_size', selector: { number: { min: 0, max: 50, mode: 'box' } } },
        { name: 'color_by', selector: choice(ctx.hass, 'color_by', PICTO_COLOR_BY) },
      ],
    },
    { name: 'partial', selector: { boolean: {} } },
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS);
}

export const pictograph: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 180,
  styles: css`
    .pictograph {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 4px 0;
    }
    .picto-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'name name' 'icons value';
      align-items: end;
      column-gap: 12px;
      row-gap: 4px;
      padding: 2px 4px;
    }
    @container (max-width: 360px) {
      .picto-row {
        grid-template-areas: 'name value' 'icons icons';
        align-items: baseline;
      }
      .picto-value {
        line-height: normal;
      }
    }
    .picto-name {
      grid-area: name;
      color: var(--secondary-text-color);
      font-size: 0.875em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .picto-icons {
      grid-area: icons;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      min-width: 0;
    }
    .picto-group {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 0;
    }
    .picto-value {
      grid-area: value;
      white-space: nowrap;
      line-height: var(--mdc-icon-size, 28px);
    }
    .picto-now {
      font-size: 1.5em;
      font-weight: 500;
    }
    .picto-of {
      margin-left: 4px;
      color: var(--secondary-text-color);
      font-size: 0.875em;
    }
    .unit {
      position: relative;
      display: inline-flex;
    }
    .unit-empty {
      color: color-mix(in srgb, var(--primary-text-color, #212121) 15%, transparent);
    }
    .unit-full {
      position: absolute;
      inset: 0;
      display: inline-flex;
      clip-path: inset(0 calc(100% - var(--fill)) 0 0);
      transition: clip-path calc(var(--cd-duration) / 2) var(--cd-easing);
      transition-delay: calc(var(--i) * 30ms);
    }
    :host(:not([ready])) .unit-full {
      clip-path: inset(0 100% 0 0);
    }
    :host([static]) .unit-full {
      transition: none;
    }
    @supports not (color: color-mix(in srgb, red 50%, white)) {
      .unit-empty {
        color: var(--divider-color, rgba(127, 127, 127, 0.3));
      }
    }
  `,
  thumbnail: () => svg`
    ${[0, 1, 2, 3, 4].map(
      (
        i,
      ) => svg`<circle cx=${10 + i * 11} cy="14" r="4" fill=${i < 3 ? 'var(--primary-color, #03a9f4)' : 'var(--divider-color, rgba(127, 127, 127, 0.3))'} />
        <path d="M${3 + i * 11} 30 a7 7 0 0 1 14 0 z" fill=${i < 3 ? 'var(--primary-color, #03a9f4)' : 'var(--divider-color, rgba(127, 127, 127, 0.3))'} />`,
    )}`,
  validate(raw: CardConfig) {
    checkText(raw, 'unit_icon');
    const per = raw.per_icon;
    if (per !== undefined && (typeof per !== 'number' || !Number.isFinite(per) || per <= 0)) {
      throw new Error('"per_icon" must be a number more than 0');
    }
    checkNumber(raw, 'group_size', 0, 50);
    if (raw.group_size !== undefined && !Number.isInteger(raw.group_size)) {
      throw new Error('"group_size" must be a whole number');
    }
    checkChoice(raw, 'color_by', PICTO_COLOR_BY);
    checkBoolean(raw, 'partial');
  },
  editor: pictographEditor,
  render,
};
