import { css, html, nothing, svg } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { baseColor, onFillText } from '../bands';
import { extentOf, withZero } from '../chart/compare';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig, HomeAssistant, SortMode } from '../types';
import { SERIES_COLORS } from '../chart/frame';

export const MODES = ['grouped', 'stacked', 'percent'] as const;
export type Mode = (typeof MODES)[number];
const COLOR_BY = ['series', 'bands'] as const;

/** Series colours in order, for entities without their own `color` (the line chart's order). */
/** Bar colours in order: the series colours every chart uses. */
export const BAR_COLORS = SERIES_COLORS;

/** Heights in px: one bar in grouped mode, the gap between a row's bars, a stacked bar, row padding. */
const BAR_H = 12;
const BAR_GAP = 3;
const STACK_H = 20;
const ROW_PAD = 8;
/** Percent mode labels a segment only when it is at least this share of the width. */
const MIN_LABEL_SHARE = 0.12;

/** One entity as the chart sees it, in config order. */
export interface BarInput {
  /** Index into the card's items, for actions. */
  index: number;
  group: string;
  series: string;
  value: number | null;
}

/** One drawn bar or stack segment, in value units (percent mode: share of the row, -1..1). */
export interface Segment {
  index: number;
  series: string;
  value: number | null;
  from: number;
  to: number;
  /** Grouped mode: which bar line in the row (0 = top). */
  slot: number;
}

export interface BarRow {
  key: string;
  label: string;
  segments: Segment[];
  /** Sum of the row's values, ignoring missing ones; null when none has a value. */
  total: number | null;
}

export interface BarLayout {
  rows: BarRow[];
  domain: [number, number];
  /** Series names in order of first appearance. */
  series: string[];
}

/**
 * Rows from entities: entities sharing a group share a row, in the order they first appear. Bars
 * run from zero; stacks put positives right of zero and negatives left, each in config order;
 * percent mode divides by the row's absolute total. Rows are then sorted by total, if asked.
 */
export function layoutBars(inputs: BarInput[], mode: Mode, sort: SortMode = 'none'): BarLayout {
  const rows = new Map<string, BarRow>();
  const series: string[] = [];
  for (const input of inputs) {
    let row = rows.get(input.group);
    if (!row) {
      row = { key: input.group, label: input.group, segments: [], total: null };
      rows.set(input.group, row);
    }
    if (!series.includes(input.series)) series.push(input.series);
    const slot = row.segments.length;
    row.segments.push({ index: input.index, series: input.series, value: input.value, from: 0, to: 0, slot });
    if (input.value !== null) row.total = (row.total ?? 0) + input.value;
  }
  const list = [...rows.values()];
  for (const row of list) {
    const absolute = row.segments.reduce((sum, s) => sum + Math.abs(s.value ?? 0), 0);
    let up = 0;
    let down = 0;
    for (const s of row.segments) {
      if (s.value === null) continue;
      const v = mode === 'percent' ? (absolute === 0 ? 0 : s.value / absolute) : s.value;
      if (mode === 'grouped') {
        s.to = v;
      } else if (v >= 0) {
        s.from = up;
        s.to = up += v;
      } else {
        s.from = down;
        s.to = down += v;
      }
    }
  }
  const ends = list.flatMap((r) => r.segments.flatMap((s) => (s.value === null ? [] : [s.from, s.to])));
  const domain = withZero(extentOf(ends) ?? [0, 1]);
  if (domain[0] === domain[1]) domain[1] = 1;
  if (sort !== 'none') {
    const dir = sort === 'ascending' ? 1 : -1;
    list.sort((a, b) => {
      if ((a.total === null) !== (b.total === null)) return a.total === null ? 1 : -1;
      return ((a.total ?? 0) - (b.total ?? 0)) * dir;
    });
  }
  return { rows: list, domain, series };
}

/** Height of one row in px: grouped rows grow with their bars. */
export function rowHeight(row: BarRow, mode: Mode): number {
  if (mode !== 'grouped') return STACK_H + 2 * ROW_PAD;
  const n = Math.max(1, row.segments.length);
  return n * BAR_H + (n - 1) * BAR_GAP + 2 * ROW_PAD;
}

/** The text an option holds, or undefined when blank or not text. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : undefined;
}

/** Items back in the order the card lists them, so rows and series don't move when one sorts. */
function configOrder(ctx: ChartContext): { e: ResolvedEntity; index: number }[] {
  const listed = ctx.config.entities;
  return ctx.items
    .map((e, index) => ({ e, index, at: listed.indexOf(e.config) }))
    .sort((a, b) => (a.at === -1 ? Infinity : a.at) - (b.at === -1 ? Infinity : b.at) || a.index - b.index);
}

function inputsFor(ctx: ChartContext): BarInput[] {
  return configOrder(ctx).map(({ e, index }) => {
    const own = e.config as typeof e.config & { group?: unknown; series?: unknown };
    return {
      index,
      // An entity without a row gets its own, keyed by position so a repeated id stays apart.
      group: text(own.group) ?? `\u0000${index}`,
      series: text(own.series) ?? '',
      value: e.available ? e.value : null,
    };
  });
}

function percent(share: number, hass: HomeAssistant): string {
  return `${formatNumber(Math.abs(share) * 100, 0, hass)} %`;
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export function validateBars(raw: CardConfig): void {
  if (raw.mode !== undefined && !MODES.includes(raw.mode as Mode)) {
    throw new Error(`"mode" must be one of: ${MODES.join(', ')}`);
  }
  if (raw.color_by !== undefined && !COLOR_BY.includes(raw.color_by as (typeof COLOR_BY)[number])) {
    throw new Error(`"color_by" must be one of: ${COLOR_BY.join(', ')}`);
  }
  (raw.entities ?? []).forEach((item, i) => {
    if (typeof item !== 'object' || item === null) return;
    for (const key of ['group', 'series'] as const) {
      const v = (item as unknown as Record<string, unknown>)[key];
      if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') {
        throw new Error(`Entity ${i + 1}: "${key}" must be text`);
      }
    }
  });
}

const BAR_FIELDS: FieldBinding[] = [
  { name: 'mode', path: ['mode'], default: 'grouped' },
  { name: 'bars_color_by', path: ['color_by'], default: 'series' },
];

export function barsEditor(ctx: ChartEditorContext) {
  const schema = cachedSchema('grouped_bars', ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'mode', selector: choice(ctx.hass, 'mode', MODES) },
        { name: 'bars_color_by', selector: choice(ctx.hass, 'bars_color_by', COLOR_BY) },
      ],
    },
  ]);
  return chartForm(ctx, 'chart', schema, BAR_FIELDS);
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'bar_group', path: ['group'] },
  { name: 'bar_series', path: ['series'] },
  { name: 'bar_color', path: ['color'] },
];

function renderBars(ctx: ChartContext) {
  const { hass } = ctx;
  const mode: Mode = (ctx.raw.mode as Mode | undefined) ?? 'grouped';
  const byBands = ctx.raw.color_by === 'bands';
  const layout = layoutBars(inputsFor(ctx), mode, ctx.config.sort);
  const [lo, hi] = layout.domain;
  const x = (v: number) => (v - lo) / (hi - lo);
  const zero = x(0);
  const colorOf = (s: Segment) => {
    const e = ctx.items[s.index];
    const own = (e.config as { color?: unknown }).color;
    if (byBands) return e.band.color;
    if (typeof own === 'string' && own) return own;
    return BAR_COLORS[layout.series.indexOf(s.series) % BAR_COLORS.length];
  };
  const { show } = ctx.config;
  const showLegend = !byBands && layout.series.some((s) => s !== '') && ctx.raw.show?.legend !== false;
  // Room either side of the bars for value labels, as wide as the longest one.
  const valueTexts = ctx.items.map((e) => e.display.length);
  const valueCh = show.value && mode !== 'percent' ? Math.min(12, Math.max(4, ...valueTexts)) : 0;
  // Value labels are 11 px text: about 6.5 px a character, plus their padding.
  const valuePx = valueCh ? Math.round(valueCh * 6.5 + 8) : 4;
  const nameCh = Math.max(
    0,
    ...layout.rows.map((r) => (r.label.startsWith('\u0000') ? ctx.items[r.segments[0].index].name : r.label).length),
  );
  let offset = 0;
  const placed = layout.rows.map((row) => {
    const top = offset;
    offset += rowHeight(row, mode);
    return { row, top };
  });
  const label = localize(hass, 'grouped_bars_aria', { names: ctx.items.map((e) => e.name).join(', ') });

  const segment = (s: Segment) => {
    const e = ctx.items[s.index];
    const color = colorOf(s);
    const left = x(Math.min(s.from, s.to));
    const width = Math.abs(x(s.to) - x(s.from));
    const top = mode === 'grouped' ? ROW_PAD + s.slot * (BAR_H + BAR_GAP) : ROW_PAD;
    const height = mode === 'grouped' ? BAR_H : STACK_H;
    const negative = s.to < s.from || (mode === 'grouped' && s.to < 0);
    const share = mode === 'percent' && e.available ? s.to - s.from : 0;
    const inside = mode === 'percent' && show.value && Math.abs(share) >= MIN_LABEL_SHARE;
    return html`<div
        class="entity bar-seg ${negative ? 'negative' : ''} ${e.available ? '' : 'unavailable'}"
        data-index=${s.index}
        tabindex="0"
        role="button"
        aria-label=${mode === 'percent' && e.available ? `${e.label} (${percent(share, hass)})` : e.label}
        style="left:${pct(left)};width:${pct(width)};top:${top}px;height:${height}px;background:${baseColor(color)}"
      >
        ${
          inside
            ? html`<span class="seg-text ${onFillText(color)}" aria-hidden="true">${percent(share, hass)}</span>`
            : nothing
        }
      </div>
      ${
        mode === 'grouped' && show.value
          ? html`<span
              class="bar-value ${e.available ? '' : 'unavailable'} ${negative ? 'left' : ''}"
              style="${negative ? 'right' : 'left'}:${pct(negative ? 1 - x(s.to) : e.available ? x(s.to) : zero)};top:${top}px;height:${height}px"
              aria-hidden="true"
              >${e.display}</span
            >`
          : nothing
      }`;
  };

  const rowTotal = (row: BarRow) => {
    if (mode !== 'stacked' || !show.value) return nothing;
    const first = ctx.items[row.segments[0].index];
    const ends = row.segments.filter((s) => s.value !== null).map((s) => s.to);
    const right = Math.max(0, ...ends);
    const left = Math.min(0, ...ends);
    const onLeft = right === 0 && left < 0;
    const textOut =
      row.total === null ? first.display : withUnit(formatNumber(row.total, first.decimals, hass), first.unit);
    return html`<span
      class="bar-value total ${row.total === null ? 'unavailable' : ''} ${onLeft ? 'left' : ''}"
      style="${onLeft ? 'right' : 'left'}:${pct(onLeft ? 1 - x(left) : x(right))};top:${ROW_PAD}px;height:${STACK_H}px"
      aria-hidden="true"
      >${textOut}</span
    >`;
  };

  const negatives = lo < 0;
  return html`<div
    class="bars mode-${mode}"
    role="img"
    aria-label=${label}
    style="--name-w:${show.name ? `min(35%, calc(${nameCh}ch + 16px))` : '0px'};--value-w:${valuePx}px;--neg-w:${negatives ? valuePx : 0}px"
  >
    <div class="bar-rows" style="height:${offset}px">
      ${repeat(
        placed,
        (p) => p.row.key,
        ({ row, top }) =>
          html`<div class="bar-row" style="transform:translateY(${top}px);height:${rowHeight(row, mode)}px">
            ${
              show.name
                ? html`<div class="row-name">
                    ${row.label.startsWith('\u0000') ? ctx.items[row.segments[0].index].name : row.label}
                  </div>`
                : nothing
            }
            <div class="row-plot">
              <div class="zero" style="left:${pct(zero)}"></div>
              ${row.segments.map((s) => segment(s))} ${rowTotal(row)}
            </div>
          </div>`,
      )}
    </div>
    ${
      showLegend
        ? html`<div class="bar-legend">
            ${layout.series
              .filter((s) => s !== '')
              .map((s) => {
                const first = placedSegment(layout, s);
                return html`<span class="bar-legend-item"
                  ><span class="swatch" style="background:${baseColor(first ? colorOf(first) : 'grey')}"></span
                  >${s}</span
                >`;
              })}
          </div>`
        : nothing
    }
  </div>`;
}

/** The first segment of a series, whose colour the legend shows. */
function placedSegment(layout: BarLayout, series: string): Segment | undefined {
  for (const row of layout.rows) for (const s of row.segments) if (s.series === series) return s;
  return undefined;
}

export const groupedBars: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 200,
  styles: css`
    .bars {
      padding: 4px 0;
    }
    .bar-rows {
      position: relative;
      transition: height var(--cd-duration) var(--cd-easing);
    }
    .bar-row {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      display: flex;
      align-items: center;
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    .row-name {
      flex: none;
      width: var(--name-w);
      padding-right: 8px;
      box-sizing: border-box;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875em;
    }
    .row-plot {
      position: relative;
      flex: 1;
      min-width: 0;
      align-self: stretch;
      margin: 0 var(--value-w) 0 var(--neg-w);
    }
    .bars .zero {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .bar-seg {
      position: absolute;
      box-sizing: border-box;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      transform-origin: left center;
      transition:
        left var(--cd-duration) var(--cd-easing),
        width var(--cd-duration) var(--cd-easing),
        transform var(--cd-duration) var(--cd-easing);
    }
    .bar-seg.negative {
      transform-origin: right center;
    }
    .mode-stacked .bar-seg,
    .mode-percent .bar-seg {
      border-radius: 2px;
      border-right: 1px solid var(--card-background-color, #fff);
    }
    :host(:not([ready])) .bar-seg {
      transform: scaleX(0);
    }
    .bar-seg:focus-visible {
      outline: 2px solid var(--primary-text-color);
      outline-offset: 1px;
    }
    .seg-text {
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      color: #fff;
      pointer-events: none;
    }
    .seg-text.dark {
      color: rgba(0, 0, 0, 0.8);
    }
    .seg-text.theme {
      color: var(--primary-text-color);
    }
    .bar-value {
      position: absolute;
      display: flex;
      align-items: center;
      padding: 0 4px;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      color: var(--primary-text-color);
      transition:
        left var(--cd-duration) var(--cd-easing),
        right var(--cd-duration) var(--cd-easing);
    }
    .bar-value.unavailable {
      color: var(--secondary-text-color);
    }
    .bar-value.total {
      font-size: 12px;
      font-weight: 500;
    }
    :host([static]) .bar-row,
    :host([static]) .bar-rows,
    :host([static]) .bar-value {
      transition: none;
    }
    .bar-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      padding-top: 8px;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .bar-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bar-legend .swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="6" width="40" height="5" rx="2" fill="var(--primary-color, #03a9f4)" />
    <rect x="4" y="12" width="30" height="5" rx="2" fill="var(--warning-color, #f59e0b)" />
    <rect x="4" y="23" width="22" height="5" rx="2" fill="var(--primary-color, #03a9f4)" />
    <rect x="4" y="29" width="34" height="5" rx="2" fill="var(--warning-color, #f59e0b)" />
    <line x1="4" y1="3" x2="4" y2="37" stroke="var(--secondary-text-color, #727272)" stroke-width="1" />`,
  validate: validateBars,
  editor: barsEditor,
  entityFields: (hass) => ({
    schema: cachedSchema('grouped_bars_entity', hass, () => [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'bar_group', selector: { text: {} } },
          { name: 'bar_series', selector: { text: {} } },
        ],
      },
      { name: 'bar_color', selector: { text: {} } },
    ]),
    fields: ENTITY_FIELDS,
  }),
  render: renderBars,
};
