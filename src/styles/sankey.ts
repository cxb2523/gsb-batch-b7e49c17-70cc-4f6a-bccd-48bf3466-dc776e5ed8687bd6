import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { isInteractive } from '../actions';
import { baseColor } from '../bands';
import { SERIES_COLORS, frameStyles } from '../chart/frame';
import { chartWidth, stopChartWidth } from '../chart/grid';
import { acceptFlows, findCycle, fitText, linkPath, sankeyLayout, spreadLabels, textWidth } from '../chart/sankey';
import type { Flow, SankeyLayout, SankeyLink, SankeyNode } from '../chart/sankey';
import { tooltipStyles } from '../chart/tooltip';
import {
  ENERGY_TOTALS_FIELDS,
  cachedSchema,
  chartForm,
  choice,
  energyTotalsSchema,
  energyTotalsVariant,
} from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { isEnergyTotals } from '../history/energy';
import { localize } from '../localize';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig, EntityConfig, HomeAssistant } from '../types';

export const LINK_COLORS = ['auto', 'source', 'target'] as const;
export type LinkColor = (typeof LINK_COLORS)[number];

const NODE_W = 10;
const GAP = 12;
/** Room above a middle node for its one-line label. */
const ABOVE = 20;
/** Space between a node and its label. */
const PAD = 6;
const MIN_H = 200;
/** Height per node in the fullest column, so two-line labels have room. */
const SLOT_H = 44;

type FlowEntity = EntityConfig & { from?: unknown; to?: unknown };

const nodeName = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The card's entities as flows; ones without both ends are left out. */
export function flowsOf(ctx: Pick<ChartContext, 'items'>): Flow[] {
  return ctx.items.flatMap((e, index) => {
    const own = e.config as FlowEntity;
    const from = nodeName(own.from);
    const to = nodeName(own.to);
    return from && to ? [{ index, from, to, value: e.available ? e.value : null }] : [];
  });
}

/**
 * Each node's colour and each link's. Nodes take the series colours in order of first
 * appearance. A link is coloured by its source, or (`auto`) by its target when the source is a
 * middle node, as "House → Heat pump" takes the heat pump's colour. A flow's own `color` paints
 * its link and the node it is coloured by (the first such flow wins for a node).
 */
export function sankeyColors(
  flows: Pick<Flow, 'from' | 'to' | 'index'>[],
  mode: LinkColor,
  own: (index: number) => string | undefined,
): { node: Map<string, string>; link: Map<number, string> } {
  const accepted = acceptFlows(flows);
  const receives = new Set(accepted.map((f) => f.to));
  const node = new Map<string, string>();
  for (const f of accepted) {
    for (const name of [f.from, f.to]) if (!node.has(name)) node.set(name, '');
  }
  const by = (f: Pick<Flow, 'from' | 'to'>) =>
    mode === 'target' || (mode === 'auto' && receives.has(f.from)) ? f.to : f.from;
  const set = new Set<string>();
  for (const f of accepted) {
    const color = own(f.index);
    if (color && !set.has(by(f))) {
      node.set(by(f), baseColor(color));
      set.add(by(f));
    }
  }
  [...node.keys()].forEach((name, i) => {
    if (!set.has(name)) node.set(name, baseColor(SERIES_COLORS[i % SERIES_COLORS.length]));
  });
  const link = new Map<number, string>();
  for (const f of accepted) {
    const color = own(f.index);
    link.set(f.index, color ? baseColor(color) : node.get(by(f))!);
  }
  return { node, link };
}

function linkColor(raw: CardConfig): LinkColor {
  return (raw.link_color as LinkColor | undefined) ?? 'auto';
}

/** Which link the pointer or focus is on, per card. */
const hovered = new WeakMap<HTMLElement, number>();

interface Label {
  node: SankeyNode;
  side: 'left' | 'right' | 'above';
  name: string;
  value: string;
  /** Centre line for side labels; baseline for labels above. */
  y: number;
}

const isMiddle = (n: SankeyNode, columns: number) => n.column > 0 && n.column < columns - 1;
const sits = (n: SankeyNode, columns: number): Label['side'] => {
  if (n.column === 0) return 'left';
  if (isMiddle(n, columns) && n.in > 0 && n.out > 0) return 'above';
  return 'right';
};

interface Drawing {
  width: number;
  height: number;
  font: number;
  layout: SankeyLayout;
  labels: Label[];
}

/**
 * Size the drawing to the card: room either side for the outer columns' labels (at most 30 % of
 * the width each; longer names are cut short), a node height scale set by the fullest column,
 * and labels moved apart where small nodes sit close together.
 */
export function drawSankey(
  flows: Flow[],
  width: number,
  text: { name: boolean; value: boolean; format(v: number): string },
): Drawing {
  const font = width < 400 ? 11 : 12;
  const line = font + 3;
  // A first pass finds the columns and how many nodes the fullest one holds.
  const probe = sankeyLayout(flows, { width, height: MIN_H, left: 0, right: 0, nodeWidth: NODE_W, gap: GAP });
  const columns = probe.columns;
  const counts = new Map<number, number>();
  for (const n of probe.nodes) counts.set(n.column, (counts.get(n.column) ?? 0) + 1);
  const height = Math.max(MIN_H, Math.max(0, ...counts.values()) * SLOT_H);
  const max = width * 0.3;
  const words = (n: SankeyNode) => ({ name: text.name ? n.name : '', value: text.value ? text.format(n.value) : '' });
  const gutter = (side: 'left' | 'right') => {
    const wanted = probe.nodes
      .filter((n) => sits(n, columns) === side && !isMiddle(n, columns))
      .map((n) => Math.max(textWidth(words(n).name, font), textWidth(words(n).value, font)));
    return wanted.length && Math.max(...wanted) > 0 ? Math.min(max, Math.max(...wanted)) + PAD + 3 : 2;
  };
  const left = gutter('left');
  const right = gutter('right');
  const anyAbove = probe.nodes.some((n) => sits(n, columns) === 'above');
  const top = anyAbove && (text.name || text.value) ? ABOVE : 0;
  const layout = sankeyLayout(flows, {
    width,
    height: height - top,
    left,
    right,
    nodeWidth: NODE_W,
    gap: GAP,
    above: (n, cols) => (sits(n, cols) === 'above' && top ? ABOVE : 0),
  });
  for (const n of layout.nodes) n.y += top;
  for (const l of layout.links) {
    l.y0 += top;
    l.y1 += top;
  }
  const spacing = columns > 1 ? (width - left - right - NODE_W) / (columns - 1) : width;
  const labels: Label[] = [];
  if (text.name || text.value) {
    for (const n of layout.nodes) {
      const side = sits(n, columns);
      const w = words(n);
      if (side === 'above') {
        // Centred over the node: it may reach most of the way to the next column on each side.
        const centre = n.x + NODE_W / 2;
        const room = Math.min(spacing * 1.6, 2 * centre, 2 * (width - centre));
        const both = textWidth(`${w.name} ${w.value}`, font);
        const value = both <= room || !w.name ? w.value : '';
        const name = fitText(w.name, value ? room - textWidth(` ${value}`, font) : room, font);
        labels.push({ node: n, side, name, value, y: n.y - PAD });
        continue;
      }
      const room = isMiddle(n, columns) ? spacing - NODE_W - PAD * 2 : (side === 'left' ? left : right) - PAD - 2;
      const value = textWidth(w.value, font) <= room ? w.value : '';
      labels.push({ node: n, side, name: fitText(w.name, room, font), value, y: n.y + n.h / 2 });
    }
    // Side labels in one column must not sit on each other.
    const size = text.name && text.value ? line * 2 : line;
    for (let c = 0; c < columns; c++) {
      const col = labels.filter((l) => l.side !== 'above' && l.node.column === c);
      spreadLabels(
        col.map((l) => l.y),
        size,
        height,
      ).forEach((y, i) => (col[i].y = y));
    }
  }
  return { width, height, font, layout, labels };
}

function labelText(l: Label, font: number): SVGTemplateResult {
  const n = l.node;
  if (l.side === 'above') {
    return svg`<text class="label" x=${n.x + NODE_W / 2} y=${l.y} text-anchor="middle" font-size=${font}>
      <tspan class="name">${l.name}</tspan>${l.value ? svg`<tspan class="value">${l.name ? ' ' : ''}${l.value}</tspan>` : nothing}
    </text>`;
  }
  const x = l.side === 'left' ? n.x - PAD : n.x + NODE_W + PAD;
  const anchor = l.side === 'left' ? 'end' : 'start';
  const two = l.name && l.value;
  const line = font + 3;
  return svg`<text class="label" x=${x} text-anchor=${anchor} font-size=${font}>
    ${l.name ? svg`<tspan class="name" x=${x} y=${two ? l.y - 2 : l.y + font / 3}>${l.name}</tspan>` : nothing}
    ${l.value ? svg`<tspan class="value" x=${x} y=${two ? l.y - 2 + line : l.y + font / 3}>${l.value}</tspan>` : nothing}
  </text>`;
}

function tooltip(l: SankeyLink | undefined, d: Drawing, color: string, value: string): TemplateResult | typeof nothing {
  if (!l) return nothing;
  const x = (l.source.x + NODE_W + l.target.x) / 2;
  const y = (l.y0 + l.y1) / 2 - l.width / 2;
  const left = Math.min(Math.max(x, 70), d.width - 70);
  return html`<div
    class="tooltip sankey-tip"
    aria-hidden="true"
    style="left:${(left / d.width) * 100}%;top:${(Math.max(y, 0) / d.height) * 100}%"
  >
    <div class="tooltip-row">
      <span class="swatch" style="background:${color}"></span>
      <span class="tooltip-name">${l.flow.from} → ${l.flow.to}</span>
      <span class="tooltip-value">${value}</span>
    </div>
  </div>`;
}

function message(key: string, hass: HomeAssistant) {
  return html`<div class="chart-message">${localize(hass, key)}</div>`;
}

function render(ctx: ChartContext): TemplateResult {
  const flows = flowsOf(ctx);
  if (!flows.length) return message('sankey_no_flows', ctx.hass);
  // Unit and decimals come from the first flow, like a total's.
  const first = ctx.items[flows[0].index];
  const format = (v: number) => withUnit(formatNumber(v, first.decimals, ctx.hass), first.unit);
  const width = Math.max(200, chartWidth(ctx) - 32);
  const { show } = ctx.config;
  const d = drawSankey(flows, width, { name: show.name, value: show.value, format });
  const { layout } = d;
  // Energy dashboard totals are over the card's period, not what flows at this moment.
  if (!layout.links.length)
    return message(isEnergyTotals(ctx.items) ? 'energy_nothing_flowed' : 'sankey_nothing', ctx.hass);
  const colors = sankeyColors(flows, linkColor(ctx.raw), (i) => {
    const c = (ctx.items[i].config as FlowEntity).color;
    return typeof c === 'string' && c ? c : undefined;
  });
  const active = hovered.get(ctx.host);
  const hover = (index: number | undefined) => () => {
    if (index === undefined) hovered.delete(ctx.host);
    else hovered.set(ctx.host, index);
    ctx.requestUpdate();
  };
  const dark = ctx.hass.themes?.darkMode === true;
  const describe = (l: SankeyLink) =>
    localize(ctx.hass, 'sankey_flow', { from: l.flow.from, to: l.flow.to, value: format(l.value) });
  const label = localize(ctx.hass, 'sankey_aria', { flows: layout.links.map(describe).join(', ') });
  const shown = layout.links.find((l) => l.flow.index === active);

  const links = layout.links.map((l) => {
    const e = ctx.items[l.flow.index];
    const interactive = isInteractive(e.config);
    return svg`<g
      class="entity flow ${interactive ? 'interactive' : ''} ${l === shown ? 'active' : ''}"
      data-index=${l.flow.index}
      tabindex=${interactive ? 0 : nothing}
      aria-label=${`${describe(l)} (${e.name})`}
      @pointerenter=${hover(l.flow.index)}
      @pointerleave=${hover(undefined)}
      @focus=${hover(l.flow.index)}
      @blur=${hover(undefined)}
    >
      <title>${describe(l)}</title>
      <path class="link" d=${linkPath(l, NODE_W)} fill=${colors.link.get(l.flow.index)!}></path>
    </g>`;
  });
  const nodes = layout.nodes.map(
    (n) =>
      svg`<rect class="node" x=${n.x} y=${n.y} width=${NODE_W} height=${Math.max(2, n.h).toFixed(1)} rx="2"
        fill=${colors.node.get(n.name)!}></rect>`,
  );
  return html`<div class="sankey-wrap">
    <svg
      class="sankey ${dark ? 'dark' : ''} ${shown ? 'hovering' : ''}"
      viewBox="0 0 ${d.width} ${d.height}"
      role="img"
      aria-label=${label}
    >
      <g class="links">${links}</g>
      <g class="nodes">${nodes}</g>
      <g class="labels" aria-hidden="true">${d.labels.map((l) => labelText(l, d.font))}</g>
    </svg>
    ${tooltip(shown, d, shown ? colors.link.get(shown.flow.index)! : '', shown ? format(shown.value) : '')}
  </div>`;
}

const FIELDS: FieldBinding[] = [{ name: 'link_color', path: ['link_color'], default: 'auto' }];

export function sankeyEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`sankey|${energyTotalsVariant(ctx.config)}`, ctx.hass, () => [
    ...energyTotalsSchema(ctx.hass, ctx.config),
    { name: 'link_color', selector: choice(ctx.hass, 'link_color', LINK_COLORS) },
  ]);
  return chartForm(ctx, 'chart', schema, [...ENERGY_TOTALS_FIELDS, ...FIELDS]);
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'from', path: ['from'], default: '' },
  { name: 'to', path: ['to'], default: '' },
  { name: 'flow_color', path: ['color'] },
];
const ENTITY_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'from', selector: { text: {} } },
      { name: 'to', selector: { text: {} } },
    ],
  },
  { name: 'flow_color', selector: { text: {} } },
];

/** Readable errors for the options this style reads, including flows that go round in a loop. */
export function validateSankey(raw: CardConfig): void {
  if (raw.link_color !== undefined && !LINK_COLORS.includes(raw.link_color as LinkColor)) {
    throw new Error(`"link_color" must be one of: ${LINK_COLORS.join(', ')}`);
  }
  const pairs: [string, string][] = [];
  (raw.entities ?? []).forEach((e, i) => {
    if (typeof e !== 'object' || e === null) return;
    const own = e as FlowEntity;
    for (const key of ['from', 'to'] as const) {
      if (own[key] !== undefined && typeof own[key] !== 'string') {
        throw new Error(`Entity ${i + 1}: "${key}" must be a node name`);
      }
    }
    const from = nodeName(own.from);
    const to = nodeName(own.to);
    if (from && to && from === to) throw new Error(`Entity ${i + 1}: "from" and "to" must be different nodes`);
    if (from && to) pairs.push([from, to]);
  });
  const loop = findCycle(pairs);
  if (loop) throw new Error(`Flows can't go round in a loop: ${loop.join(' → ')}`);
}

export const sankey: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 220,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .sankey-wrap {
      position: relative;
    }
    .sankey {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .sankey .link {
      fill-opacity: 0.35;
      transition:
        fill-opacity 0.15s ease,
        opacity var(--cd-duration) var(--cd-easing);
    }
    .sankey.dark .link {
      fill-opacity: 0.45;
    }
    .sankey.hovering .link {
      fill-opacity: 0.2;
    }
    .sankey .flow:hover .link,
    .sankey .flow:focus-visible .link,
    .sankey .flow.active .link {
      fill-opacity: 0.75;
    }
    .sankey .flow {
      cursor: pointer;
      outline: none;
    }
    .sankey .flow:focus-visible {
      box-shadow: none;
    }
    .sankey .flow:focus-visible .link {
      fill-opacity: 0.85;
    }
    :host(:not([ready])) .sankey .link {
      opacity: 0;
    }
    .sankey .node {
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host(:not([ready])) .sankey .node {
      opacity: 0;
    }
    :host([static]) .sankey .node {
      transition: none;
    }
    .sankey .label {
      pointer-events: none;
    }
    .sankey .name {
      fill: var(--primary-text-color);
    }
    .sankey .value {
      fill: var(--secondary-text-color);
    }
    .sankey-tip {
      pointer-events: none;
      white-space: nowrap;
      max-width: none;
      transform: translate(-50%, calc(-100% - 6px));
    }
  `,
  thumbnail: () => svg`
    <g fill="none" stroke-opacity="0.4">
      <path d="M10 11 C32 11 32 9 54 9" stroke="var(--primary-color, #03a9f4)" stroke-width="10" />
      <path d="M10 21 C32 21 32 25 54 25" stroke="var(--primary-color, #03a9f4)" stroke-width="10" />
      <path d="M10 32 C32 32 32 33 54 33" stroke="var(--warning-color, #f59e0b)" stroke-width="6" />
    </g>
    <rect x="6" y="6" width="4" height="20" rx="1" fill="var(--primary-color, #03a9f4)" />
    <rect x="6" y="29" width="4" height="6" rx="1" fill="var(--warning-color, #f59e0b)" />
    <rect x="54" y="4" width="4" height="10" rx="1" fill="var(--success-color, #43a047)" />
    <rect x="54" y="20" width="4" height="16" rx="1" fill="var(--purple-color, #8b6cff)" />`,
  validate: validateSankey,
  editor: sankeyEditor,
  entityFields: () => ({ schema: ENTITY_SCHEMA, fields: ENTITY_FIELDS }),
  disconnect(host) {
    stopChartWidth(host);
    hovered.delete(host);
  },
  render,
};
