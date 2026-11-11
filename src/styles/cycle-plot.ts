import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { hour12Of, valueAxis } from '../chart/axes';
import { CYCLES, cycleColumns, cycleData, panelMean } from '../chart/cycle';
import type { Cycle, CycleData } from '../chart/cycle';
import {
  SOURCES,
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  seriesHeader,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartWidth, stopChartWidth } from '../chart/grid';
import { runPath, runs } from '../chart/paths';
import { tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import { pickHandlers, pickTooltip, pickedIndex, stopPick } from '../chart/xy';
import { HISTORY_FIELDS, cachedSchema, chartForm, choice } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { AGGREGATES } from '../history/group';
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

/** Weeks of history each cycle reads when `weeks` isn't set. */
export const DEFAULT_WEEKS: Record<Cycle, number> = { day_of_week: 8, hour_of_day: 2, day_of_month: 26 };
/** The most weeks each cycle reads (hour by hour gets heavy past a quarter). */
export const MAX_WEEKS: Record<Cycle, number> = { day_of_week: 26, hour_of_day: 13, day_of_month: 104 };
/** Day of the month reads a day at a time over months, which history rarely keeps: statistics by default. */
const DEFAULT_SOURCE: Record<Cycle, string> = {
  day_of_week: 'history',
  hour_of_day: 'history',
  day_of_month: 'statistics',
};

/** Panel drawing box; the SVG stretches, strokes don't. */
const PW = 100;
const PH = 100;
/** Narrowest a panel gets before the panels wrap onto another row, px. */
const MIN_PANEL_PX = 30;
const GAP_PX = 4;
/** Height of one row of panels, px: taller when they all fit in one row. */
const ROW_PX = 120;
const ROWS_PX = 86;
/** Room for a panel's name above its line when the panels wrap onto rows, px. */
const TITLE_PX = 14;
/** Panel, slot: one number for the picked point (the pointer state holds a single index). */
const PER_PANEL = 1000;

type Raw = CardConfig & { cycle?: unknown; weeks?: unknown };

export interface CycleOptions {
  cycle: Cycle;
  weeks: number;
}

export function cycleOptions(raw: CardConfig): CycleOptions {
  const r = raw as Raw;
  const cycle = (r.cycle as Cycle | undefined) ?? 'day_of_week';
  return { cycle, weeks: typeof r.weeks === 'number' ? r.weeks : DEFAULT_WEEKS[cycle] };
}

/**
 * The card's options as the history frame reads them: `weeks` back from now, grouped by the hour
 * (by the day for day of the month). The period's offset and buttons stay the card's.
 */
export function cycleRaw(raw: CardConfig): CardConfig {
  const o = cycleOptions(raw);
  const period = (raw.period ?? {}) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const k of ['offset', 'navigate']) if (period[k] !== undefined) kept[k] = period[k];
  return {
    ...raw,
    source: raw.source ?? DEFAULT_SOURCE[o.cycle],
    group_by: o.cycle === 'day_of_month' ? 'day' : 'hour',
    period: { ...kept, last: o.weeks, unit: 'week' },
  };
}

function validate(raw: CardConfig): void {
  const r = raw as Raw;
  if (r.cycle !== undefined && !CYCLES.includes(r.cycle as Cycle)) {
    throw new Error(`"cycle" must be one of: ${CYCLES.join(', ')}`);
  }
  const max = MAX_WEEKS[(r.cycle as Cycle | undefined) ?? 'day_of_week'];
  if (r.weeks !== undefined && !(Number.isInteger(r.weeks) && (r.weeks as number) >= 1 && (r.weeks as number) <= max)) {
    throw new Error(`"weeks" must be a whole number from 1 to ${max}`);
  }
  validateHistoryOptions(cycleRaw(raw));
  validateTooltipOptions(raw);
}

/* -------------------------------------------------------------- labels -------------------------------------------------------------- */

const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(hass: HomeAssistant | undefined, opts: Intl.DateTimeFormatOptions) {
  const language = hass?.locale?.language ?? hass?.language ?? 'en';
  const k = `${language}|${JSON.stringify(opts)}`;
  let f = formats.get(k);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(language, { ...opts, timeZone: 'UTC' });
    } catch {
      f = new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' });
    }
    formats.set(k, f);
  }
  return f;
}

const hourOf = (h: number, hass: HomeAssistant | undefined) =>
  dateFormat(hass, { hour: 'numeric', hour12: hour12Of(hass) }).format(Date.UTC(2024, 0, 1, h));
const hourMinute = (h: number, hass: HomeAssistant | undefined) =>
  dateFormat(hass, { hour: 'numeric', minute: '2-digit', hour12: hour12Of(hass) }).format(Date.UTC(2024, 0, 1, h));
/** 1 Jan 2024 was a Monday: weekday n (1 = Monday) is 2024-01-n. */
const weekdayOf = (row: number, firstDay: number, hass: HomeAssistant | undefined, long = false) =>
  dateFormat(hass, { weekday: long ? 'long' : 'short' }).format(Date.UTC(2024, 0, ((firstDay - 1 + row) % 7) + 1));

/** A panel's title. */
function panelName(key: number, cycle: Cycle, firstDay: number, hass: HomeAssistant | undefined) {
  if (cycle === 'day_of_week') return weekdayOf(key, firstDay, hass);
  if (cycle === 'hour_of_day') return hourOf(key, hass);
  return String(key);
}

/** What one point of a panel stands for, for the tooltip. */
function pointName(
  data: CycleData,
  key: number,
  slot: number,
  cycle: Cycle,
  firstDay: number,
  hass: HomeAssistant | undefined,
): string {
  if (cycle === 'day_of_week') {
    return `${weekdayOf(key, firstDay, hass, true)} ${hourMinute(slot, hass)} – ${hourMinute((slot + 1) % 24, hass)}`;
  }
  if (cycle === 'hour_of_day') {
    const day = dateFormat(hass, { weekday: 'short', day: 'numeric', month: 'short' }).format(
      (data.first + slot) * 86_400_000,
    );
    return `${day} ${hourMinute(key, hass)}`;
  }
  const month = data.first + slot;
  return dateFormat(hass, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    Date.UTC(Math.floor(month / 12), month % 12, key),
  );
}

/** The days (months) each panel runs across, under the first one: "25 Oct – 8 Nov". */
function spanName(data: CycleData, cycle: Cycle, hass: HomeAssistant | undefined): string {
  const last = data.slots - 1;
  if (cycle === 'hour_of_day') {
    const f = dateFormat(hass, { day: 'numeric', month: 'short' });
    return `${f.format(data.first * 86_400_000)} – ${f.format((data.first + last) * 86_400_000)}`;
  }
  const f = dateFormat(hass, { month: 'short', year: 'numeric' });
  const at = (m: number) => Date.UTC(Math.floor(m / 12), m % 12, 1);
  return `${f.format(at(data.first))} – ${f.format(at(data.first + last))}`;
}

/** What each panel's line is, for the legend. */
function lineNote(cycle: Cycle, weeks: number, hass: HomeAssistant | undefined): string {
  const key = { day_of_week: 'cycle_note_week', hour_of_day: 'cycle_note_hour', day_of_month: 'cycle_note_month' }[
    cycle
  ];
  return localize(hass, key, { n: weeks });
}

/* -------------------------------------------------------------- drawing -------------------------------------------------------------- */

interface Built {
  series: ChartSeries;
  data: CycleData;
}

/** A panel's line for one series, and its dashed average. */
function panelLines(b: Built, p: number, y: (v: number) => number, multi: boolean) {
  const { values } = b.data.panels[p];
  const slots = b.data.slots;
  const x = (k: number) => (slots <= 1 ? PW / 2 : (k / (slots - 1)) * PW);
  const pts = values.map((v, k) => ({ k, v }));
  const d = runs(pts)
    .map((run) =>
      run.length === 1
        ? `M${x(run[0].k)},${y(run[0].v as number)}h0.01`
        : runPath(
            run.map((q) => [x(q.k), y(q.v as number)]),
            'straight',
          ),
    )
    .join('');
  const mean = panelMean(values);
  return svg`<g class="cy-series" data-series=${b.series.index}>
    ${
      mean === undefined
        ? nothing
        : svg`<line class="cy-mean ${multi ? 'multi' : ''}" x1="0" x2=${PW} y1=${y(mean)} y2=${y(mean)}
            stroke=${multi ? b.series.color : 'var(--cd-cycle-mean)'}></line>`
    }
    <path class="cy-line" d=${d} stroke=${b.series.color}></path>
  </g>`;
}

function drawCycle(frame: HistoryFrame, ctx: ChartContext, o: CycleOptions): TemplateResult {
  const built: Built[] = frame.series.map((series) => ({
    series,
    data: cycleData(series.points, o.cycle, frame.zone, frame.range),
  }));
  const panels = built[0].data.panels;
  const all = built.flatMap((b) => b.data.panels.flatMap((p) => p.values)).filter((v): v is number => v !== null);
  const axis = valueAxis(all.length ? [Math.min(...all), Math.max(...all)] : undefined, {}, 3);
  const [lo, hi] = axis.domain;
  // A little room top and bottom so a line along an end isn't cut by the panel's edge.
  const y = (v: number) => PH - 4 - ((v - lo) / (hi - lo || 1)) * (PH - 8);
  const width = Math.max(0, chartWidth(ctx) - 32 - 36);
  const cols = cycleColumns(panels.length, width, MIN_PANEL_PX, GAP_PX);
  const rows = Math.ceil(panels.length / cols);
  const rowPx = rows === 1 ? ROW_PX : ROWS_PX;
  const panelPx = (width - (cols - 1) * GAP_PX) / cols;
  const multi = built.length > 1;
  const hass = ctx.hass;
  const first = frame.zone.firstDay;
  const tooltip = tooltipEnabled(ctx.raw);
  const slots = built[0].data.slots;
  const picked = pickedIndex(ctx.host);
  const pickedPanel = picked === undefined ? undefined : Math.floor(picked / PER_PANEL);
  const pickedSlot = picked === undefined ? undefined : picked % PER_PANEL;
  const hover = tooltip
    ? pickHandlers(ctx, (fx, fy, w) => {
        // Which panel, by the grid's columns and rows (gaps go to the panel on their left / above).
        const col = Math.min(cols - 1, Math.floor(fx * cols));
        const row = Math.min(rows - 1, Math.floor(fy * rows));
        const p = row * cols + col;
        if (p >= panels.length) return undefined;
        const step = (w + GAP_PX) / cols;
        const inside = Math.min(1, Math.max(0, (fx * w - col * step) / Math.max(1, step - GAP_PX)));
        return p * PER_PANEL + Math.round(inside * Math.max(0, slots - 1));
      })
    : undefined;
  const fmt = (b: Built, v: number) => withUnit(formatNumber(v, b.series.entity.decimals, hass), b.series.entity.unit);
  let overlay: TemplateResult | typeof nothing = nothing;
  if (pickedPanel !== undefined && pickedSlot !== undefined && pickedPanel < panels.length) {
    const col = pickedPanel % cols;
    const row = Math.floor(pickedPanel / cols);
    const step = (width + GAP_PX) / cols;
    const at = col * step + (slots <= 1 ? 0.5 : pickedSlot / (slots - 1)) * panelPx;
    const key = panels[pickedPanel].key;
    overlay = pickTooltip({
      x: width > 0 ? at / width : 0,
      y: (row + 0.5) / rows,
      plotWidth: width,
      title: pointName(built[0].data, key, pickedSlot, o.cycle, first, hass),
      rows: built.flatMap((b) => {
        const v = b.data.panels[pickedPanel].values[pickedSlot];
        const mean = panelMean(b.data.panels[pickedPanel].values);
        return [
          { color: b.series.color, name: b.series.entity.name, value: v === null ? '—' : fmt(b, v) },
          ...(mean === undefined
            ? []
            : [
                {
                  name: localize(hass, 'cycle_panel_average', { name: panelName(key, o.cycle, first, hass) }),
                  value: fmt(b, mean),
                },
              ]),
        ];
      }),
    });
  }
  const grid = `grid-template-columns:repeat(${cols}, minmax(0, 1fr));grid-auto-rows:${rowPx}px`;
  const ticks = axis.ticks.filter((v) => v >= lo && v <= hi);
  const unit = frame.series[0].entity.unit;
  const label = localize(hass, 'chart_aria', {
    style: localize(hass, 'editor_style_cycle_plot'),
    names: frame.series.map((s) => s.entity.name).join(', '),
  });
  // Under the first panel: what each panel's line runs across.
  const across =
    o.cycle === 'day_of_week' ? `${hourOf(0, hass)} – ${hourOf(23, hass)}` : spanName(built[0].data, o.cycle, hass);
  // Wrapped onto rows, each panel's name sits in a strip at its top, kept clear of its line.
  const top = rows > 1 ? TITLE_PX : 0;
  return html`<div class="cy" role="img" aria-label=${label}>
    ${
      rows === 1
        ? html`<div class="cy-titles" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr))" aria-hidden="true">
            ${unit ? html`<span class="cy-unit">${unit}</span>` : nothing}
            ${panels.map((p) => html`<span class="cy-title">${panelName(p.key, o.cycle, first, hass)}</span>`)}
          </div>`
        : nothing
    }
    <div class="cy-body">
      <div class="cy-axis" aria-hidden="true">
        ${Array.from(
          { length: rows },
          (_, r) =>
            html`<div class="cy-axis-row" style="height:${rowPx}px">
              ${ticks.map(
                (v) =>
                  html`<span class="cy-tick" style="top:calc(${top}px + ${y(v) / PH} * (100% - ${top}px))"
                    >${formatNumber(v, axis.decimals, hass)}</span
                  >`,
              )}
              ${r === 0 && top > 0 && unit ? html`<span class="cy-unit">${unit}</span>` : nothing}
            </div>`,
        )}
      </div>
      <div
        class="cy-grid ${hover ? 'hoverable' : ''}"
        style=${grid}
        @pointerdown=${hover?.move}
        @pointermove=${hover?.move}
        @pointerleave=${hover?.leave}
        @pointercancel=${hover?.leave}
      >
        ${panels.map(
          (p, i) =>
            html`<div class="cy-panel" style="padding-top:${top}px">
              <svg class="cy-svg" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none">
                <rect class="cy-bg" x="0" y="0" width=${PW} height=${PH} rx="3"></rect>
                ${built.map((b) => panelLines(b, i, y, multi))}
                ${
                  pickedPanel === i && pickedSlot !== undefined
                    ? svg`<line class="cy-guide" x1=${(slots <= 1 ? 0.5 : pickedSlot / (slots - 1)) * PW}
                      x2=${(slots <= 1 ? 0.5 : pickedSlot / (slots - 1)) * PW} y1="0" y2=${PH}></line>`
                    : nothing
                }
              </svg>
              ${rows > 1 ? html`<span class="cy-inline-title">${panelName(p.key, o.cycle, first, hass)}</span>` : nothing}
            </div>`,
        )}
        ${overlay}
      </div>
    </div>
    <div class="cy-ends" aria-hidden="true">${across}</div>
    <div class="cy-legend">
      ${built.map(
        (b) =>
          html`<span
            class="entity cy-key"
            data-index=${b.series.index}
            tabindex="0"
            aria-label=${b.series.entity.label}
          >
            <span class="cy-swatch" style="background:${b.series.color}"></span>${
              multi ? b.series.entity.name : lineNote(o.cycle, o.weeks, hass)
            }
          </span>`,
      )}
      ${multi ? html`<span class="cy-key">${lineNote(o.cycle, o.weeks, hass)}</span>` : nothing}
      <span class="cy-key"><span class="cy-dash"></span>${localize(hass, 'cycle_mean_legend')}</span>
    </div>
  </div>`;
}

/* -------------------------------------------------------------- editor -------------------------------------------------------------- */

const CYCLE_FIELDS: FieldBinding[] = [
  { name: 'cycle_plot_cycle', path: ['cycle'], default: 'day_of_week' },
  { name: 'cycle_plot_weeks', path: ['weeks'] },
  ...HISTORY_FIELDS.filter((f) => ['period_offset', 'period_navigate', 'source', 'aggregate'].includes(f.name)),
  { name: 'tooltip', path: ['tooltip'], default: true },
];

function cycleEditor(ctx: ChartEditorContext): TemplateResult {
  const o = cycleOptions(ctx.config);
  const schema = cachedSchema(`cycle_plot|${o.cycle}`, ctx.hass, () => [
    { name: 'cycle_plot_cycle', selector: choice(ctx.hass, 'cycle_plot_cycle', CYCLES) },
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'cycle_plot_weeks',
          selector: { number: { min: 1, max: MAX_WEEKS[o.cycle], mode: 'box', placeholder: DEFAULT_WEEKS[o.cycle] } },
        },
        { name: 'period_offset', selector: { number: { min: 0, mode: 'box' } } },
      ],
    },
    { name: 'period_navigate', selector: { boolean: {} } },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'source', selector: choice(ctx.hass, 'source', SOURCES) },
        { name: 'aggregate', selector: choice(ctx.hass, 'aggregate', AGGREGATES) },
      ],
    },
    { name: 'tooltip', selector: { boolean: {} } },
  ]);
  // The source's default follows the cycle, so the form shows what the chart reads.
  const fields = CYCLE_FIELDS.map((f) => (f.name === 'source' ? { ...f, default: DEFAULT_SOURCE[o.cycle] } : f));
  return chartForm(ctx, 'chart', schema, fields);
}

/* -------------------------------------------------------------- module -------------------------------------------------------------- */

export const cyclePlot: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 230,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .cy {
      --cd-cycle-mean: var(--error-color, #db4437);
    }
    .cy-titles,
    .cy-grid {
      display: grid;
      gap: ${GAP_PX}px;
    }
    .cy-titles {
      position: relative;
      margin-left: 36px;
      padding-bottom: 4px;
    }
    .cy-title,
    .cy-inline-title {
      font-size: 11px;
      color: var(--secondary-text-color);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cy-body {
      display: flex;
      gap: 0;
    }
    .cy-axis {
      flex: none;
      width: 32px;
      margin-right: 4px;
      display: flex;
      flex-direction: column;
      gap: ${GAP_PX}px;
    }
    .cy-axis-row {
      position: relative;
    }
    .cy-tick {
      position: absolute;
      right: 0;
      transform: translateY(-50%);
      font-size: 10px;
      line-height: 1;
      color: var(--secondary-text-color);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .cy-unit {
      position: absolute;
      right: 0;
      top: -1px;
      font-size: 10px;
      line-height: 1;
      color: var(--secondary-text-color);
      white-space: nowrap;
    }
    .cy-titles .cy-unit {
      left: -36px;
      width: 32px;
      top: 1px;
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cy-grid {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
    }
    .cy-grid.hoverable {
      cursor: crosshair;
    }
    .cy-panel {
      position: relative;
      min-width: 0;
      box-sizing: border-box;
    }
    .cy-inline-title {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      font-size: 10px;
      pointer-events: none;
    }
    .cy-svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .cy-svg path,
    .cy-svg line {
      vector-effect: non-scaling-stroke;
    }
    .cy-bg {
      fill: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    }
    .cy-line {
      fill: none;
      stroke-width: 1.75px;
      stroke-linejoin: round;
      stroke-linecap: round;
      opacity: 0;
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .cy-line {
      opacity: 1;
    }
    :host([static]) .cy-line {
      transition: none;
    }
    .cy-mean {
      stroke-width: 1.25px;
      stroke-dasharray: 3 2;
    }
    .cy-mean.multi {
      opacity: 0.7;
    }
    .cy-guide {
      stroke: var(--secondary-text-color);
      stroke-width: 1px;
    }
    .cy-ends {
      margin-left: 36px;
      padding-top: 3px;
      font-size: 10px;
      color: var(--secondary-text-color);
      white-space: nowrap;
      min-width: 0;
    }
    .cy-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      padding-top: 8px;
      font-size: 0.8125em;
      color: var(--secondary-text-color);
    }
    .cy-key {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      border-radius: 4px;
    }
    .cy-key.entity {
      cursor: pointer;
    }
    .cy-key.entity:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .cy-swatch {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .cy-dash {
      flex: none;
      width: 14px;
      border-top: 2px dashed var(--cd-cycle-mean);
    }
  `,
  thumbnail: () => svg`
    ${[0, 1, 2, 3, 4].map(
      (i) => svg`<g transform="translate(${3 + i * 12} 6)">
        <rect width="10" height="28" rx="1.5" fill="var(--primary-text-color, #212121)" fill-opacity="0.06"></rect>
        <path d=${i < 3 ? 'M1 22L3 21L4 8L5 20L7 12L9 20' : 'M1 22L3 14L5 13L7 14L9 22'} fill="none"
          stroke="var(--primary-color, #03a9f4)" stroke-width="1.2" stroke-linejoin="round"></path>
        <path d="M1 17H9" stroke="var(--error-color, #db4437)" stroke-width="0.8" stroke-dasharray="1.5 1"></path>
      </g>`,
    )}`,
  validate,
  editor: cycleEditor,
  entityFields: () => ({
    schema: [{ name: 'series_color', selector: { text: {} } }],
    fields: [{ name: 'series_color', path: ['color'] }],
  }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopPick(host);
  },
  render(ctx) {
    const o = cycleOptions(ctx.raw);
    const frame = historyFrame({ ...ctx, raw: cycleRaw(ctx.raw) });
    const nav = periodNav(frame, ctx);
    const names = seriesHeader(frame, ctx);
    const message = frameMessage(frame, ctx);
    if (message) return html`<div class="frame">${nav}${names}${message}</div>`;
    return html`<div class="frame">${nav}${names}${drawCycle(frame, ctx, o)}</div>`;
  },
};
