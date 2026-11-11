import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { conditionOf, flips, heldSpans, sameCondition, stripOn } from '../history/condition';
import type { Condition } from '../history/condition';
import type { Range } from '../history/types';
import { formatNumber } from '../format';
import { localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { HomeAssistant } from '../types';
import { downsample } from './downsample';
import { VIEW_W } from './frame';
import type { ChartSeries, HistoryFrame } from './frame';
import type { PlotScales } from './grid';
import { runPath, runs } from './paths';

/** Points kept per faint line after thinning, as for the line itself. */
const MAX_POINTS = 500;
/** One strip row's height and the space between rows and above them, px (keep in step with the CSS). */
const ROW_H = 12;
const ROW_GAP = 3;
const STRIP_TOP = 6;

/**
 * The faint line of every reading behind each conditional series (`ChartSeries.hidden`), so
 * what the condition hides still shows as a trace. Series without a condition draw nothing.
 */
export function ghostLines(series: readonly ChartSeries[], scales: PlotScales): SVGTemplateResult | typeof nothing {
  const paths = series
    .filter((s) => s.hidden && s.hidden.length > 0)
    .map((s) => {
      const d = runs(downsample(s.hidden!, MAX_POINTS))
        .map((run) =>
          runPath(
            run.map((p) => [scales.x(p.t), scales.y(p.v as number)]),
            s.curve,
          ),
        )
        .join('');
      return svg`<path class="ghost" data-series=${s.index} d=${d} fill="none"></path>`;
    });
  return paths.length ? svg`<g class="ghosts" aria-hidden="true">${paths}</g>` : nothing;
}

const decimalsOf = (n: number) => Math.min(3, (String(n).split('.')[1] ?? '').length);

/** A condition in words: "John: Home", "Heat pump power > 50", "18 < Flow temperature < 22". */
export function conditionText(c: Condition, hass: HomeAssistant): string {
  const stateObj = hass.states[c.entity];
  const name = String(stateObj?.attributes?.friendly_name ?? c.entity);
  const num = (n: number) => formatNumber(n, decimalsOf(n), hass);
  const parts: string[] = [];
  if (c.state) {
    const words = [c.state]
      .flat()
      .map((s) => (stateObj ? (hass.formatEntityState?.({ ...stateObj, state: s }, s) ?? s) : s));
    parts.push(`${name}: ${words.join(' / ')}`);
  }
  if (c.above !== undefined && c.below !== undefined) parts.push(`${num(c.above)} < ${name} < ${num(c.below)}`);
  else if (c.above !== undefined) parts.push(`${name} > ${num(c.above)}`);
  else if (c.below !== undefined) parts.push(`${name} < ${num(c.below)}`);
  return parts.join(', ');
}

/** What a chart passes to `chartArea` for the strip: the rows under the plot, and the frame's class and height. */
export interface StripParts {
  below: TemplateResult | typeof nothing;
  wrapClasses: string;
  wrapStyle: string;
}

/**
 * The strip under the plot (`when_strip: true`): one row per distinct condition, filled where
 * it held across `view`, in the colour of the first series it governs. With an `overview` strip,
 * both stack under the plot. Without the option or any condition it is just the overview.
 */
export function conditionStrip(
  ctx: ChartContext,
  frame: HistoryFrame,
  view: Range,
  scales: PlotScales,
  overview: TemplateResult | typeof nothing = nothing,
  now = Date.now(),
): StripParts {
  const plain: StripParts = { below: overview, wrapClasses: '', wrapStyle: '' };
  if (!stripOn(ctx.raw) || !frame.conditions) return plain;
  const rows: { c: Condition; color: string }[] = [];
  for (const s of frame.series) {
    const c = conditionOf(s.entity.config, ctx.raw);
    if (c && !rows.some((r) => sameCondition(r.c, c))) rows.push({ c, color: s.color });
  }
  if (rows.length === 0) return plain;
  const drawn = rows.map(({ c, color }) => {
    const spans = heldSpans(flips(c, frame.conditions!.states.get(c.entity) ?? []), view, now);
    const text = conditionText(c, ctx.hass);
    const rects = spans.map(([a, b]) => {
      const x = scales.x(a);
      return svg`<rect x=${x} y="0" width=${Math.max(0, scales.x(b) - x)} height="1" fill=${color}></rect>`;
    });
    return html`<div
      class="cond-row"
      role="img"
      aria-label=${localize(ctx.hass, 'when_strip_label', { condition: text })}
    >
      <svg viewBox="0 0 ${VIEW_W} 1" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>
      <span class="cond-label" aria-hidden="true">${text}</span>
    </div>`;
  });
  const height = STRIP_TOP + rows.length * ROW_H + (rows.length - 1) * ROW_GAP;
  return {
    below: html`<div class="cond-below">
      <div class="cond-strip">${drawn}</div>
      ${overview}
    </div>`,
    wrapClasses: `has-strip ${overview === nothing ? '' : 'strip-overview'}`,
    wrapStyle: `--cd-strip:${height}px`,
  };
}

export const conditionStyles = css`
  .plot .ghost {
    stroke: var(--secondary-text-color, #727272);
    stroke-width: 1px;
    stroke-opacity: 0.45;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .plot-wrap.has-strip {
    grid-template-rows: minmax(0, 1fr) auto auto;
  }
  /* The strip adds its own height, so the plot keeps its size. */
  .frame .plot-wrap.has-strip.has-overview {
    height: calc(180px + var(--cd-strip));
  }
  .frame.compact .plot-wrap.has-strip.has-overview {
    height: calc(110px + var(--cd-strip));
  }
  .frame .plot-wrap.has-strip.strip-overview.has-overview {
    height: calc(220px + var(--cd-strip));
  }
  .frame.compact .plot-wrap.has-strip.strip-overview.has-overview {
    height: calc(140px + var(--cd-strip));
  }
  .cond-below {
    grid-column: 2;
    grid-row: 3;
    min-width: 0;
  }
  .cond-strip {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 6px;
  }
  .cond-row {
    position: relative;
    height: 12px;
    border-radius: 3px;
    overflow: hidden;
    background: color-mix(in srgb, var(--primary-text-color, #212121) 6%, transparent);
  }
  .cond-row svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .cond-row rect {
    opacity: 0.5;
  }
  .cond-label {
    position: absolute;
    left: 4px;
    top: 0;
    max-width: calc(100% - 8px);
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 9px;
    line-height: 12px;
    color: var(--primary-text-color, #212121);
    white-space: nowrap;
    pointer-events: none;
    text-shadow:
      0 0 2px var(--card-background-color, #fff),
      0 0 2px var(--card-background-color, #fff);
  }
`;
