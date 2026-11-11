import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { formatNumber, withUnit } from '../format';
import { isInteractive } from '../actions';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import { position } from '../scale';
import type { HomeAssistant } from '../types';

/** One qualitative range behind a bullet bar, in track fractions (0..1). */
export interface RangeSegment {
  from: number;
  to: number;
  color: string;
  /** 0 for the lowest band, counting up. */
  level: number;
}

/**
 * The entity's colour bands cut to its min..max, as track fractions. Bands wholly outside the
 * limits are left out; the first visible one starts at the track's left edge.
 */
export function rangeSegments(e: Pick<ResolvedEntity, 'bands' | 'min' | 'max'>): RangeSegment[] {
  const out: RangeSegment[] = [];
  e.bands.forEach((band, i) => {
    const next = e.bands[i + 1];
    const from = Number.isFinite(band.from) ? position(band.from, e.min, e.max) : 0;
    const to = next ? position(next.from, e.min, e.max) : 1;
    if (to <= from) return;
    out.push({ from: out.length ? from : 0, to, color: band.color, level: 0 });
  });
  out.forEach((s, i) => (s.level = i));
  return out;
}

/**
 * The background of one range: a grey tint that deepens band by band ('shades'), or the band's
 * own colour, faint ('colours').
 */
export function rangeFill(segment: RangeSegment, count: number, mode: 'shades' | 'colours'): string {
  if (mode === 'colours') return `color-mix(in srgb, ${baseColor(segment.color)} 22%, transparent)`;
  const strength = count <= 1 ? 8 : 6 + Math.round((segment.level / (count - 1)) * 12);
  return `color-mix(in srgb, var(--primary-text-color, #212121) ${strength}%, transparent)`;
}

/** The drawing variables every entity's mark reads; the card forces them to 0 until it is ready. */
export function markVars(e: ResolvedEntity): string {
  const color = baseColor(e.band.color);
  return (
    `--start:${e.span[0]};--end:${e.span[1]};--pos:${e.position};` +
    `--target:${e.targetPosition ?? 0};--c-start:${color}`
  );
}

/** "target 18 kWh", or nothing when the entity has no target. */
export function targetText(e: ResolvedEntity, hass: HomeAssistant): string | undefined {
  if (e.target === null) return undefined;
  return localize(hass, 'compare_target', { target: withUnit(formatNumber(e.target, e.decimals, hass), e.unit) });
}

/**
 * The element for one entity: `.entity` with its `data-index`, a meter role and the drawing
 * variables, so tap, hold and double-tap actions and screen readers work as in the value styles.
 */
export function entityMark(e: ResolvedEntity, index: number, inner: TemplateResult, extra = ''): TemplateResult {
  const interactive = isInteractive(e.config);
  return html`<div
    class="entity ${extra} ${interactive ? 'interactive' : ''} ${e.available ? '' : 'unavailable'}"
    data-index=${index}
    role="meter"
    aria-valuenow=${e.available ? String(e.value) : nothing}
    aria-valuemin=${e.min}
    aria-valuemax=${e.max}
    aria-label=${e.label}
    tabindex=${interactive ? 0 : nothing}
    style=${markVars(e)}
  >
    ${inner}
  </div>`;
}

/** Look shared by the bullet and lollipop charts. */
export const markStyles = css`
  .compare .entity.interactive {
    cursor: pointer;
  }
  .compare .entity:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .compare .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .compare .value {
    font-weight: 500;
    white-space: nowrap;
  }
  .compare .entity.unavailable .value {
    color: var(--secondary-text-color);
    font-weight: 400;
    font-size: 0.875em;
    white-space: normal;
  }
  .compare .sub {
    color: var(--secondary-text-color);
    font-size: 0.8em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
