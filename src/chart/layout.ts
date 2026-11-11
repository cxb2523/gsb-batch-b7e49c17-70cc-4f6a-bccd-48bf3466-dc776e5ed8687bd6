import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { CardConfig } from '../types';
import { validateLegendToggle } from './legend-toggle';

/** Where a history chart puts its row of names and current values. */
export const HEADER_PLACES = ['above', 'over', 'hidden'] as const;
export type HeaderPlace = (typeof HEADER_PLACES)[number];

export interface ChartLayout {
  /** Tighter spacing and a shorter plot, for crowded dashboards. */
  compact: boolean;
  header: HeaderPlace;
}

export function validateLayout(raw: CardConfig): void {
  if (raw.compact !== undefined && typeof raw.compact !== 'boolean') throw new Error('"compact" must be true or false');
  if (raw.header !== undefined && !HEADER_PLACES.includes(raw.header as HeaderPlace)) {
    throw new Error(`"header" must be one of: ${HEADER_PLACES.join(', ')}`);
  }
  validateLegendToggle(raw);
}

export function chartLayout(raw: CardConfig): ChartLayout {
  return { compact: raw.compact === true, header: (raw.header as HeaderPlace | undefined) ?? 'above' };
}

/**
 * The chart's outer box. Its classes switch the compact spacing and header placement; while
 * there is only a message (loading, error, no data) a header "over" the chart sits above it.
 */
export function chartFrame(layout: ChartLayout, header: TemplateResult | typeof nothing, body: TemplateResult) {
  return html`<div class="frame ${layout.compact ? 'compact' : ''}">
    ${layout.header === 'above' ? header : nothing}${body}
  </div>`;
}

/**
 * A header laid over the plot's top-left corner. Pointer presses on it stop here, so tapping a
 * series to open it doesn't also move the tooltip underneath.
 */
export function headerOver(header: TemplateResult | typeof nothing) {
  if (header === nothing) return nothing;
  return html`<div class="header-over" @pointerdown=${(ev: Event) => ev.stopPropagation()}>${header}</div>`;
}

export const layoutStyles = css`
  .header-over {
    position: absolute;
    top: 2px;
    left: 4px;
    max-width: calc(100% - 8px);
    z-index: 2;
    padding: 0 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--card-background-color, #fff) 75%, transparent);
  }
  /* While reading values, the tooltip takes the top corner: step the header out of its way. */
  .header-over {
    transition: opacity 0.15s ease;
  }
  .header-over:has(~ .hover-layer) {
    opacity: 0;
  }
  /* Labels over the plot: the top value label would sit under the header. */
  .plot-area:has(> .header-over) > .y-axis .axis-label.top {
    visibility: hidden;
  }
  .header-over .series-header {
    padding: 2px 0;
  }
  .header-over .series-value {
    font-size: 1.25em;
  }
  /* Compact: less padding round the card, a tighter header and a shorter plot. */
  .content:has(> .chart > .frame.compact) {
    padding: 4px 10px;
  }
  .frame.compact .series-header {
    gap: 2px 10px;
    padding: 0 0 2px;
    font-size: 0.9em;
  }
  .frame.compact .header-over .series-header {
    padding: 0;
  }
  .frame.compact .plot-wrap,
  .frame.compact .chart-message {
    height: 110px;
  }
  .frame.compact .axis-label {
    font-size: 10px;
  }
  .frame.compact .axes-outside .x-axis {
    height: 14px;
  }
  .frame.compact .axes-outside .x-axis .axis-label {
    top: 3px;
  }
`;
