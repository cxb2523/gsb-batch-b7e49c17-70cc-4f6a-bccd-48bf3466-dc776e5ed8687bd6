import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor, onFillText } from '../bands';
import { SERIES_COLORS } from '../chart/colors';
import { chartWidth, stopChartWidth } from '../chart/grid';
import { groupPath, parseGroupBy, validateGroups } from '../chart/hierarchy';
import { marimekkoLayout } from '../chart/marimekko';
import type { MekkoCell, MekkoColumn, MekkoLayout, MekkoSegment, MekkoSort } from '../chart/marimekko';
import { textWidth } from '../chart/sankey';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import { GROUP_FIELDS, HIERARCHY_LABELS, groupBySchema, withGroupList } from '../editor/group-fields';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber } from '../format';
import { localize } from '../localize';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import { sharedUnit, totalText } from './treemap';

/** What each segment says when there is room: its share of the column, its value, both or nothing. */
export const MEKKO_LABELS = ['percent', 'value', 'both', 'none'] as const;
export type MekkoLabels = (typeof MEKKO_LABELS)[number];

/** The plot's height in px; its width follows the card. */
const HEIGHT = 200;
/** Space between columns, in px. */
const GAP = 3;
/** Label font size, px. */
const FONT = 11;
/** Smallest segment that gets a label, px. */
const LABEL_H = 18;

type MekkoEntity = { group?: unknown; category?: unknown; color?: unknown };

/**
 * The card's entities as cells: their column from `group` or `group_by`, their colour from
 * `category`. Cells come in the order the entities are listed (matched ones last) even when the
 * card sorts them, so categories stack the same way however the values move.
 */
export function cellsOf(ctx: ChartContext): MekkoCell[] {
  const levels = parseGroupBy(ctx.raw.group_by);
  const other = localize(ctx.hass, 'treemap_other');
  const listed = (i: number) => {
    const at = ctx.config.entities.indexOf(ctx.items[i].config);
    return at < 0 ? Infinity : at;
  };
  const cells = ctx.items.map((e, index) => {
    const own = e.config as MekkoEntity;
    const path = groupPath(e, levels, ctx.hass, other);
    const category = typeof own.category === 'string' && own.category.trim() ? own.category.trim() : e.name;
    return { index, group: path.length ? path.join(' / ') : other, category, value: e.available ? e.value : null };
  });
  return cells.sort((a, b) => listed(a.index) - listed(b.index) || a.index - b.index);
}

/** Each category's colour: the first own `color` among its entities, else the next series colour. */
export function categoryColors(layout: MekkoLayout, own: (index: number) => string | undefined): string[] {
  return layout.categories.map((name, i) => {
    for (const col of layout.columns) {
      for (const s of col.segments) {
        const c = s.cell.category === name ? own(s.cell.index) : undefined;
        if (c) return c;
      }
    }
    return SERIES_COLORS[i % SERIES_COLORS.length];
  });
}

/** The text inside a segment, or '' when it would not fit. */
export function segmentText(s: MekkoSegment, width: number, mode: MekkoLabels, percent: string, value: string): string {
  if (mode === 'none' || s.h < LABEL_H) return '';
  const fits = (t: string) => textWidth(t, FONT) <= width - 6;
  if (mode === 'percent') return fits(percent) ? percent : '';
  if (mode === 'value') return fits(value) ? value : '';
  const both = `${percent} · ${value}`;
  if (fits(both)) return both;
  return fits(percent) ? percent : '';
}

const pct = (v: number, of: number) => `${of > 0 ? (v / of) * 100 : 0}%`;

function segment(
  s: MekkoSegment,
  col: MekkoColumn,
  ctx: ChartContext,
  width: number,
  colors: string[],
  mode: MekkoLabels,
): TemplateResult {
  const e = ctx.items[s.cell.index];
  const name = colors[s.category];
  const percent = `${formatNumber(s.share * 100, s.share > 0 && s.share < 0.01 ? 1 : 0, ctx.hass)}%`;
  const text = segmentText(s, col.w, mode, percent, e.display);
  const label = `${e.label} (${percent}, ${col.name})`;
  return html`<div
    class="entity segment text-${onFillText(name)}"
    data-index=${s.cell.index}
    tabindex="0"
    role="img"
    aria-label=${label}
    title=${`${col.name}, ${s.cell.category}: ${e.display} (${percent})`}
    style="left:${pct(col.x, width)};width:${pct(col.w, width)};top:${pct(s.y, HEIGHT)};height:${pct(s.h, HEIGHT)};background:${baseColor(name)}"
  >
    ${text ? html`<span class="segment-text">${text}</span>` : nothing}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'marimekko_segment_labels', path: ['segment_labels'], default: 'percent' },
  ...GROUP_FIELDS,
];

export function marimekkoEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('marimekko', ctx.hass, () => [
    { name: 'marimekko_segment_labels', selector: choice(ctx.hass, 'marimekko_segment_labels', MEKKO_LABELS) },
    groupBySchema(ctx.hass),
  ]);
  return chartForm(withGroupList(ctx), 'chart', schema, FIELDS, HIERARCHY_LABELS);
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'marimekko_group', path: ['group'], default: '' },
  { name: 'marimekko_category', path: ['category'], default: '' },
  { name: 'marimekko_color', path: ['color'] },
];
const ENTITY_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'marimekko_group', selector: { text: {} } },
      { name: 'marimekko_category', selector: { text: {} } },
    ],
  },
  { name: 'marimekko_color', selector: { text: {} } },
];

export function validateMarimekko(raw: CardConfig): void {
  validateGroups(raw);
  if (raw.segment_labels !== undefined && !MEKKO_LABELS.includes(raw.segment_labels as MekkoLabels)) {
    throw new Error(`"segment_labels" must be one of: ${MEKKO_LABELS.join(', ')}`);
  }
  (raw.entities ?? []).forEach((e, i) => {
    const category = typeof e === 'object' && e ? (e as MekkoEntity).category : undefined;
    if (category !== undefined && category !== null && typeof category !== 'string') {
      throw new Error(`Entity ${i + 1}: "category" must be text, such as "Heating"`);
    }
  });
}

function render(ctx: ChartContext): TemplateResult {
  const width = Math.max(120, chartWidth(ctx) - 32);
  const cells = cellsOf(ctx);
  const layout = marimekkoLayout(cells, width, HEIGHT, GAP, ctx.config.sort as MekkoSort);
  const mode = (ctx.raw.segment_labels as MekkoLabels | undefined) ?? 'percent';
  const { show } = ctx.config;
  const unit = sharedUnit(ctx.items);
  const noReading = ctx.items.map((e, index) => ({ e, index })).filter(({ e }) => !e.available);
  const missing = noReading.length
    ? html`<div class="mekko-missing">
        <span>${localize(ctx.hass, 'treemap_no_reading')}</span>
        ${noReading.map(
          ({ e, index }) =>
            html`<span class="entity" data-index=${index} tabindex="0" aria-label=${e.label}
              >${e.name} (${e.display})</span
            >`,
        )}
      </div>`
    : nothing;
  if (!layout.columns.length) {
    return html`<div class="chart-message">${localize(ctx.hass, 'treemap_empty')}</div>
      ${missing}`;
  }
  const colors = categoryColors(layout, (i) => {
    const c = (ctx.items[i].config as MekkoEntity).color;
    return typeof c === 'string' && c ? c : undefined;
  });
  const total = (col: MekkoColumn) => (unit === undefined ? '' : totalText(col.total, ctx, unit));
  const fit = (text: string, col: MekkoColumn) => textWidth(text, FONT) <= col.w + GAP;
  const describe = layout.columns.map((col) => (total(col) ? `${col.name} ${total(col)}` : col.name)).join(', ');
  const label = localize(ctx.hass, 'marimekko_aria', { columns: describe });
  const totals = show.value && unit !== undefined;
  return html`<div class="mekko-wrap">
    ${
      totals
        ? html`<div class="mekko-row mekko-totals" aria-hidden="true">
            ${layout.columns.map((col) =>
              fit(total(col), col)
                ? html`<span style="left:${pct(col.x, width)};width:${pct(col.w, width)}">${total(col)}</span>`
                : nothing,
            )}
          </div>`
        : nothing
    }
    <div class="mekko" role="img" aria-label=${label}>
      ${layout.columns.map((col) => col.segments.map((s) => segment(s, col, ctx, width, colors, mode)))}
    </div>
    ${
      show.name
        ? html`<div class="mekko-row mekko-names" aria-hidden="true">
            ${layout.columns.map((col) =>
              col.w >= 14
                ? html`<span style="left:${pct(col.x, width)};width:${pct(col.w, width)}" title=${col.name}
                    >${col.name}</span
                  >`
                : nothing,
            )}
          </div>`
        : nothing
    }
    ${
      layout.categories.length > 1
        ? html`<div class="mekko-legend" aria-hidden="true">
            ${layout.categories.map(
              (c, i) =>
                html`<span class="mekko-key"
                  ><span class="dot" style="background:${baseColor(colors[i])}"></span>${c}</span
                >`,
            )}
          </div>`
        : nothing
    }
    ${missing}
  </div>`;
}

export const marimekko: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 290,
  styles: css`
    .mekko-wrap {
      position: relative;
    }
    .mekko {
      position: relative;
      height: ${HEIGHT}px;
    }
    .mekko .segment {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 0;
      border-bottom: 1.5px solid var(--card-background-color, var(--ha-card-background, #fff));
      cursor: pointer;
      outline: none;
      opacity: 0;
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .mekko .segment {
      opacity: 1;
    }
    :host([static]) .mekko .segment {
      transition: none;
    }
    .mekko .segment:hover {
      filter: brightness(1.08);
    }
    .mekko .segment:focus-visible {
      box-shadow: inset 0 0 0 2px var(--primary-text-color);
    }
    .mekko .segment.text-light {
      color: #fff;
    }
    .mekko .segment.text-dark {
      color: rgba(0, 0, 0, 0.87);
    }
    .mekko .segment.text-theme {
      color: var(--primary-text-color);
    }
    .mekko .segment-text {
      font-size: ${FONT}px;
      white-space: nowrap;
      pointer-events: none;
    }
    .mekko-row {
      position: relative;
      height: 18px;
      font-size: 11px;
    }
    .mekko-row span {
      position: absolute;
      top: 0;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 18px;
    }
    .mekko-totals {
      color: var(--secondary-text-color);
    }
    .mekko-names {
      margin-top: 2px;
      color: var(--primary-text-color);
      font-size: 12px;
    }
    .mekko-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      padding-top: 10px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .mekko-key {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .mekko-key .dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .mekko-missing {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      padding-top: 8px;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .mekko-missing .entity {
      cursor: pointer;
      border-radius: 4px;
    }
    .mekko-missing .entity:focus-visible {
      outline: 2px solid var(--primary-color);
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="4" width="24" height="14" fill="var(--primary-color, #03a9f4)" />
    <rect x="4" y="19" width="24" height="7" fill="var(--warning-color, #f59e0b)" />
    <rect x="4" y="27" width="24" height="9" fill="var(--success-color, #43a047)" />
    <rect x="30" y="4" width="16" height="8" fill="var(--primary-color, #03a9f4)" />
    <rect x="30" y="13" width="16" height="12" fill="var(--warning-color, #f59e0b)" />
    <rect x="30" y="26" width="16" height="10" fill="var(--success-color, #43a047)" />
    <rect x="48" y="4" width="12" height="20" fill="var(--primary-color, #03a9f4)" />
    <rect x="48" y="25" width="12" height="11" fill="var(--success-color, #43a047)" />`,
  validate: validateMarimekko,
  editor: marimekkoEditor,
  entityFields: () => ({ schema: ENTITY_SCHEMA, fields: ENTITY_FIELDS }),
  disconnect: stopChartWidth,
  render,
};
