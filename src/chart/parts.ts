import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { isInteractive } from '../actions';
import { baseColor } from '../bands';
import { SERIES_COLORS } from './frame';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';

/*
 * Shared pieces for the "parts of a total" charts (pie and donut, rings, pictograph, waffle):
 * the share maths, part colours, the legend beside the drawing, option checks and the Chart
 * section's form. They all draw from the entities' current values, so no history is involved.
 */

/** Colours in order, for entities without their own `color` (the same order as the history charts). */
export { SERIES_COLORS };

export type ColorBy = 'series' | 'bands' | 'shades';

/** Each entity's size as a part: its value when it's a positive number, else 0 (not drawn). */
export function partValues(items: ResolvedEntity[]): number[] {
  return items.map((e) => (e.available && (e.value as number) > 0 ? (e.value as number) : 0));
}

/** Each value as a fraction of their sum; all 0 when there's nothing to share. */
export function shares(values: number[]): number[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  return values.map((v) => (total > 0 ? Math.max(0, v) / total : 0));
}

/**
 * Whole numbers in proportion to `weights` that add up to exactly `total` (largest remainder):
 * percentages that sum to 100, or squares of a 10 × 10 waffle.
 */
export function apportion(weights: number[], total = 100): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) / sum) * total);
  const whole = exact.map(Math.floor);
  let left = total - whole.reduce((a, n) => a + n, 0);
  const order = exact.map((x, i) => ({ i, rest: x - whole[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    whole[i] += 1;
    left -= 1;
  }
  return whole;
}

/** An angle range in degrees, clockwise from 12 o'clock. */
export interface Arc {
  start: number;
  end: number;
}

/** Consecutive arcs, one per share, laid end to end from `from` to `to` degrees. */
export function arcs(fractions: number[], from = 0, to = 360): Arc[] {
  const span = to - from;
  let at = from;
  return fractions.map((f) => {
    const start = at;
    at += f * span;
    return { start, end: at };
  });
}

/** An arc made shorter by `deg` in all (half off each end), for gaps or round caps; never negative. */
export function shrink(arc: Arc, deg: number): Arc {
  const length = arc.end - arc.start;
  const cut = Math.min(Math.max(0, deg), length) / 2;
  return { start: arc.start + cut, end: arc.end - cut };
}

/** Degrees of a circle of radius `r` that a straight length `len` covers. */
export function degreesFor(len: number, r: number): number {
  return r > 0 ? (len / r) * (180 / Math.PI) : 0;
}

/**
 * Style for a `.seg` circle (pathLength 360) that draws `arc`: a dash as long as the arc, turned to
 * its start. Both are CSS properties, so a changed value animates to its new place.
 */
export function segStyle(arc: Arc): string {
  const length = Math.max(0, arc.end - arc.start);
  return `--a:${(arc.start - 90).toFixed(3)}deg;--len:${length.toFixed(3)}`;
}

/** A colour `index` steps lighter than `color` (towards the card background), across `count` parts. */
export function shade(color: string, index: number, count: number): string {
  if (count <= 1 || index <= 0) return color;
  const strength = Math.round(100 - (Math.min(index, count - 1) / (count - 1)) * 65);
  return `color-mix(in srgb, ${color} ${strength}%, var(--card-background-color, #fff))`;
}

/** An entity's own `color` (set per series), if any. */
function ownColor(e: ResolvedEntity): string | undefined {
  const own = (e.config as { color?: unknown }).color;
  return typeof own === 'string' && own.trim() !== '' ? own : undefined;
}

/** The colour of the part drawn for item `index` of `count`. */
export function partColor(
  e: ResolvedEntity,
  index: number,
  count: number,
  colorBy: ColorBy,
  shadeColor = 'primary',
): string {
  if (colorBy === 'bands') return baseColor(e.band.color);
  if (colorBy === 'shades') return shade(baseColor(shadeColor), index, count);
  return baseColor(ownColor(e) ?? SERIES_COLORS[index % SERIES_COLORS.length]);
}

/** The unit every available item shares, or '' when they differ. */
export function sharedUnit(items: ResolvedEntity[]): string {
  const units = new Set(items.filter((e) => e.available).map((e) => e.unit));
  return units.size === 1 ? [...units][0] : '';
}

/** Sum or mean of the available values, formatted with the most decimals any of them uses. */
export function summary(
  items: ResolvedEntity[],
  kind: 'total' | 'average',
  hass: HomeAssistant | undefined,
  values = items.map((e) => (e.available ? (e.value as number) : 0)),
): { value: number; text: string; unit: string } | undefined {
  const counted = items.map((e, i) => ({ e, v: values[i] })).filter(({ e }) => e.available);
  if (!counted.length) return undefined;
  const sum = counted.reduce((a, { v }) => a + v, 0);
  const value = kind === 'total' ? sum : sum / counted.length;
  const decimals = Math.max(...counted.map(({ e }) => e.decimals));
  return { value, text: formatNumber(value, decimals, hass), unit: sharedUnit(items) };
}

/** tabindex for an entity's legend row or tile: focusable only when an action is set. */
export function tabFor(e: ResolvedEntity): number | typeof nothing {
  return isInteractive(e.config) ? 0 : nothing;
}

/** One row of the legend beside the drawing. */
export interface LegendRow {
  index: number;
  entity: ResolvedEntity;
  color: string;
  /** e.g. "40 %"; left out when unset. */
  share?: string;
}

/** The legend: a tappable row per entity with its colour, name, value and share. */
export function partsLegend(rows: LegendRow[], ctx: ChartContext): TemplateResult | typeof nothing {
  const { show } = ctx.config;
  if (!rows.length || (!show.name && !show.value && rows.every((r) => r.share === undefined))) return nothing;
  return html`<div class="parts-legend">
    ${rows.map(
      (r) =>
        html`<div
          class="entity part-row ${isInteractive(r.entity.config) ? 'interactive' : ''} ${
            r.entity.available ? '' : 'unavailable'
          }"
          data-index=${r.index}
          tabindex=${tabFor(r.entity)}
          aria-label=${r.share === undefined ? r.entity.label : `${r.entity.label}, ${r.share}`}
        >
          <span class="swatch ${r.entity.available ? '' : 'empty'}" style="background:${r.color}"></span>
          ${show.name ? html`<span class="part-name">${r.entity.name}</span>` : nothing}
          ${show.value ? html`<span class="part-value value">${r.entity.display}</span>` : nothing}
          ${r.share === undefined ? nothing : html`<span class="part-share">${r.share}</span>`}
        </div>`,
    )}
  </div>`;
}

/** "40 %" in the user's number format. */
export function percentText(n: number, hass: HomeAssistant | undefined): string {
  return withUnit(formatNumber(n, 0, hass), '%');
}

/** The drawing's accessible name: "<style> of <names>". */
export function partsLabel(ctx: ChartContext, styleKey: string): string {
  return localize(ctx.hass, 'parts_aria', {
    style: localize(ctx.hass, styleKey),
    names: ctx.items.map((e) => e.name).join(', '),
  });
}

/** Big number and a small line under it, drawn over the middle of a dial. */
export function centreText(value: string, unit: string, caption: string): TemplateResult {
  return html`<div class="centre" aria-hidden="true">
    <div class="centre-value">${value}${unit ? html`<span class="centre-unit">${unit}</span>` : nothing}</div>
    ${caption ? html`<div class="centre-caption">${caption}</div>` : nothing}
  </div>`;
}

/* Option checks, with the errors Home Assistant shows under the card. */

export function checkChoice(raw: CardConfig, key: string, values: readonly string[]): void {
  const v = raw[key];
  if (v !== undefined && !values.includes(v as string)) {
    throw new Error(`"${key}" must be one of: ${values.join(', ')}`);
  }
}

export function checkNumber(raw: CardConfig, key: string, min: number, max: number): void {
  const v = raw[key];
  if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) {
    throw new Error(`"${key}" must be a number from ${min} to ${max}`);
  }
}

export function checkBoolean(raw: CardConfig, key: string): void {
  const v = raw[key];
  if (v !== undefined && typeof v !== 'boolean') throw new Error(`"${key}" must be true or false`);
}

export function checkText(raw: CardConfig, key: string): void {
  const v = raw[key];
  if (v !== undefined && typeof v !== 'string') throw new Error(`"${key}" must be text`);
}

/* The Chart section's form uses the shared editor helpers. */
export { cachedSchema, chartForm, choice } from '../editor/chart-editors';

/**
 * Shared look: the drawing beside its legend on a wide card, above it on a narrow one; `.seg`
 * circles that draw an arc as a dash (see segStyle) and grow in from empty once the card is ready.
 */
export const partsStyles = css`
  .parts {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
  }
  @container (min-width: 400px) {
    .parts {
      flex-direction: row;
      align-items: center;
      gap: 24px;
    }
    .parts > .parts-legend {
      flex: 1;
    }
  }
  .dial {
    position: relative;
    flex: none;
    width: 180px;
    max-width: 100%;
    aspect-ratio: 1;
  }
  .dial svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .seg {
    fill: none;
    stroke-dasharray: var(--len) 360;
    transform: rotate(var(--a));
    transform-box: view-box;
    transform-origin: 50px 50px;
    transition:
      stroke-dasharray var(--cd-duration) var(--cd-easing),
      transform var(--cd-duration) var(--cd-easing),
      stroke var(--cd-duration) var(--cd-easing);
  }
  :host(:not([ready])) .seg {
    stroke-dasharray: 0 360;
  }
  :host([static]) .seg {
    transition: none;
  }
  /* Parts inside a drawing take taps; the keyboard reaches each entity through its legend row. */
  .dial .entity.interactive {
    cursor: pointer;
  }
  .centre {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    text-align: center;
  }
  .centre-value {
    font-size: 28px;
    font-weight: 500;
    line-height: 1.1;
    color: var(--primary-text-color);
  }
  .centre-unit {
    font-size: 14px;
    margin-left: 3px;
    color: var(--secondary-text-color);
  }
  .centre-caption {
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  .parts-legend {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }
  .part-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    min-width: 0;
    border-radius: 4px;
  }
  .part-row + .part-row {
    border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
    border-radius: 0;
  }
  .part-row .swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .part-row .swatch.empty {
    background: none !important;
    box-shadow: inset 0 0 0 1.5px var(--secondary-text-color);
  }
  .part-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .part-value {
    color: var(--secondary-text-color);
    font-size: 0.875em;
    white-space: nowrap;
  }
  .part-share {
    min-width: 3.2em;
    text-align: right;
    font-weight: 500;
    white-space: nowrap;
  }
`;
