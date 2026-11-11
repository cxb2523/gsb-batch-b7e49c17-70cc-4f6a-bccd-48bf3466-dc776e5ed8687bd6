import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { extentOf, lowHigh, niceTicks, readingAt } from '../chart/compare';
import type { TimedValue } from '../chart/compare';
import { disconnectHistory, frameMessage, frameStyles, historyFrame, validateHistoryOptions } from '../chart/frame';
import { ROLLING_HISTORY_FIELDS, cachedSchema, chartForm, choice, rollingHistorySchema } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { parsePeriod } from '../history/period';
import type { Period } from '../history/period';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig, HomeAssistant } from '../types';

export const ENDS = ['range', 'then', 'target'] as const;
export type Ends = (typeof ENDS)[number];
export const ORIENTATIONS = ['horizontal', 'vertical'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** What a mark on a row stands for. */
export type MarkKind = 'low' | 'high' | 'now' | 'then' | 'target';

export interface Mark {
  kind: MarkKind;
  value: number;
}

/** One entity's row: its marks, lowest first, and which of them get a value label. */
export interface DumbbellRow {
  index: number;
  entity: ResolvedEntity;
  marks: Mark[];
  /** The marks labelled at the low and high ends (the same mark when there is only one). */
  labelled: Mark[];
}

/** The earliest reading in a period when none was in force at its start (statistics start late). */
function firstReading(points: TimedValue[]): number | null {
  for (const p of points) if (p.v !== null) return p.v;
  return null;
}

/**
 * The marks for one entity. `range`: lowest and highest over the period (stretched to take in
 * the current value, which may be newer than the last stored reading), plus the current value
 * when `showNow`. `then`: the reading at the start of the period and now. `target`: the entity's
 * target and now. Anything missing is left out, so a row may have one mark or none.
 */
export function rowMarks(e: ResolvedEntity, ends: Ends, points: TimedValue[], start: number, showNow: boolean): Mark[] {
  const now = e.available ? e.value : null;
  const marks: Mark[] = [];
  if (ends === 'range') {
    const lh = lowHigh(points);
    const span = lh ? extentOf([lh[0], lh[1], now]) : undefined;
    if (span) marks.push({ kind: 'low', value: span[0] }, { kind: 'high', value: span[1] });
    if (now !== null && (showNow || !span)) marks.push({ kind: 'now', value: now });
  } else {
    const other = ends === 'then' ? (readingAt(points, start) ?? firstReading(points)) : e.target;
    if (other !== null) marks.push({ kind: ends, value: other });
    if (now !== null) marks.push({ kind: 'now', value: now });
  }
  // Stable sort keeps low before high when they are equal.
  return marks.sort((a, b) => a.value - b.value);
}

/**
 * The marks that carry a value label: the lowest and highest. In range mode with low and high,
 * the current value sits between them unlabelled (it is in the row's description).
 */
export function labelledMarks(marks: Mark[]): Mark[] {
  if (marks.length === 0) return [];
  const ends = marks.some((m) => m.kind === 'low') ? marks.filter((m) => m.kind !== 'now') : marks;
  const lo = ends[0];
  const hi = ends[ends.length - 1];
  return lo === hi ? [hi] : [lo, hi];
}

export function dumbbellRows(
  items: ResolvedEntity[],
  ends: Ends,
  pointsFor: (index: number) => TimedValue[],
  start: number,
  showNow: boolean,
): DumbbellRow[] {
  return items.map((entity, index) => {
    const marks = rowMarks(entity, ends, pointsFor(index), start, showNow);
    return { index, entity, marks, labelled: labelledMarks(marks) };
  });
}

/** Decimals a tick step needs: 0 for whole steps, 1 for 0.5, 2 for 0.25. */
export function stepDecimals(ticks: number[]): number {
  if (ticks.length < 2) return 0;
  const step = Math.abs(ticks[1] - ticks[0]);
  for (let d = 0; d < 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 6;
}

/** "A week ago", "3 days ago": the label for the start of the period. */
export function agoText(hass: HomeAssistant | undefined, period: Period): string {
  return period.last === 1
    ? localize(hass, `dumbbell_ago_${period.unit}_one`)
    : localize(hass, `dumbbell_ago_${period.unit}`, { n: period.last });
}

const MARK_COLORS: Record<Exclude<MarkKind, 'now'>, string> = {
  low: baseColor('blue'),
  high: baseColor('red'),
  then: baseColor('grey'),
  target: 'var(--primary-text-color, #212121)',
};

/** Hollow rings: range's current value, and a target. */
function hollow(kind: MarkKind, ends: Ends): boolean {
  return kind === 'target' || (kind === 'now' && ends === 'range');
}

function markColor(kind: MarkKind, ends: Ends, e: ResolvedEntity): string {
  if (kind !== 'now') return MARK_COLORS[kind];
  return ends === 'range' ? 'var(--primary-text-color, #212121)' : baseColor(e.band.color);
}

const DEFAULTS = { ends: 'range' as Ends, orientation: 'horizontal' as Orientation, showNow: true };

function optionsOf(raw: CardConfig) {
  return {
    ends: (raw.ends as Ends | undefined) ?? DEFAULTS.ends,
    orientation: (raw.orientation as Orientation | undefined) ?? DEFAULTS.orientation,
    showNow: raw.show_now === undefined ? DEFAULTS.showNow : raw.show_now === true,
  };
}

/** One unit for the axis when every entity shares it, else none. */
function sharedUnit(items: ResolvedEntity[]): string {
  const units = new Set(items.map((e) => e.unit).filter((u) => u !== ''));
  return units.size === 1 ? [...units][0] : '';
}

function legend(ctx: ChartContext, ends: Ends, showNow: boolean, rows: DumbbellRow[], period: Period, unit: string) {
  const t = (k: string) => localize(ctx.hass, k);
  const bands = new Set(rows.map((r) => baseColor(r.entity.band.color)));
  const nowFill = bands.size === 1 ? [...bands][0] : baseColor('primary');
  const items: [string, string, boolean][] =
    ends === 'range'
      ? [
          [t('dumbbell_low'), MARK_COLORS.low, false],
          ...(showNow
            ? [[t('dumbbell_now'), markColor('now', ends, rows[0].entity), true] as [string, string, boolean]]
            : []),
          [t('dumbbell_high'), MARK_COLORS.high, false],
        ]
      : [
          ends === 'then'
            ? [agoText(ctx.hass, period), MARK_COLORS.then, false]
            : [t('dumbbell_target'), MARK_COLORS.target, true],
          [t('dumbbell_now'), nowFill, false],
        ];
  return html`<div class="db-legend">
    ${unit ? html`<span class="db-unit">${unit}</span>` : nothing}
    ${items.map(
      ([text, color, ring]) =>
        html`<span class="db-key"
          ><span class="db-swatch ${ring ? 'ring' : ''}" style="--mark:${color}"></span>${text}</span
        >`,
    )}
  </div>`;
}

function describe(row: DumbbellRow, ctx: ChartContext, period: Period): string {
  const e = row.entity;
  if (row.marks.length === 0) return `${e.name}, ${e.available ? localize(ctx.hass, 'dumbbell_no_value') : e.display}`;
  const name = (k: MarkKind) => (k === 'then' ? agoText(ctx.hass, period) : localize(ctx.hass, `dumbbell_${k}`));
  const parts = row.marks.map(
    (m) => `${name(m.kind)} ${withUnit(formatNumber(m.value, e.decimals, ctx.hass), e.unit)}`,
  );
  return `${e.name}: ${parts.join(', ')}`;
}

function renderRow(
  row: DumbbellRow,
  ctx: ChartContext,
  ends: Ends,
  at: (v: number) => number,
  ticks: number[],
  period: Period,
): TemplateResult {
  const e = row.entity;
  const { show } = ctx.config;
  // The labelled ends: low and high in range mode, so a current value equal to one of them
  // doesn't take over the bar's colour.
  const lo = row.labelled[0];
  const hi = row.labelled[row.labelled.length - 1];
  const fill = (m: Mark) =>
    hollow(m.kind, ends)
      ? 'color-mix(in srgb, var(--primary-text-color, #212121) 30%, transparent)'
      : markColor(m.kind, ends, e);
  return html`<div
    class="entity db-row ${e.available ? '' : 'unavailable'}"
    data-index=${row.index}
    tabindex="0"
    role="img"
    aria-label=${describe(row, ctx, period)}
  >
    ${show.name ? html`<span class="db-name">${e.name}</span>` : nothing}
    <div class="db-plot">
      ${ticks.map((v) => html`<span class="db-grid" style="--f:${at(v)}"></span>`)}
      ${
        row.marks.length === 0
          ? html`<span class="db-status value">${e.available ? '–' : e.display}</span>`
          : html`${
              row.labelled.length > 1
                ? html`<span
                    class="db-bar"
                    style="--a:${at(lo.value)};--b:${at(hi.value)};--from:${fill(lo)};--to:${fill(hi)}"
                  ></span>`
                : nothing
            }
            ${row.marks.map(
              (m) =>
                html`<span
                  class="db-dot ${m.kind} ${hollow(m.kind, ends) ? 'ring' : ''}"
                  style="--f:${at(m.value)};--mark:${markColor(m.kind, ends, e)}"
                ></span>`,
            )}
            ${
              show.value
                ? row.labelled.map(
                    (m, i) =>
                      html`<span
                        class="db-label ${i === 0 && row.labelled.length > 1 ? 'lo' : 'hi'}"
                        style="--f:${at(m.value)}"
                        >${formatNumber(m.value, e.decimals, ctx.hass)}</span
                      >`,
                  )
                : nothing
            }`
      }
    </div>
  </div>`;
}

const FIELDS: FieldBinding[] = [
  ...ROLLING_HISTORY_FIELDS,
  { name: 'ends', path: ['ends'], default: DEFAULTS.ends },
  { name: 'show_now', path: ['show_now'], default: DEFAULTS.showNow },
  { name: 'orientation', path: ['orientation'], default: DEFAULTS.orientation },
];

export function dumbbellEditor(ctx: ChartEditorContext): TemplateResult {
  const { ends } = optionsOf(ctx.config);
  const schema = cachedSchema(`dumbbell-${ends}`, ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'ends', selector: choice(ctx.hass, 'ends', ENDS) },
        { name: 'orientation', selector: choice(ctx.hass, 'orientation', ORIENTATIONS) },
      ],
    },
    // A target needs no history.
    ...(ends === 'target' ? [] : rollingHistorySchema(ctx.hass)),
    ...(ends === 'range' ? [{ name: 'show_now', selector: { boolean: {} } }] : []),
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS);
}

export const dumbbell: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 220,
  styles: css`
    ${frameStyles}
    .db {
      --pad: 40px;
      --span: calc(100% - 2 * var(--pad));
      --dot: 14px;
      display: flex;
      flex-direction: column;
    }
    .db.no-values {
      --pad: 12px;
    }
    .db-legend {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 4px 14px;
      padding: 2px 0 6px;
      font-size: 0.8125em;
      color: var(--secondary-text-color);
    }
    .db-unit {
      margin-right: auto;
    }
    /* Narrow cards: every other tick label, so they don't run together. */
    @container (max-width: 400px) {
      .db.horizontal .db-tick:nth-child(even) {
        visibility: hidden;
      }
    }
    .db-key {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .db-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--mark);
      box-sizing: border-box;
    }
    .db-swatch.ring,
    .db-dot.ring {
      background: var(--card-background-color, #fff);
      border: 2.5px solid var(--mark);
    }
    .db-row {
      position: relative;
      cursor: pointer;
      border-radius: 6px;
      outline: none;
    }
    .db-row:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
    }
    .db-name {
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .db-plot {
      position: relative;
    }
    .db-grid,
    .db-bar,
    .db-dot,
    .db-label,
    .db-tick {
      position: absolute;
    }
    .db-dot {
      width: var(--dot);
      height: var(--dot);
      border-radius: 50%;
      background: var(--mark);
      box-sizing: border-box;
      z-index: 1;
    }
    .db-dot.now.ring {
      z-index: 2;
    }
    .db-label,
    .db-tick,
    .db-status {
      font-size: 0.8125em;
      color: var(--secondary-text-color);
      white-space: nowrap;
      line-height: 1;
    }
    .db-status {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .db-bar,
    .db-dot,
    .db-label {
      transition:
        left var(--cd-duration) var(--cd-easing),
        width var(--cd-duration) var(--cd-easing),
        bottom var(--cd-duration) var(--cd-easing),
        height var(--cd-duration) var(--cd-easing),
        opacity var(--cd-duration) var(--cd-easing);
    }
    :host(:not([ready])) .db-bar,
    :host(:not([ready])) .db-dot,
    :host(:not([ready])) .db-label {
      opacity: 0;
    }

    /* Rows: value across, one entity per row. */
    .db.horizontal .db-row {
      display: grid;
      grid-template-columns: var(--name-w) minmax(0, 1fr);
      align-items: center;
      column-gap: 8px;
      height: 36px;
    }
    .db.horizontal.no-names .db-row,
    .db.horizontal.no-names .db-axis {
      grid-template-columns: minmax(0, 1fr);
    }
    .db.horizontal .db-plot {
      height: 100%;
    }
    .db.horizontal .db-grid {
      top: 0;
      bottom: 0;
      left: calc(var(--pad) + var(--span) * var(--f));
      border-left: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .db.horizontal .db-bar {
      top: 50%;
      height: 6px;
      transform: translateY(-50%);
      border-radius: 3px;
      left: calc(var(--pad) + var(--span) * var(--a));
      width: calc(var(--span) * (var(--b) - var(--a)));
      background: linear-gradient(to right, var(--from), var(--to));
      opacity: 0.45;
    }
    .db.horizontal .db-dot {
      top: 50%;
      left: calc(var(--pad) + var(--span) * var(--f));
      transform: translate(-50%, -50%);
    }
    .db.horizontal .db-label {
      top: 50%;
      left: calc(var(--pad) + var(--span) * var(--f));
    }
    .db.horizontal .db-label.lo {
      transform: translate(calc(-100% - 11px), -50%);
    }
    .db.horizontal .db-label.hi {
      transform: translate(11px, -50%);
    }
    .db.horizontal .db-axis {
      display: grid;
      grid-template-columns: var(--name-w) minmax(0, 1fr);
      column-gap: 8px;
      height: 22px;
    }
    .db.horizontal .db-axis .db-plot {
      grid-column: -2;
    }
    .db.horizontal .db-tick {
      top: 6px;
      left: calc(var(--pad) + var(--span) * var(--f));
      transform: translateX(-50%);
    }

    /* Columns: value up, one entity per column. */
    .db.vertical .db-body {
      display: flex;
    }
    .db.vertical .db-row {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column-reverse;
      align-items: stretch;
    }
    .db.vertical .db-name {
      text-align: center;
      font-size: 0.8125em;
      padding-top: 4px;
      height: 1.4em;
    }
    .db.vertical .db-plot {
      height: 180px;
    }
    /* Columns are narrow and tall: status text runs up the column. */
    .db.vertical .db-status {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      overflow: hidden;
    }
    .db.vertical {
      --pad: 22px;
    }
    .db.vertical .db-grid {
      left: 0;
      right: 0;
      bottom: calc(var(--pad) + var(--span) * var(--f));
      border-top: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .db.vertical .db-bar {
      left: 50%;
      width: 6px;
      transform: translateX(-50%);
      border-radius: 3px;
      bottom: calc(var(--pad) + var(--span) * var(--a));
      height: calc(var(--span) * (var(--b) - var(--a)));
      background: linear-gradient(to top, var(--from), var(--to));
      opacity: 0.45;
    }
    .db.vertical .db-dot {
      left: 50%;
      bottom: calc(var(--pad) + var(--span) * var(--f));
      transform: translate(-50%, 50%);
    }
    .db.vertical .db-label {
      left: 50%;
      bottom: calc(var(--pad) + var(--span) * var(--f));
    }
    .db.vertical .db-label.lo {
      transform: translate(-50%, calc(100% + 11px));
    }
    .db.vertical .db-label.hi {
      transform: translate(-50%, -11px);
    }
    .db.vertical .db-axis {
      flex: none;
      position: relative;
      width: 3.5em;
      height: 180px;
    }
    .db.vertical .db-tick {
      right: 6px;
      bottom: calc(var(--pad) + var(--span) * var(--f));
      transform: translateY(50%);
    }
  `,
  thumbnail: () => svg`
    <line x1="14" y1="11" x2="44" y2="11" stroke="var(--primary-text-color, #212121)" stroke-opacity="0.25"
      stroke-width="3" stroke-linecap="round" />
    <line x1="8" y1="20" x2="34" y2="20" stroke="var(--primary-text-color, #212121)" stroke-opacity="0.25"
      stroke-width="3" stroke-linecap="round" />
    <line x1="22" y1="29" x2="56" y2="29" stroke="var(--primary-text-color, #212121)" stroke-opacity="0.25"
      stroke-width="3" stroke-linecap="round" />
    <circle cx="14" cy="11" r="4" fill="var(--info-color, #2f6fe4)" />
    <circle cx="44" cy="11" r="4" fill="var(--error-color, #ef3b5a)" />
    <circle cx="8" cy="20" r="4" fill="var(--info-color, #2f6fe4)" />
    <circle cx="34" cy="20" r="4" fill="var(--error-color, #ef3b5a)" />
    <circle cx="22" cy="29" r="4" fill="var(--info-color, #2f6fe4)" />
    <circle cx="56" cy="29" r="4" fill="var(--error-color, #ef3b5a)" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    if (raw.ends !== undefined && !ENDS.includes(raw.ends as Ends)) {
      throw new Error(`"ends" must be one of: ${ENDS.join(', ')}`);
    }
    if (raw.orientation !== undefined && !ORIENTATIONS.includes(raw.orientation as Orientation)) {
      throw new Error(`"orientation" must be one of: ${ORIENTATIONS.join(', ')}`);
    }
    if (raw.show_now !== undefined && typeof raw.show_now !== 'boolean') {
      throw new Error('"show_now" must be true or false');
    }
  },
  editor: dumbbellEditor,
  disconnect: disconnectHistory,
  render(ctx) {
    const { ends, orientation, showNow } = optionsOf(ctx.raw);
    const period = parsePeriod(ctx.raw.period as CardConfig['period']);
    let rows: DumbbellRow[];
    if (ends === 'target') {
      // Current values only: no history to load.
      rows = dumbbellRows(ctx.items, ends, () => [], 0, showNow);
    } else {
      const frame = historyFrame(ctx);
      if (frame.status !== 'ready') return frameMessage(frame, ctx) ?? html``;
      rows = dumbbellRows(ctx.items, ends, (i) => frame.series[i]?.points ?? [], frame.range.start, showNow);
    }
    const span = extentOf(rows.flatMap((r) => r.marks.map((m) => m.value)));
    const ticks = span ? niceTicks(span[0], span[1], 4) : [];
    const [d0, d1] = ticks.length ? [ticks[0], ticks[ticks.length - 1]] : [0, 1];
    const at = (v: number) => (d1 === d0 ? 0.5 : (v - d0) / (d1 - d0));
    const unit = sharedUnit(ctx.items);
    const decimals = stepDecimals(ticks);
    const { show } = ctx.config;
    const longest = Math.max(...ctx.items.map((e) => e.name.length));
    const nameW = `min(${Math.min(longest, 16) + 1}ch, 38%)`;
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_dumbbell'),
      names: ctx.items.map((e) => e.name).join(', '),
    });
    const tickLabels = ticks.map(
      (v) => html`<span class="db-tick" style="--f:${at(v)}">${formatNumber(v, decimals, ctx.hass)}</span>`,
    );
    const body = rows.map((row) => renderRow(row, ctx, ends, at, ticks, period));
    const classes = `db ${orientation} ${show.name ? '' : 'no-names'} ${show.value ? '' : 'no-values'}`;
    return html`<div class=${classes} style="--name-w:${nameW}" role="group" aria-label=${label}>
      ${span ? legend(ctx, ends, showNow, rows, period, unit) : nothing}
      ${
        orientation === 'horizontal'
          ? html`${body}
            ${ticks.length ? html`<div class="db-axis" aria-hidden="true"><div class="db-plot">${tickLabels}</div></div>` : nothing}`
          : html`<div class="db-body">
              ${ticks.length ? html`<div class="db-axis" aria-hidden="true">${tickLabels}</div>` : nothing}${body}
            </div>`
      }
    </div>`;
  },
};
