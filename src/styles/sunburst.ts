import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor, onFillText } from '../bands';
import { SERIES_COLORS, shade } from '../chart/colors';
import { buildTree, groupPath, parseGroupBy, partition, treeHeight, validateGroups } from '../chart/hierarchy';
import type { Span, TreeNode } from '../chart/hierarchy';
import { drillBar, drillStyles, drillTarget, drillView, validateDrill } from '../chart/drill';
import { sectorPath } from '../chart/polar';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import { GROUP_FIELDS, HIERARCHY_LABELS, entityGroupsForm, groupBySchema, withGroupList } from '../editor/group-fields';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const SUNBURST_SHAPES = ['full', 'half'] as const;
export type SunburstShape = (typeof SUNBURST_SHAPES)[number];
export const HIERARCHY_COLOR_BY = ['group', 'bands'] as const;
export type HierarchyColorBy = (typeof HIERARCHY_COLOR_BY)[number];

/** Drawing height in px; the sunburst's radius and hole, in SVG units (≈ px). */
const HEIGHT = 240;
const RADIUS = 112;
const HOLE = 40;

/** How strong each level's colour is: the first ring full, deeper ones fading. */
export function levelStrength(level: number): number {
  return Math.max(45, 100 - (level - 1) * 20);
}

/** The tree the card's entities make, with groups from `group_by` and their own `group`. */
export function hierarchyTree(ctx: ChartContext): TreeNode {
  const levels = parseGroupBy(ctx.raw.group_by);
  const other = localize(ctx.hass, 'hierarchy_other');
  const paths = ctx.items.map((e) => groupPath(e, levels, ctx.hass, other));
  return buildTree(ctx.items, paths, localize(ctx.hass, 'hierarchy_total'));
}

/** The unit every item with a value shares, or undefined when they differ. */
export function sharedUnit(items: ResolvedEntity[]): string | undefined {
  const units = new Set(items.filter((e) => e.available).map((e) => e.unit));
  return units.size === 1 ? [...units][0] : undefined;
}

export interface Painted {
  /** A colour ready for CSS. */
  fill: string;
  /** Text on top: from the colour as given, or the theme's own when the fill is faint. */
  text: 'light' | 'dark' | 'theme';
}

/**
 * Each node's colour. A top-level node takes the next series colour (an entity's own `color`
 * wins) and passes it down, fading with depth; by bands, entities take their band's colour and
 * groups a neutral grey.
 */
export function paintSpans(spans: Span[], colorBy: HierarchyColorBy): Map<TreeNode, Painted> {
  const painted = new Map<TreeNode, Painted>();
  const family = new Map<TreeNode, string>();
  let next = 0;
  for (const { node, level } of spans) {
    if (level === 0) continue;
    const own = node.entity ? (node.entity.config as { color?: unknown }).color : undefined;
    let name: string;
    if (level === 1) name = typeof own === 'string' && own ? own : SERIES_COLORS[next++ % SERIES_COLORS.length];
    else name = family.get(node) ?? 'grey';
    for (const child of node.children) family.set(child, name);
    if (colorBy === 'bands') {
      painted.set(
        node,
        node.entity
          ? { fill: baseColor(node.entity.band.color), text: onFillText(node.entity.band.color) }
          : { fill: 'var(--cd-track)', text: 'theme' },
      );
      continue;
    }
    const strength = levelStrength(level);
    painted.set(node, {
      fill: shade(baseColor(name), strength),
      text: strength >= 100 ? onFillText(name) : 'theme',
    });
  }
  return painted;
}

function totalText(value: number, ctx: ChartContext, unit: string): string {
  const decimals = ctx.items.find((e) => e.available)?.decimals ?? 1;
  return withUnit(formatNumber(value, decimals, ctx.hass), unit);
}

/** A node's text for screen readers and tooltips: "Kitchen, 1.8 kW" or the entity's own. */
function nodeLabel(node: TreeNode, ctx: ChartContext, unit: string | undefined): string {
  if (node.entity) return node.entity.label;
  return unit === undefined ? node.name : `${node.name}, ${totalText(node.value, ctx, unit)}`;
}

/** Entities with no number, listed under the chart so they can still be tapped. */
function noReading(ctx: ChartContext): TemplateResult | typeof nothing {
  const list = ctx.items.map((e, index) => ({ e, index })).filter(({ e }) => !e.available);
  if (!list.length) return nothing;
  return html`<div class="hierarchy-missing">
    <span>${localize(ctx.hass, 'hierarchy_no_reading')}</span>
    ${list.map(
      ({ e, index }) =>
        html`<span class="entity" data-index=${index} tabindex="0" aria-label=${e.label}
          >${e.name} (${e.display})</span
        >`,
    )}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'hierarchy_color_by', path: ['color_by'], default: 'group' },
  ...GROUP_FIELDS,
  { name: 'drill_down', path: ['drill_down'], default: true },
];
const SUNBURST_FIELDS: FieldBinding[] = [{ name: 'sunburst_shape', path: ['shape'], default: 'full' }, ...FIELDS];

export function sunburstEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('sunburst', ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'sunburst_shape', selector: choice(ctx.hass, 'sunburst_shape', SUNBURST_SHAPES) },
        { name: 'hierarchy_color_by', selector: choice(ctx.hass, 'hierarchy_color_by', HIERARCHY_COLOR_BY) },
      ],
    },
    groupBySchema(ctx.hass),
    { name: 'drill_down', selector: { boolean: {} } },
  ]);
  return html`${chartForm(withGroupList(ctx), 'chart', schema, SUNBURST_FIELDS, HIERARCHY_LABELS)}
  ${entityGroupsForm(ctx)}`;
}

export function icicleEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('icicle', ctx.hass, () => [
    { name: 'hierarchy_color_by', selector: choice(ctx.hass, 'hierarchy_color_by', HIERARCHY_COLOR_BY) },
    groupBySchema(ctx.hass),
    { name: 'drill_down', selector: { boolean: {} } },
  ]);
  return html`${chartForm(withGroupList(ctx), 'chart', schema, FIELDS, HIERARCHY_LABELS)} ${entityGroupsForm(ctx)}`;
}

function validate(raw: CardConfig, shapes: boolean): void {
  validateGroups(raw);
  validateDrill(raw);
  if (raw.color_by !== undefined && !HIERARCHY_COLOR_BY.includes(raw.color_by as HierarchyColorBy)) {
    throw new Error(`"color_by" must be one of: ${HIERARCHY_COLOR_BY.join(', ')}`);
  }
  if (shapes && raw.shape !== undefined && !SUNBURST_SHAPES.includes(raw.shape as SunburstShape)) {
    throw new Error(`"shape" must be one of: ${SUNBURST_SHAPES.join(', ')}`);
  }
}

/** The pieces of one sunburst: where each ring starts and how far round it may go. */
export function sunburstGeometry(shape: SunburstShape, levels: number) {
  const ring = (RADIUS - HOLE) / Math.max(1, levels);
  return {
    start: shape === 'half' ? -Math.PI / 2 : 0,
    sweep: shape === 'half' ? Math.PI : Math.PI * 2,
    radii: (level: number): [number, number] => [HOLE + (level - 1) * ring, HOLE + level * ring],
    viewBox:
      shape === 'half'
        ? `${-RADIUS - 4} ${-RADIUS - 4} ${RADIUS * 2 + 8} ${RADIUS + 12}`
        : `${-RADIUS - 4} ${-RADIUS - 4} ${RADIUS * 2 + 8} ${RADIUS * 2 + 8}`,
  };
}

/** A group's ring segment: tappable to drill into it when drilling is on. */
function groupArc(ctx: ChartContext, node: TreeNode, label: string, d: string, fill: string) {
  const target = drillTarget(ctx, node, label);
  return svg`<path
    class="arc group ${target ? 'drillable' : ''}"
    data-path=${node.path.join('/')}
    role=${target ? 'button' : nothing}
    tabindex=${target ? 0 : nothing}
    aria-label=${target?.label ?? label}
    d=${d}
    fill=${fill}
    @click=${target?.click}
    @keydown=${target?.keydown}
  ><title>${label}</title></path>`;
}

/** The drawing for one tree root: a sunburst with the total in its middle, or a message. */
export function drawSunburst(ctx: ChartContext, root: TreeNode, tree: TreeNode = root) {
  if (root.value <= 0) return html`<div class="hierarchy-message">${localize(ctx.hass, 'hierarchy_empty')}</div>`;
  const shape = (ctx.raw.shape as SunburstShape | undefined) ?? 'full';
  const colorBy = (ctx.raw.color_by as HierarchyColorBy | undefined) ?? 'group';
  const unit = sharedUnit(ctx.items);
  const spans = partition(root);
  // Colours come from the whole tree, so a group keeps its colour when drilled into.
  const painted = paintSpans(partition(tree), colorBy);
  const geo = sunburstGeometry(shape, treeHeight(root));
  const arcs = spans
    .filter((s) => s.level > 0)
    .map((s) => {
      const [r0, r1] = geo.radii(s.level);
      const d = sectorPath(r0, r1, geo.start + s.x0 * geo.sweep, geo.start + s.x1 * geo.sweep);
      const label = nodeLabel(s.node, ctx, unit);
      const fill = painted.get(s.node)!.fill;
      return s.node.entity
        ? svg`<path class="entity arc leaf" data-index=${s.node.index} tabindex="0" role="img"
            aria-label=${label} d=${d} fill=${fill}><title>${label}</title></path>`
        : groupArc(ctx, s.node, label, d, fill);
    });
  const total = unit !== undefined && ctx.config.show.value ? totalText(root.value, ctx, unit) : '';
  const names = root.children.filter((c) => c.value > 0).map((c) => c.name);
  return html`<div class="sunburst-wrap ${shape}">
    <svg
      class="sunburst"
      viewBox=${geo.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label=${localize(ctx.hass, 'sunburst_aria', { names: names.join(', ') })}
    >
      <g class="sunburst-grow">${arcs}</g>
    </svg>
    <div class="sunburst-centre">${total ? html`<span class="centre-value">${total}</span>` : nothing}</div>
  </div>`;
}

/** Top-level names and totals under a sunburst, so the colours mean something. */
export function sunburstLegend(
  ctx: ChartContext,
  root: TreeNode,
  tree: TreeNode = root,
): TemplateResult | typeof nothing {
  const colorBy = (ctx.raw.color_by as HierarchyColorBy | undefined) ?? 'group';
  const unit = sharedUnit(ctx.items);
  const painted = paintSpans(partition(tree), colorBy);
  const top = root.children.filter((c) => c.value > 0);
  return html`<div class="hierarchy-legend">
    ${top.map((node) => {
      const swatch = html`<span class="swatch" style="background:${painted.get(node)?.fill}"></span>`;
      const value =
        ctx.config.show.value && unit !== undefined
          ? html`<span class="legend-value">${totalText(node.value, ctx, unit)}</span>`
          : nothing;
      return node.entity
        ? html`<span class="entity legend-item" data-index=${node.index} tabindex="0" aria-label=${node.entity.label}
            >${swatch}${node.name} ${value}</span
          >`
        : legendGroup(ctx, node, swatch, value, unit);
    })}
  </div>`;
}

/** A group in the legend: a button that drills into it, or plain text when drilling is off. */
function legendGroup(
  ctx: ChartContext,
  node: TreeNode,
  swatch: TemplateResult,
  value: TemplateResult | typeof nothing,
  unit: string | undefined,
) {
  const target = drillTarget(ctx, node, nodeLabel(node, ctx, unit));
  return html`<span
    class="legend-item ${target ? 'drillable' : ''}"
    data-path=${node.path.join('/')}
    role=${target ? 'button' : nothing}
    tabindex=${target ? 0 : nothing}
    aria-label=${target?.label ?? nothing}
    @click=${target?.click}
    @keydown=${target?.keydown}
    >${swatch}${node.name} ${value}</span
  >`;
}

/** The drawing for one tree root as an icicle: a column per level, the root on the left. */
export function drawIcicle(ctx: ChartContext, root: TreeNode, tree: TreeNode = root) {
  if (root.value <= 0) return html`<div class="hierarchy-message">${localize(ctx.hass, 'hierarchy_empty')}</div>`;
  const colorBy = (ctx.raw.color_by as HierarchyColorBy | undefined) ?? 'group';
  const unit = sharedUnit(ctx.items);
  const spans = partition(root);
  const painted = paintSpans(partition(tree), colorBy);
  const columns = treeHeight(root) + 1;
  const { show } = ctx.config;
  const names = root.children.filter((c) => c.value > 0).map((c) => c.name);
  return html`<div
    class="icicle"
    role="img"
    aria-label=${localize(ctx.hass, 'icicle_aria', { names: names.join(', ') })}
  >
    ${spans.map((s) => {
      const px = (s.x1 - s.x0) * HEIGHT;
      const style = `left:${(s.level / columns) * 100}%;width:${100 / columns}%;top:${s.x0 * 100}%;height:${(s.x1 - s.x0) * 100}%`;
      const label = nodeLabel(s.node, ctx, unit);
      const paint = s.level === 0 ? undefined : painted.get(s.node)!;
      const value = s.node.entity
        ? s.node.entity.display
        : unit !== undefined
          ? totalText(s.node.value, ctx, unit)
          : '';
      const inner = html`<div class="cell-fill" style=${paint ? `background:${paint.fill}` : ''}>
        ${px >= 18 && (show.name || s.level === 0) ? html`<span class="cell-name">${s.node.name}</span>` : nothing}
        ${px >= 34 && show.value && value ? html`<span class="cell-value">${value}</span>` : nothing}
      </div>`;
      const cls = `cell level-${Math.min(s.level, 1)} text-${paint?.text ?? 'root'}`;
      return s.node.entity
        ? html`<div
            class="entity ${cls} leaf"
            data-index=${s.node.index}
            tabindex="0"
            role="img"
            aria-label=${label}
            title=${label}
            style=${style}
          >
            ${inner}
          </div>`
        : icicleGroup(ctx, s.node, cls, label, style, inner);
    })}
  </div>`;
}

/** A group's cell: tappable to drill into it (not the left-hand total, which is where you are). */
function icicleGroup(
  ctx: ChartContext,
  node: TreeNode,
  cls: string,
  label: string,
  style: string,
  inner: TemplateResult,
) {
  const target = cls.includes('text-root') ? undefined : drillTarget(ctx, node, label);
  return html`<div
    class="${cls} group ${target ? 'drillable' : ''}"
    data-path=${node.path.join('/')}
    title=${label}
    style=${style}
    role=${target ? 'button' : nothing}
    tabindex=${target ? 0 : nothing}
    aria-label=${target?.label ?? nothing}
    @click=${target?.click}
    @keydown=${target?.keydown}
  >
    ${inner}
  </div>`;
}

const sharedStyles = css`
  ${drillStyles}
  .hierarchy-message {
    display: flex;
    align-items: center;
    justify-content: center;
    height: ${HEIGHT}px;
    color: var(--secondary-text-color);
    font-size: 0.875em;
    text-align: center;
  }
  .hierarchy-missing,
  .hierarchy-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding-top: 8px;
    font-size: 0.875em;
    color: var(--secondary-text-color);
  }
  .hierarchy-legend {
    justify-content: center;
  }
  .hierarchy-legend .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .hierarchy-legend .legend-value {
    color: var(--primary-text-color);
    font-weight: 500;
  }
  .hierarchy-legend .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .hierarchy-missing .entity,
  .hierarchy-legend .entity {
    cursor: pointer;
    border-radius: 4px;
  }
  .hierarchy-missing .entity:focus-visible,
  .hierarchy-legend .entity:focus-visible {
    outline: 2px solid var(--primary-color);
  }
`;

export const sunburst: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 290,
  styles: css`
    ${sharedStyles}
    .sunburst-wrap {
      position: relative;
      height: ${HEIGHT}px;
    }
    .sunburst-wrap.half {
      height: ${HEIGHT * 0.6}px;
    }
    .sunburst {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .sunburst .arc {
      stroke: var(--card-background-color, #fff);
      stroke-width: 1.5;
      stroke-linejoin: round;
    }
    .sunburst .arc.leaf {
      cursor: pointer;
      outline: none;
    }
    .sunburst .arc.leaf:focus-visible {
      stroke: var(--primary-text-color);
      stroke-width: 2.5;
    }
    .sunburst-grow {
      transform: scale(0.6) rotate(-30deg);
      opacity: 0;
      transition:
        transform var(--cd-duration) var(--cd-easing),
        opacity var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .sunburst-grow {
      transform: none;
      opacity: 1;
    }
    :host([static]) .sunburst-grow {
      transition: none;
    }
    .sunburst-centre {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 72px;
      text-align: center;
      line-height: 1.2;
      pointer-events: none;
    }
    .sunburst-wrap.half .sunburst-centre {
      top: auto;
      bottom: 4px;
      transform: translateX(-50%);
    }
    .sunburst-centre > * {
      pointer-events: auto;
    }
    .centre-value {
      font-size: 1.15em;
      font-weight: 500;
      /* A long total ("339.4 kWh") wraps its unit under the number rather than over the rings. */
      overflow-wrap: normal;
    }
  `,
  thumbnail: () => svg`
    <circle cx="32" cy="20" r="7" fill="none" />
    <path d="M32 9 A11 11 0 0 1 42 25 L37 22 A6 6 0 0 0 32 14 Z" fill="var(--primary-color, #03a9f4)" />
    <path d="M42 25 A11 11 0 0 1 21 23 L26 21 A6 6 0 0 0 37 22 Z" fill="var(--warning-color, #f59e0b)" />
    <path d="M21 23 A11 11 0 0 1 32 9 L32 14 A6 6 0 0 0 26 21 Z" fill="var(--success-color, #43a047)" />
    <path d="M32 3 A17 17 0 0 1 48 26 L42 25 A11 11 0 0 0 32 9 Z" fill="var(--primary-color, #03a9f4)" opacity="0.6" />
    <path d="M48 26 A17 17 0 0 1 32 37 L32 31 A11 11 0 0 0 42 25 Z" fill="var(--warning-color, #f59e0b)" opacity="0.6" />`,
  validate: (raw) => validate(raw, true),
  editor: sunburstEditor,
  render(ctx) {
    const tree = hierarchyTree(ctx);
    const view = drillView(ctx, tree);
    return html`${drillBar(ctx, tree, view, '')} ${drawSunburst(ctx, view.node, tree)}
    ${view.node.value > 0 ? sunburstLegend(ctx, view.node, tree) : nothing} ${noReading(ctx)}`;
  },
};

export const icicle: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 280,
  styles: css`
    ${sharedStyles}
    .icicle {
      position: relative;
      height: ${HEIGHT}px;
    }
    .icicle .cell {
      position: absolute;
      box-sizing: border-box;
      padding: 1.5px;
    }
    .icicle .cell-fill {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      border-radius: 5px;
      padding: 3px 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      line-height: 1.25;
      opacity: 0;
      transform: translateX(-8px);
      transition:
        opacity var(--cd-duration) var(--cd-easing),
        transform var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .icicle .cell-fill {
      opacity: 1;
      transform: none;
    }
    :host([static]) .icicle .cell-fill {
      transition: none;
    }
    .icicle .text-root .cell-fill {
      background: color-mix(in srgb, var(--primary-text-color, #212121) 78%, var(--card-background-color, #fff));
      color: var(--card-background-color, #fff);
    }
    .icicle .text-light {
      color: #fff;
    }
    .icicle .text-dark {
      color: rgba(0, 0, 0, 0.87);
    }
    .icicle .text-theme {
      color: var(--primary-text-color);
    }
    .icicle .cell-name,
    .icicle .cell-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .icicle .cell-name {
      font-size: 13px;
      font-weight: 500;
    }
    .icicle .cell-value {
      font-size: 12px;
      opacity: 0.9;
    }
    .icicle .leaf {
      cursor: pointer;
      outline: none;
    }
    .icicle .leaf:focus-visible .cell-fill {
      box-shadow: inset 0 0 0 2px var(--primary-text-color);
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="4" width="16" height="32" rx="2" fill="var(--primary-text-color, #212121)" opacity="0.75" />
    <rect x="22" y="4" width="17" height="19" rx="2" fill="var(--primary-color, #03a9f4)" />
    <rect x="22" y="25" width="17" height="11" rx="2" fill="var(--warning-color, #f59e0b)" />
    <rect x="41" y="4" width="19" height="11" rx="2" fill="var(--primary-color, #03a9f4)" opacity="0.7" />
    <rect x="41" y="17" width="19" height="6" rx="2" fill="var(--primary-color, #03a9f4)" opacity="0.7" />
    <rect x="41" y="25" width="19" height="11" rx="2" fill="var(--warning-color, #f59e0b)" opacity="0.7" />`,
  validate: (raw) => validate(raw, false),
  editor: icicleEditor,
  render(ctx) {
    const tree = hierarchyTree(ctx);
    const view = drillView(ctx, tree);
    return html`${drillBar(ctx, tree, view, '')} ${drawIcicle(ctx, view.node, tree)} ${noReading(ctx)}`;
  },
};
