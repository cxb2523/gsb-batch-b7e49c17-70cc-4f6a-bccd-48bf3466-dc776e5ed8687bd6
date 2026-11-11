import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { formatDateTime, timeLabel, timeTicks, timeZoneOf, zoneOffset } from '../chart/axes';
import { disconnectHistory, frameMessage, frameStyles, historyFrame, periodNav } from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartWidth, gridStyles, stopChartWidth } from '../chart/grid';
import { chartLayout, layoutStyles, validateLayout } from '../chart/layout';
import { linear } from '../chart/scale';
import {
  formatDuration,
  isGap,
  isMeasurement,
  labelWidth,
  spanAt,
  spanBox,
  stateColor,
  stateSpans,
  timelineRows,
} from '../chart/timeline';
import type { StateColor, StateSpan, TimelineRow } from '../chart/timeline';
import {
  hoverHandlers,
  hoverTime,
  stopHover,
  tooltipEnabled,
  tooltipSide,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import { timelineEditor, timelineEntityFields } from '../editor/timeline-editor';
import { parsePeriod } from '../history/period';
import { localize } from '../localize';
import type { HassEntity, CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartStyleModule } from './index';

/** What each bar says, if it has room. */
export const BAR_LABELS = ['state', 'duration', 'both', 'none'] as const;
export type BarLabels = (typeof BAR_LABELS)[number];

/** Row heights in px: an entity's row, and a group's heading (normal, compact). */
const ROW_PX = { normal: 30, compact: 22 };
const HEADING_PX = { normal: 24, compact: 18 };
/** The names column takes at most this share of the card. */
const NAMES_SHARE = 0.35;
/** Evenly spaced times the hover guide can rest on, besides the state changes. */
const HOVER_STEPS = 240;
/** Room each time label needs, in px. */
const TIME_LABEL_PX = 70;

type Own = { group?: unknown; state_colors?: unknown };

const groupOf = (s: ChartSeries): string | undefined => {
  const g = (s.entity.config as Own).group;
  return typeof g === 'string' && g.trim() !== '' ? g.trim() : undefined;
};

/** Throw a readable error for a bad option. */
function validate(raw: CardConfig): void {
  parsePeriod(raw.period as CardConfig['period']);
  if (raw.source !== undefined && raw.source !== 'history') {
    throw new Error('"source" must be history: a state timeline reads states, which statistics don\'t keep');
  }
  if (raw.group_by !== undefined) throw new Error('"group_by" does not apply to a state timeline');
  if (raw.bar_labels !== undefined && !BAR_LABELS.includes(raw.bar_labels as BarLabels)) {
    throw new Error(`"bar_labels" must be one of: ${BAR_LABELS.join(', ')}`);
  }
  if (raw.x_axis !== undefined && typeof raw.x_axis !== 'boolean') throw new Error('"x_axis" must be true or false');
  const grid = raw.gridlines as Record<string, unknown> | undefined;
  if (grid !== undefined && (typeof grid !== 'object' || grid === null || Array.isArray(grid))) {
    throw new Error('"gridlines" must have "vertical" (true or false)');
  }
  if (grid?.vertical !== undefined && typeof grid.vertical !== 'boolean') {
    throw new Error('"gridlines.vertical" must be true or false');
  }
  checkColors(raw.state_colors, '"state_colors"');
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object') continue;
    const own = e as Own;
    if (own.group !== undefined && typeof own.group !== 'string')
      throw new Error(`"group" of ${e.entity} must be text`);
  }
  validateTooltipOptions(raw);
  validateLayout(raw);
}

function checkColors(v: unknown, where: string): void {
  if (v === undefined) return;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${where} must map states to colours, like "on: amber"`);
  }
  for (const [state, color] of Object.entries(v)) {
    if (typeof color !== 'string' || color.trim() === '')
      throw new Error(`${where}: the colour for "${state}" must be text`);
  }
}

/** The card's state colours: its own `state_colors`, plus the editor's list form. */
export function ownColors(raw: CardConfig): Record<string, string> | undefined {
  const v = raw.state_colors;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : undefined;
}

/** A state as Home Assistant words it ("Heat", "Away"), or as recorded when it can't say. */
function stateText(hass: HomeAssistant, s: ChartSeries, state: string): string {
  const stateObj: HassEntity = s.entity.stateObj ?? { entity_id: s.entity.entityId, state, attributes: {} };
  const attribute = s.entity.config.attribute;
  try {
    if (attribute) return hass.formatEntityAttributeValue?.(stateObj, attribute, state) ?? state;
    return hass.formatEntityState?.({ ...stateObj, state }, state) ?? state;
  } catch {
    return state;
  }
}

interface Row {
  series: ChartSeries;
  spans: StateSpan[];
  domain: string;
  /** All numbers, too many to be states: shown as a hint, not bars. */
  measurement: boolean;
}

function colorOf(row: Row, state: string, raw: CardConfig): StateColor {
  return stateColor(state, row.domain, ownColors(raw));
}

/** The states drawn in the period, once each, in the order they first appear, for the legend. */
function legend(rows: Row[], ctx: ChartContext): TemplateResult | typeof nothing {
  // One key per word as shown, first colour wins; quiet states ("Off", "Idle") go last.
  const seen = new Map<string, { label: string; color: StateColor }>();
  for (const row of rows) {
    if (row.measurement) continue;
    for (const span of row.spans) {
      if (isGap(span.state)) continue;
      const label = stateText(ctx.hass, row.series, span.state as string);
      if (!seen.has(label)) seen.set(label, { label, color: colorOf(row, span.state as string, ctx.raw) });
    }
  }
  if (seen.size === 0) return nothing;
  const keys = [...seen.values()];
  return html`<div class="tl-legend">
    ${[...keys.filter((k) => !k.color.quiet), ...keys.filter((k) => k.color.quiet)].map(
      ({ label, color }) =>
        html`<span class="tl-key"
          ><span class="swatch ${color.quiet ? 'quiet' : ''}" style="background:${color.color}"></span>${label}</span
        >`,
    )}
  </div>`;
}

function barLabel(mode: BarLabels, text: string, span: StateSpan): string {
  const duration = formatDuration(span.end - span.start);
  if (mode === 'state') return text;
  if (mode === 'duration') return duration;
  if (mode === 'both') return `${text} · ${duration}`;
  return '';
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

function bars(row: Row, frame: HistoryFrame, ctx: ChartContext, plotPx: number) {
  const mode = (ctx.raw.bar_labels as BarLabels | undefined) ?? 'state';
  return row.spans.map((span) => {
    if (isGap(span.state)) return nothing;
    const { left, width } = spanBox(span, frame.range);
    if (width <= 0) return nothing;
    const state = span.state as string;
    const color = colorOf(row, state, ctx.raw);
    const text = barLabel(mode, stateText(ctx.hass, row.series, state), span);
    const fits = text !== '' && labelWidth(text) <= width * plotPx;
    return html`<div
      class="tl-bar ${color.quiet ? 'quiet' : ''} text-${color.text}"
      style="left:${pct(left)};width:${pct(width)};--tl-color:${color.color}"
    >
      ${fits ? html`<span class="tl-label">${text}</span>` : nothing}
    </div>`;
  });
}

/** The guide line and a box naming each row's state at the hovered time, and for how long. */
function hoverLayer(rows: Row[], frame: HistoryFrame, ctx: ChartContext, plotPx: number) {
  const t = hoverTime(ctx.host);
  if (t === undefined) return nothing;
  const x = (t - frame.range.start) / (frame.range.end - frame.range.start);
  if (!(x >= 0 && x <= 1)) return nothing;
  const side = tooltipSide(x, plotPx);
  return html`<div class="hover-layer" aria-hidden="true">
    <div class="crosshair" style="left:${pct(x)}"></div>
    <div class="tooltip ${side}" style=${side.startsWith('pin') ? '' : `left:${pct(x)}`}>
      <div class="tooltip-time">${formatDateTime(t, ctx.hass)}</div>
      ${rows.map((row) => {
        const span = spanAt(row.spans, t);
        const state = span?.state;
        const gap = isGap(state);
        const color = gap ? undefined : colorOf(row, state as string, ctx.raw);
        const text = state === undefined || state === '' ? '—' : stateText(ctx.hass, row.series, state as string);
        return html`<div class="tooltip-row">
          <span class="swatch" style="background:${color?.color ?? 'transparent'}"></span>
          <span class="tooltip-name">${row.series.entity.name}</span>
          <span class="tooltip-value"
            >${text}${
              span && !gap
                ? html` <span class="tl-for"
                    >${localize(ctx.hass, 'timeline_for', { duration: formatDuration(span.end - span.start) })}</span
                  >`
                : nothing
            }</span
          >
        </div>`;
      })}
    </div>
  </div>`;
}

function timeAxis(frame: HistoryFrame, ctx: ChartContext, plotPx: number) {
  const count = Math.max(2, Math.min(8, Math.round(plotPx / TIME_LABEL_PX)));
  const offset = zoneOffset(timeZoneOf(ctx.hass));
  const { unit, ticks } = timeTicks(frame.range, count, offset);
  const x = linear([frame.range.start, frame.range.end], [0, 1]);
  return { unit, ticks, x, offset };
}

export const timeline: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 200,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    .tl-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      padding: 0 0 8px;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .tl-key {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .swatch.quiet {
      opacity: 0.45;
    }
    .tl-wrap {
      display: grid;
      grid-template-columns: fit-content(35%) minmax(0, 1fr);
      grid-template-rows: auto auto;
    }
    .tl-wrap.no-names {
      grid-template-columns: 0 minmax(0, 1fr);
    }
    .tl-names {
      grid-column: 1;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding-right: 10px;
    }
    .tl-name,
    .tl-heading {
      display: flex;
      align-items: center;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      height: var(--tl-row);
    }
    .tl-name {
      font-size: 0.875em;
      cursor: pointer;
      border-radius: 4px;
    }
    .tl-name span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tl-name:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
    }
    .tl-heading {
      height: var(--tl-heading);
      font-size: 0.75em;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--secondary-text-color);
    }
    .tl-plot {
      position: relative;
      grid-column: 2;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .tl-gap {
      height: var(--tl-heading);
      position: relative;
    }
    .tl-gap::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.25));
    }
    .tl-row {
      position: relative;
      height: var(--tl-row);
      cursor: pointer;
    }
    .tl-track,
    .tl-bar {
      position: absolute;
      top: 4px;
      bottom: 4px;
      border-radius: 6px;
    }
    .tl-track {
      left: 0;
      right: 0;
      background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    }
    .tl-bars {
      position: absolute;
      inset: 0;
      clip-path: inset(0 100% 0 0);
      transition: clip-path var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .tl-bars {
      clip-path: inset(0 0 0 0);
    }
    .tl-bar {
      min-width: 2px;
      background: var(--tl-color);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      box-sizing: border-box;
    }
    .tl-bar.quiet {
      background: color-mix(in srgb, var(--tl-color) 30%, transparent);
    }
    .tl-label {
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      padding: 0 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tl-bar.text-dark .tl-label {
      color: #1c1c1c;
    }
    .tl-bar.text-light .tl-label {
      color: #fff;
    }
    .tl-bar.text-theme .tl-label {
      color: var(--primary-text-color);
    }
    .tl-grid {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.25));
      pointer-events: none;
    }
    .tl-now {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1.5px dashed var(--secondary-text-color);
      opacity: 0.7;
      pointer-events: none;
    }
    .tl-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      padding: 0 8px;
      font-size: 0.75em;
      color: var(--secondary-text-color);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .tl-for {
      font-weight: 400;
      color: var(--secondary-text-color);
    }
    .tl-wrap .x-axis {
      position: relative;
      grid-column: 2;
      grid-row: 2;
      height: 18px;
    }
    .tl-wrap .x-axis .axis-label {
      top: 5px;
    }
    .frame.compact .tl-legend {
      padding-bottom: 4px;
      font-size: 0.8em;
    }
    .frame.compact .tl-wrap .x-axis {
      height: 14px;
    }
    .frame.compact .tl-wrap .x-axis .axis-label {
      top: 3px;
    }
    .frame.compact .tl-track,
    .frame.compact .tl-bar {
      top: 3px;
      bottom: 3px;
      border-radius: 4px;
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="7" width="56" height="7" rx="3" fill="var(--divider-color, rgba(127,127,127,.25))" />
    <rect x="12" y="7" width="16" height="7" rx="3" fill="var(--warning-color, #f59e0b)" />
    <rect x="40" y="7" width="14" height="7" rx="3" fill="var(--warning-color, #f59e0b)" />
    <rect x="4" y="17" width="56" height="7" rx="3" fill="var(--divider-color, rgba(127,127,127,.25))" />
    <rect x="22" y="17" width="12" height="7" rx="3" fill="var(--primary-color, #03a9f4)" />
    <rect x="34" y="17" width="6" height="7" rx="3" fill="var(--purple-color, #8b6cff)" />
    <rect x="4" y="27" width="56" height="7" rx="3" fill="var(--divider-color, rgba(127,127,127,.25))" />
    <rect x="4" y="27" width="22" height="7" rx="3" fill="var(--success-color, #1fae7a)" />
    <rect x="44" y="27" width="16" height="7" rx="3" fill="var(--success-color, #1fae7a)" />`,
  validate,
  editor: timelineEditor,
  entityFields: timelineEntityFields,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render(ctx) {
    const now = Date.now();
    const frame = historyFrame(ctx, now, { text: true });
    const layout = chartLayout(ctx.raw);
    const compact = layout.compact ? 'compact' : 'normal';
    const nav = periodNav(frame, ctx);
    const until = Math.min(frame.range.end, now);
    const rows: Row[] = frame.series.map((series) => ({
      series,
      spans: stateSpans(series.points, until),
      domain: series.entity.entityId.split('.')[0],
      measurement: false,
    }));
    for (const row of rows) row.measurement = isMeasurement(row.spans);
    const showLegend = layout.header !== 'hidden';
    const frameBox = (header: unknown, body: TemplateResult) =>
      html`<div class="frame ${layout.compact ? 'compact' : ''}">${header}${body}</div>`;
    const message =
      frame.status !== 'ready'
        ? frameMessage(frame, ctx)
        : rows.every((r) => r.spans.every((s) => isGap(s.state)))
          ? html`<div class="chart-message">${localize(ctx.hass, 'timeline_no_states')}</div>`
          : undefined;
    if (message) return frameBox(nav, message);

    const showNames = ctx.config.show.name;
    const width = chartWidth(ctx);
    const longest = Math.max(0, ...rows.map((r) => r.series.entity.name.length));
    const namesPx = showNames ? Math.min(width * NAMES_SHARE, longest * 7 + 10) : 0;
    const plotPx = Math.max(40, width - 32 - namesPx);
    const axis = timeAxis(frame, ctx, plotPx);
    const xAxis = ctx.raw.x_axis !== false;
    const vertical = (ctx.raw.gridlines as { vertical?: boolean } | undefined)?.vertical ?? true;
    const tooltip = tooltipEnabled(ctx.raw);
    const byIndex = new Map(rows.map((r) => [r.series.index, r]));
    const ordered: TimelineRow<Row>[] = timelineRows(
      frame.series.map((s) => byIndex.get(s.index) as Row),
      (r) => groupOf(r.series),
    );
    const span = frame.range.end - frame.range.start;
    const showNow = frame.live && frame.range.end > now && now > frame.range.start;
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_timeline'),
      names: rows.map((r) => r.series.entity.name).join(', '),
    });
    const hover = tooltip
      ? hoverHandlers(ctx, frame.range, [
          Array.from({ length: HOVER_STEPS + 1 }, (_, i) => ({
            t: frame.range.start + (span * i) / HOVER_STEPS,
            v: null,
          })),
          ...rows.map((r) => r.spans.map((s) => ({ t: s.start, v: null }))),
        ])
      : undefined;
    const vars = `--tl-row:${ROW_PX[compact]}px;--tl-heading:${HEADING_PX[compact]}px`;
    return frameBox(
      html`${nav}${showLegend ? legend(rows, ctx) : nothing}`,
      html`<div class="tl-wrap ${showNames ? '' : 'no-names'}" style=${vars}>
        ${
          showNames
            ? html`<div class="tl-names">
                ${ordered.map((r) =>
                  'heading' in r
                    ? html`<div class="tl-heading">${r.heading}</div>`
                    : html`<div
                        class="entity tl-name"
                        data-index=${r.item.series.index}
                        tabindex="0"
                        aria-label=${r.item.series.entity.label}
                      >
                        <span>${r.item.series.entity.name}</span>
                      </div>`,
                )}
              </div>`
            : nothing
        }
        <div
          class="tl-plot plot-area ${hover ? 'hoverable' : ''}"
          role="img"
          aria-label=${label}
          @pointerdown=${hover?.move}
          @pointermove=${hover?.move}
          @pointerleave=${hover?.leave}
          @pointercancel=${hover?.leave}
        >
          ${vertical ? axis.ticks.map((t) => html`<div class="tl-grid" style="left:${pct(axis.x(t))}"></div>`) : nothing}
          ${ordered.map((r) =>
            'heading' in r
              ? html`<div class="tl-gap"></div>`
              : html`<div class="entity tl-row" data-index=${r.item.series.index}>
                  <div class="tl-track"></div>
                  ${
                    r.item.measurement
                      ? html`<div class="tl-hint">${localize(ctx.hass, 'timeline_measurement')}</div>`
                      : html`<div class="tl-bars">${bars(r.item, frame, ctx, plotPx)}</div>`
                  }
                </div>`,
          )}
          ${showNow ? html`<div class="tl-now" style="left:${pct(axis.x(now))}" title=${localize(ctx.hass, 'timeline_now')}></div>` : nothing}
          ${tooltip ? hoverLayer(rows, frame, ctx, plotPx) : nothing}
        </div>
        ${
          xAxis
            ? html`<div class="x-axis">
                ${axis.ticks.map((t) => {
                  const left = axis.x(t);
                  const edge = left < 0.05 ? 'start' : left > 0.95 ? 'end' : '';
                  return html`<span class="axis-label ${edge}" style="left:${pct(left)}"
                    >${timeLabel(t, axis.unit, span, ctx.hass, axis.offset)}</span
                  >`;
                })}
              </div>`
            : nothing
        }
      </div>`,
    );
  },
};
