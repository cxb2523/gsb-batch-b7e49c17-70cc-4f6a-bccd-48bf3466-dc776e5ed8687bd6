import { statisticsPeriod } from '../history/fetch';
import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { direction, extentOf, readingAt, relativeChange } from '../chart/compare';
import {
  SERIES_COLORS,
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  validateHistoryOptions,
} from '../chart/frame';
import type { HistoryFrame } from '../chart/frame';
import { padDomain } from '../chart/scale';
import { ROLLING_HISTORY_FIELDS, cachedSchema, chartForm, choice, rollingHistorySchema } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber } from '../format';
import { parsePeriod, rollingRange } from '../history/period';
import type { Period } from '../history/period';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartStyleModule } from './index';

export const MEASURES = ['value', 'change'] as const;
export const SLOPE_COLOR_BY = ['direction', 'group'] as const;
export const INCREASE = ['bad', 'good'] as const;
type Measure = (typeof MEASURES)[number];

/** Vertical room one label needs, px. */
const LABEL_GAP = 18;
/** Plot height: at least this, more when there are many entities. */
const MIN_PLOT_H = 160;

/**
 * Spread label centres apart so none are closer than `gap`, keeping their order and staying
 * within `lo`..`hi` where there is room. Returns the new positions in the input's order.
 */
export function spreadLabels(positions: number[], gap: number, lo: number, hi: number): number[] {
  const order = positions.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const ys = order.map((o) => Math.min(hi, Math.max(lo, o.y)));
  for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + gap);
  if (ys.length && ys[ys.length - 1] > hi) {
    ys[ys.length - 1] = hi;
    for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - gap);
  }
  // Too many to fit: start at the top and let the last ones run past the bottom.
  if (ys.length && ys[0] < lo) {
    ys[0] = lo;
    for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + gap);
  }
  const out = new Array<number>(positions.length);
  order.forEach((o, k) => (out[o.i] = ys[k]));
  return out;
}

const STATISTICS_MS = { '5minute': 300_000, hour: 3_600_000, day: 86_400_000, month: 31 * 86_400_000 };

/** The two values a slope joins, for one entity's points. */
export function slopeEnds(
  measure: Measure,
  points: { t: number; v: number | null }[],
  times: { start: number; middle: number },
  now: number | null,
  /** Statistics rows start on the hour (or day), just after the span starts: within this many ms,
   *  the first row stands in for the reading at the start. 0 for history. */
  slack = 0,
): [number | null, number | null] {
  const first = points.find((p) => p.v !== null);
  const start = readingAt(points, times.start) ?? (first && first.t - times.start <= slack ? first.v : null);
  if (measure === 'value') return [start, now];
  const middle = readingAt(points, times.middle);
  const before = start === null || middle === null ? null : middle - start;
  const after = middle === null || now === null ? null : now - middle;
  return [before, after];
}

/** The colour of a slope by which way it went: rises red unless a rise is good, flat grey. */
export function directionColor(from: number, to: number, increase: 'bad' | 'good'): string {
  const way = direction(from, to);
  if (way === 'flat') return 'grey';
  return (way === 'up') === (increase === 'bad') ? 'red' : 'green';
}

function periodText(hass: HomeAssistant | undefined, key: 'ago' | 'previous' | 'last', period: Period): string {
  const one = period.last === 1;
  const unit = localize(hass, `slope_unit_${period.unit}${one ? '' : '_other'}`);
  return localize(hass, one ? `slope_${key}_one` : `slope_${key}`, { n: period.last, unit });
}

/** "+12 %" / "−20 %", or '' when a percentage means nothing. */
function changeText(from: number, to: number, hass: HomeAssistant): string {
  const rel = relativeChange(from, to);
  if (rel === undefined) return '';
  const pct = Math.round(rel * 100);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(pct), 0, hass)} %`;
}

interface Row {
  index: number;
  entity: ResolvedEntity;
  from: number | null;
  to: number | null;
  color: string;
  group?: string;
}

function groupOf(e: ResolvedEntity): string | undefined {
  const g = (e.config as { group?: unknown }).group;
  return typeof g === 'string' && g.trim() !== '' ? g.trim() : undefined;
}

function rowsFor(frame: HistoryFrame, ctx: ChartContext, measure: Measure, times: { start: number; middle: number }) {
  const slack = frame.source === 'statistics' ? STATISTICS_MS[statisticsPeriod(frame.range)] : 0;
  const byGroup = ctx.raw.color_by === 'group';
  const increase = ctx.raw.increase === 'good' ? 'good' : 'bad';
  const groupColors = new Map<string, string>();
  const rows: Row[] = frame.series.map((s) => {
    const now = s.entity.available ? s.entity.value : null;
    const [from, to] = slopeEnds(measure, s.points, times, now, slack);
    const group = groupOf(s.entity);
    const own = (s.entity.config as { color?: string }).color;
    let color: string;
    if (byGroup) {
      const k = group ?? `#${s.index}`;
      if (!groupColors.has(k)) groupColors.set(k, SERIES_COLORS[groupColors.size % SERIES_COLORS.length]);
      color = own ?? groupColors.get(k)!;
    } else {
      color = from !== null && to !== null ? directionColor(from, to, increase) : 'grey';
    }
    return { index: s.index, entity: s.entity, from, to, color: baseColor(color), group };
  });
  return rows;
}

function legend(rows: Row[]): TemplateResult | typeof nothing {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.group && !seen.has(r.group)) seen.set(r.group, r.color);
  if (!seen.size) return nothing;
  return html`<div class="slope-legend">
    ${[...seen].map(
      ([name, color]) =>
        html`<span class="slope-legend-item"><span class="swatch" style="background:${color}"></span>${name}</span>`,
    )}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  ...ROLLING_HISTORY_FIELDS,
  { name: 'measure', path: ['measure'], default: 'value' },
  { name: 'color_by', path: ['color_by'], default: 'direction' },
  { name: 'increase', path: ['increase'], default: 'bad' },
];

const ENTITY_FIELDS: FieldBinding[] = [{ name: 'group', path: ['group'] }];

export const slope: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 230,
  styles: css`
    ${frameStyles}
    .style-slope .slope-head,
    .style-slope .slope-plot {
      --lw: min(36%, 180px);
    }
    .slope-head {
      display: grid;
      grid-template-columns: var(--lw) 1fr var(--lw);
      gap: 0 8px;
      padding: 4px 0 6px;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .slope-head .from {
      grid-column: 1;
      text-align: right;
    }
    .slope-head .to {
      grid-column: 3;
    }
    .slope-head .unit {
      grid-column: 2;
      text-align: center;
    }
    .slope-plot {
      position: relative;
      margin: 8px 0;
    }
    .slope-plot .axis {
      position: absolute;
      top: -6px;
      bottom: -6px;
      border-left: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .slope-plot .axis.from {
      left: calc(var(--lw) + 8px);
    }
    .slope-plot .axis.to {
      right: calc(var(--lw) + 8px);
    }
    .slope-plot .entity {
      position: absolute;
      inset: 0;
      pointer-events: none;
      outline: none;
      opacity: 1;
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host(:not([ready])) .slope-plot .entity {
      opacity: 0;
    }
    .slope-plot .entity > * {
      pointer-events: auto;
      cursor: pointer;
    }
    .slope-plot .entity:focus-visible .lbl {
      outline: 2px solid var(--primary-color);
      outline-offset: 1px;
      border-radius: 3px;
    }
    .slope-plot svg {
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(var(--lw) + 8px);
      right: calc(var(--lw) + 8px);
      width: calc(100% - 2 * var(--lw) - 16px);
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .slope-plot svg line {
      vector-effect: non-scaling-stroke;
      stroke-width: 3;
      stroke-linecap: round;
      pointer-events: stroke;
    }
    .slope-plot .dot {
      position: absolute;
      width: 10px;
      height: 10px;
      margin: -5px 0 0 -5px;
      border-radius: 50%;
    }
    .slope-plot .dot.from {
      left: calc(var(--lw) + 8px);
    }
    .slope-plot .dot.to {
      left: calc(100% - var(--lw) - 8px);
    }
    .slope-plot .lbl {
      position: absolute;
      transform: translateY(-50%);
      width: var(--lw);
      display: flex;
      gap: 4px;
      align-items: baseline;
      font-size: 0.875em;
      line-height: 1.2;
      white-space: nowrap;
      min-width: 0;
    }
    .slope-plot .lbl.from {
      left: 0;
      justify-content: flex-end;
    }
    .slope-plot .lbl.to {
      right: 0;
    }
    .slope-plot .lbl .name {
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .slope-plot .lbl .value {
      font-weight: 500;
      flex: none;
    }
    .slope-plot .lbl .pct {
      flex: none;
      padding-left: 2px;
      font-size: 0.9em;
    }
    /* Narrow cards: the change column would squeeze the names to nothing. */
    @container (max-width: 380px) {
      .slope-plot .lbl .pct {
        display: none;
      }
    }
    .slope-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      padding: 4px 0;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .slope-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  `,
  thumbnail: () => svg`
    <line x1="14" y1="28" x2="50" y2="10" stroke="var(--error-color, #ef3b5a)" stroke-width="2.5" stroke-linecap="round" />
    <line x1="14" y1="12" x2="50" y2="22" stroke="var(--success-color, #1fae7a)" stroke-width="2.5" stroke-linecap="round" />
    <line x1="14" y1="32" x2="50" y2="30" stroke="var(--error-color, #ef3b5a)" stroke-width="2.5" stroke-linecap="round" />
    ${[
      [14, 28],
      [50, 10],
      [14, 12],
      [50, 22],
      [14, 32],
      [50, 30],
    ].map(([x, y]) => svg`<circle cx=${x} cy=${y} r="3" fill="var(--primary-text-color, #212121)" />`)}`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    const check = (key: string, values: readonly string[]) => {
      if (raw[key] !== undefined && !values.includes(raw[key] as string)) {
        throw new Error(`"${key}" must be one of: ${values.join(', ')}`);
      }
    };
    check('measure', MEASURES);
    check('color_by', SLOPE_COLOR_BY);
    check('increase', INCREASE);
    for (const e of raw.entities ?? []) {
      const group = typeof e === 'object' && e ? (e as { group?: unknown }).group : undefined;
      if (group !== undefined && typeof group !== 'string') throw new Error('"group" must be text');
    }
  },
  editor(ctx) {
    const schema = cachedSchema('slope', ctx.hass, () => [
      ...rollingHistorySchema(ctx.hass),
      { name: 'measure', selector: choice(ctx.hass, 'measure', MEASURES) },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'color_by', selector: choice(ctx.hass, 'color_by', SLOPE_COLOR_BY) },
          { name: 'increase', selector: choice(ctx.hass, 'increase', INCREASE) },
        ],
      },
    ]);
    return chartForm(ctx, 'chart', schema, FIELDS);
  },
  entityFields: (hass) => ({
    schema: cachedSchema('slope-entity', hass, () => [{ name: 'group', selector: { text: {} } }]),
    fields: ENTITY_FIELDS,
  }),
  disconnect: disconnectHistory,
  render(ctx) {
    const now = Date.now();
    const period = parsePeriod(ctx.raw.period as CardConfig['period']);
    const measure: Measure = ctx.raw.measure === 'change' ? 'change' : 'value';
    // Change needs the period before this one too: load twice as far back.
    const frameCtx =
      measure === 'change'
        ? { ...ctx, raw: { ...ctx.raw, period: { last: period.last * 2, unit: period.unit } } }
        : ctx;
    const frame = historyFrame(frameCtx, now);
    const middle = rollingRange(period, now).start;
    const times = { start: frame.range.start, middle };
    const hass = ctx.hass;
    const fromText = measure === 'change' ? periodText(hass, 'previous', period) : periodText(hass, 'ago', period);
    const toText = measure === 'change' ? periodText(hass, 'last', period) : localize(hass, 'slope_now');
    if (frame.status !== 'ready') return html`${frameMessage(frame, ctx)}`;
    const rows = rowsFor(frame, ctx, measure, times);
    const values = rows.flatMap((r) => [r.from, r.to]);
    const ext = extentOf(values);
    if (!ext) return html`<div class="chart-message">${localize(hass, 'chart_no_data')}</div>`;
    const { show } = ctx.config;
    // Missing entities have no unit; they shouldn't stop the others sharing one.
    const units = new Set(rows.filter((r) => r.entity.stateObj).map((r) => r.entity.unit));
    const sharedUnit = units.size === 1 ? [...units][0] : undefined;
    const fmt = (r: Row, v: number) => {
      const n = formatNumber(v, r.entity.decimals, hass);
      return sharedUnit !== undefined || !r.entity.unit ? n : `${n} ${r.entity.unit}`;
    };

    const drawn = rows.filter((r) => r.from !== null || r.to !== null);
    const height = Math.max(MIN_PLOT_H, drawn.length * (LABEL_GAP + 4));
    const [lo, hi] = padDomain(ext, 0.06);
    const pad = LABEL_GAP / 2;
    const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (height - 2 * pad);
    const side = (pick: (r: Row) => number | null) => {
      const list = drawn.filter((r) => pick(r) !== null);
      const spread = spreadLabels(
        list.map((r) => y(pick(r)!)),
        LABEL_GAP,
        pad,
        height - pad,
      );
      return new Map(list.map((r, k) => [r, spread[k]]));
    };
    const leftY = side((r) => r.from);
    const rightY = side((r) => r.to);
    const noReading = localize(hass, 'slope_no_reading');

    const entity = (r: Row) => {
      const aria = localize(hass, 'slope_entity_aria', {
        name: r.entity.name,
        from: r.from === null ? noReading : fmt(r, r.from),
        to: r.to === null ? noReading : fmt(r, r.to),
      });
      const pct = show.value && r.from !== null && r.to !== null ? changeText(r.from, r.to, hass) : '';
      const name = (n: string) => (show.name ? html`<span class="name">${n}</span>` : nothing);
      return html`<div class="entity" data-index=${r.index} tabindex="0" role="img" aria-label=${aria}>
        ${
          r.from !== null && r.to !== null
            ? html`<svg viewBox="0 0 100 ${height}" preserveAspectRatio="none">
                <line x1="0" y1=${y(r.from)} x2="100" y2=${y(r.to)} stroke=${r.color}></line>
              </svg>`
            : nothing
        }
        ${
          r.from !== null
            ? html`<span class="dot from" style="top:${y(r.from)}px;background:${r.color}"></span>
                <span class="lbl from" style="top:${leftY.get(r)}px"
                  >${name(r.entity.name)}${show.value ? html`<span class="value">${fmt(r, r.from)}</span>` : nothing}</span
                >`
            : nothing
        }
        ${
          r.to !== null
            ? html`<span class="dot to" style="top:${y(r.to)}px;background:${r.color}"></span>
                <span class="lbl to" style="top:${rightY.get(r)}px"
                  >${show.value ? html`<span class="value">${fmt(r, r.to)}</span>` : nothing}${name(r.entity.name)}${
                    pct ? html`<span class="pct" style="color:${r.color}">${pct}</span>` : nothing
                  }</span
                >`
            : nothing
        }
      </div>`;
    };

    const label = localize(hass, 'chart_aria', {
      style: localize(hass, 'editor_style_slope'),
      names: rows.map((r) => r.entity.name).join(', '),
    });
    return html`<div class="slope-head">
        <span class="from">${fromText}</span>
        ${sharedUnit ? html`<span class="unit">${sharedUnit}</span>` : nothing}
        <span class="to">${toText}</span>
      </div>
      <div class="slope-plot" style="height:${height}px" role="group" aria-label=${label}>
        <div class="axis from"></div>
        <div class="axis to"></div>
        ${drawn.map(entity)}
      </div>
      ${ctx.raw.color_by === 'group' ? legend(rows) : nothing}`;
  },
};
