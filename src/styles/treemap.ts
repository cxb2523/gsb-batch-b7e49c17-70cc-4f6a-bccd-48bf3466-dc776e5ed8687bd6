import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor, onFillText } from '../bands';
import { SERIES_COLORS, shade } from '../chart/colors';
import { buildTree, groupPath, parseGroupBy, validateGroups } from '../chart/hierarchy';
import type { TreeNode } from '../chart/hierarchy';
import { drillBar, drillStyles, drillTarget, drillView, validateDrill } from '../chart/drill';
import { inset, squarify } from '../chart/treemap-layout';
import type { Rect } from '../chart/treemap-layout';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import { GROUP_FIELDS, HIERARCHY_LABELS, entityGroupsForm, groupBySchema, withGroupList } from '../editor/group-fields';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const TREEMAP_COLOR_BY = ['group', 'bands'] as const;
export type TreemapColorBy = (typeof TREEMAP_COLOR_BY)[number];

/** The drawing's height in px; its width follows the card. */
const HEIGHT = 240;
/** Width to lay out for until the card has been measured. */
const DEFAULT_WIDTH = 400;
/** A group's name strip, and the padding round its contents, in px. */
const HEAD = 22;
const PAD = 3;
/** Half the gap between neighbouring tiles. */
const GAP = 1.5;

export interface TreemapBox {
  node: TreeNode;
  rect: Rect;
  /** Colour key: the top-level group (or entity) it belongs to, as a series index. */
  series: number;
  /** Groups only: whether there was room for the name strip. */
  head?: boolean;
  /** Leaves only: its place among its group's leaves, largest first. */
  rank?: number;
}

/**
 * Lay out a tree in a `width` × `height` box: each group gets a rectangle sized by its total
 * (with a name strip on top when there is room), and its entities share what is left of it.
 * Nodes with nothing to show are left out. Each top-level node takes the next series colour, or
 * all of them `family` (drilled into a group, its parts keep its colour).
 */
export function treemapLayout(
  root: TreeNode,
  width: number,
  height: number,
  family?: number,
): { groups: TreemapBox[]; leaves: TreemapBox[] } {
  const groups: TreemapBox[] = [];
  const leaves: TreemapBox[] = [];
  const place = (node: TreeNode, rect: Rect, series: number, top: boolean) => {
    const shown = node.children.filter((c) => c.value > 0);
    const rects = squarify(
      shown.map((c) => c.value),
      rect,
    );
    shown.forEach((child, i) => {
      const r = rects[i];
      const s = top && family === undefined ? i : series;
      if (child.entity) {
        leaves.push({ node: child, rect: inset(r, GAP), series: s, rank: i });
        return;
      }
      const box = inset(r, GAP);
      const head = box.h >= HEAD * 2 && box.w >= 56;
      groups.push({ node: child, rect: box, series: s, head });
      const inner = inset(head ? { ...box, y: box.y + HEAD - PAD, h: box.h - HEAD + PAD } : box, PAD);
      place(child, inner, s, false);
    });
  };
  place(root, { x: 0, y: 0, w: width, h: height }, family ?? 0, true);
  return { groups, leaves };
}

/** The unit every item with a value shares, or undefined when they differ (a total would mean nothing). */
export function sharedUnit(items: ResolvedEntity[]): string | undefined {
  const units = new Set(items.filter((e) => e.available).map((e) => e.unit));
  return units.size === 1 ? [...units][0] : undefined;
}

/** A total in the unit the items share, with the decimals of the first one that has a value. */
export function totalText(value: number, ctx: ChartContext, unit: string): string {
  const decimals = ctx.items.find((e) => e.available)?.decimals ?? 1;
  return withUnit(formatNumber(value, decimals, ctx.hass), unit);
}

/** Each card's last measured drawing width, and the observers that keep it current. */
const widths = new WeakMap<HTMLElement, number>();
const observers = new WeakMap<HTMLElement, ResizeObserver>();

/** The width to lay out for, watching the card so a resize lays it out again. */
function measure(ctx: ChartContext): number {
  const host = ctx.host;
  if (!observers.has(host) && typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      const el = host.shadowRoot?.querySelector<HTMLElement>('.treemap');
      const w = el?.clientWidth ?? 0;
      if (w > 0 && Math.abs(w - (widths.get(host) ?? 0)) >= 1) {
        widths.set(host, w);
        ctx.requestUpdate();
      }
    });
    observer.observe(host);
    observers.set(host, observer);
  }
  return widths.get(host) ?? DEFAULT_WIDTH;
}

function forget(host: HTMLElement): void {
  observers.get(host)?.disconnect();
  observers.delete(host);
}

/** A colour name as given (palette name or CSS), for picking readable text on top. */
function leafColor(box: TreemapBox, colorBy: TreemapColorBy): string {
  const e = box.node.entity!;
  if (colorBy === 'bands') return e.band.color;
  const own = (e.config as { color?: unknown }).color;
  return typeof own === 'string' && own ? own : SERIES_COLORS[box.series % SERIES_COLORS.length];
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function position(rect: Rect, width: number): string {
  return `left:${pct(rect.x, width)};top:${pct(rect.y, HEIGHT)};width:${pct(rect.w, width)};height:${pct(rect.h, HEIGHT)}`;
}

function leaf(
  box: TreemapBox,
  ctx: ChartContext,
  width: number,
  colorBy: TreemapColorBy,
  total: number,
): TemplateResult {
  const e = box.node.entity!;
  const name = leafColor(box, colorBy);
  // Later tiles in a group fade a little, so neighbours read apart; never so far that the
  // text colour chosen for the full colour stops being readable.
  const fill =
    colorBy === 'group' && box.node.path.length
      ? shade(baseColor(name), Math.max(70, 100 - 12 * (box.rank ?? 0)))
      : baseColor(name);
  const text = onFillText(name);
  const { w, h } = box.rect;
  const { show } = ctx.config;
  const big = w >= 120 && h >= 70 && e.value !== null && e.value >= total * 0.25;
  const labels = h >= 20 && w >= 44;
  const value = show.value && h >= 36;
  return html`<div
    class="entity tile text-${text} ${big ? 'big' : ''}"
    data-index=${box.node.index}
    tabindex="0"
    role="img"
    aria-label=${e.label}
    title=${e.label}
    style="${position(box.rect, width)};background:${fill}"
  >
    ${labels && show.name ? html`<span class="tile-name">${e.name}</span>` : nothing}
    ${labels && value ? html`<span class="tile-value">${e.display}</span>` : nothing}
  </div>`;
}

function group(box: TreemapBox, ctx: ChartContext, width: number, colorBy: TreemapColorBy, unit: string | undefined) {
  const color = baseColor(SERIES_COLORS[box.series % SERIES_COLORS.length]);
  const total = unit === undefined ? '' : totalText(box.node.value, ctx, unit);
  const target = drillTarget(ctx, box.node, total ? `${box.node.name}, ${total}` : box.node.name);
  return html`<div
    class="group ${target ? 'drillable' : ''}"
    style="${position(box.rect, width)};background:${colorBy === 'bands' ? 'var(--cd-track)' : shade(color, 14)}"
    role=${target ? 'button' : nothing}
    tabindex=${target ? 0 : nothing}
    aria-label=${target?.label ?? nothing}
    data-path=${box.node.path.join('/')}
    @click=${target?.click}
    @keydown=${target?.keydown}
  >
    ${
      box.head
        ? html`<div class="group-head">
            <span class="group-name">${box.node.name}</span>
            ${ctx.config.show.value && total && box.rect.w >= 110 ? html`<span class="group-total">${total}</span>` : nothing}
          </div>`
        : nothing
    }
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'treemap_color_by', path: ['color_by'], default: 'group' },
  ...GROUP_FIELDS,
  { name: 'drill_down', path: ['drill_down'], default: true },
];

export function treemapEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('treemap', ctx.hass, () => [
    { name: 'treemap_color_by', selector: choice(ctx.hass, 'treemap_color_by', TREEMAP_COLOR_BY) },
    groupBySchema(ctx.hass),
    { name: 'drill_down', selector: { boolean: {} } },
  ]);
  return html`${chartForm(withGroupList(ctx), 'chart', schema, FIELDS, HIERARCHY_LABELS)} ${entityGroupsForm(ctx)}`;
}

/** The tree the card's entities make, with groups from `group_by` and their own `group`. */
export function treeFor(ctx: ChartContext): TreeNode {
  const levels = parseGroupBy(ctx.raw.group_by);
  const other = localize(ctx.hass, 'treemap_other');
  const paths = ctx.items.map((e) => groupPath(e, levels, ctx.hass, other));
  return buildTree(ctx.items, paths, '');
}

export const treemap: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 280,
  styles: css`
    ${drillStyles}
    .treemap-head {
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      gap: 8px;
      min-height: 20px;
      padding-bottom: 6px;
      color: var(--secondary-text-color);
      font-size: 0.875em;
    }
    .treemap {
      position: relative;
      height: ${HEIGHT}px;
    }
    .treemap .group,
    .treemap .tile {
      position: absolute;
      box-sizing: border-box;
      border-radius: 6px;
      overflow: hidden;
    }
    .treemap .group-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 6px;
      height: ${HEAD}px;
      padding: 3px 8px 0;
      box-sizing: border-box;
      font-size: 12px;
      white-space: nowrap;
    }
    .treemap .group-name {
      font-weight: 500;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .treemap .group-total {
      color: var(--secondary-text-color);
    }
    .treemap .tile {
      display: flex;
      flex-direction: column;
      padding: 5px 8px;
      gap: 1px;
      cursor: pointer;
      outline: none;
      opacity: 0;
      transform: scale(0.96);
      transition:
        opacity var(--cd-duration) var(--cd-easing),
        transform var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .treemap .tile {
      opacity: 1;
      transform: none;
    }
    :host([static]) .treemap .tile {
      transition: none;
    }
    .treemap .tile:focus-visible {
      box-shadow: inset 0 0 0 2px var(--primary-text-color);
    }
    .treemap .tile.text-light {
      color: #fff;
    }
    .treemap .tile.text-dark {
      color: rgba(0, 0, 0, 0.87);
    }
    .treemap .tile.text-theme {
      color: var(--primary-text-color);
    }
    .treemap .tile-name,
    .treemap .tile-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.25;
    }
    .treemap .tile-name {
      font-size: 13px;
      font-weight: 500;
    }
    .treemap .tile-value {
      font-size: 12px;
      opacity: 0.9;
    }
    .treemap .tile.big .tile-value {
      font-size: 22px;
      font-weight: 500;
      opacity: 1;
    }
    .treemap-message {
      display: flex;
      align-items: center;
      justify-content: center;
      height: ${HEIGHT}px;
      color: var(--secondary-text-color);
      font-size: 0.875em;
      text-align: center;
    }
    .treemap-missing {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      padding-top: 8px;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .treemap-missing .entity {
      cursor: pointer;
      border-radius: 4px;
    }
    .treemap-missing .entity:focus-visible {
      outline: 2px solid var(--primary-color);
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="4" width="28" height="32" rx="3" fill="var(--primary-color, #03a9f4)" />
    <rect x="34" y="4" width="26" height="17" rx="3" fill="var(--warning-color, #f59e0b)" />
    <rect x="34" y="23" width="14" height="13" rx="3" fill="var(--success-color, #43a047)" />
    <rect x="50" y="23" width="10" height="13" rx="3" fill="var(--success-color, #43a047)" opacity="0.7" />`,
  validate(raw: CardConfig) {
    validateGroups(raw);
    validateDrill(raw);
    if (raw.color_by !== undefined && !TREEMAP_COLOR_BY.includes(raw.color_by as TreemapColorBy)) {
      throw new Error(`"color_by" must be one of: ${TREEMAP_COLOR_BY.join(', ')}`);
    }
  },
  editor: treemapEditor,
  disconnect: forget,
  render(ctx) {
    const width = measure(ctx);
    const tree = treeFor(ctx);
    const view = drillView(ctx, tree);
    const root = view.node;
    const colorBy = (ctx.raw.color_by as TreemapColorBy | undefined) ?? 'group';
    const unit = sharedUnit(ctx.items);
    // Drilled in, the parts keep the colour their top-level group has on the whole map.
    const family = view.path.length
      ? tree.children.filter((c) => c.value > 0).findIndex((c) => c.name === view.path[0])
      : undefined;
    const { groups, leaves } = treemapLayout(root, width, HEIGHT, family);
    const noReading = ctx.items.map((e, index) => ({ e, index })).filter(({ e }) => !e.available);
    const sum = unit !== undefined && ctx.config.show.value && root.value > 0 ? totalText(root.value, ctx, unit) : '';
    const total = sum && !view.path.length ? localize(ctx.hass, 'treemap_total', { value: sum }) : '';
    const label = localize(ctx.hass, 'treemap_aria', {
      names: (root.children.length ? root.children : []).map((c) => c.name).join(', '),
    });
    const body = leaves.length
      ? html`<div class="treemap" role="img" aria-label=${label}>
          ${groups.map((g) => group(g, ctx, width, colorBy, unit))}
          ${leaves.map((l) => leaf(l, ctx, width, colorBy, root.value))}
        </div>`
      : html`<div class="treemap-message">${localize(ctx.hass, 'treemap_empty')}</div>`;
    return html`${drillBar(ctx, tree, view, sum)}
    ${total ? html`<div class="treemap-head"><span class="treemap-total">${total}</span></div>` : nothing} ${body}
    ${
      noReading.length
        ? html`<div class="treemap-missing">
            <span>${localize(ctx.hass, 'treemap_no_reading')}</span>
            ${noReading.map(
              ({ e, index }) =>
                html`<span class="entity" data-index=${index} tabindex="0" aria-label=${e.label}
                  >${e.name} (${e.display})</span
                >`,
            )}
          </div>`
        : nothing
    }`;
  },
};
