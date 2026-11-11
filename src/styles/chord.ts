import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { isInteractive } from '../actions';
import { baseColor } from '../bands';
import { chordLayout, ribbonPath, ringPath } from '../chart/chord';
import type { ChordLayout, ChordNode, ChordRibbon, ChordSort } from '../chart/chord';
import { SERIES_COLORS, frameStyles } from '../chart/frame';
import { chartWidth, stopChartWidth } from '../chart/grid';
import { fitText, textWidth } from '../chart/sankey';
import { tooltipStyles } from '../chart/tooltip';
import { cachedSchema, chartForm } from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { polar } from '../geometry';
import { localize } from '../localize';
import type { CardConfig, EntityConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import { flowsOf } from './sankey';

/** Degrees between neighbouring nodes, unless `pad` says otherwise. */
export const DEFAULT_PAD = 3;
/** The node ring's thickness, and the space between it and the ribbons, px. */
const RING = 10;
const INSET = 2;
/** Space between the ring and its labels, px. */
const LABEL_GAP = 8;
const FONT = 12;
const LINE = FONT + 3;
const MIN_R = 50;
const MAX_R = 120;

type FlowEntity = EntityConfig & { color?: unknown };

/** Which ribbon (by item index) or node (by name) the pointer or focus is on, per card. */
const hovered = new WeakMap<HTMLElement, { ribbon?: number; node?: string }>();

/** Nodes take the series colours in order of first appearance; a ribbon its own `color`, else its source's. */
export function chordColors(
  layout: ChordLayout,
  own: (index: number) => string | undefined,
): { node: Map<string, string>; ribbon: Map<number, string> } {
  const node = new Map<string, string>();
  for (const n of [...layout.nodes].sort((a, b) => a.order - b.order)) {
    node.set(n.name, baseColor(SERIES_COLORS[n.order % SERIES_COLORS.length]));
  }
  const ribbon = new Map<number, string>();
  for (const r of layout.ribbons) {
    const c = own(r.flow.index);
    ribbon.set(r.flow.index, c ? baseColor(c) : node.get(r.source.name)!);
  }
  return { node, ribbon };
}

export interface ChordLabel {
  node: ChordNode;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  name: string;
  value: string;
}

export interface ChordDrawing {
  width: number;
  height: number;
  cx: number;
  cy: number;
  r: number;
  labels: ChordLabel[];
}

/**
 * Size the circle to the card: as big as fits with the labels beside it (each at most a quarter
 * of the width; longer names are cut short), and a label outside each arc's middle.
 */
export function drawChord(
  layout: ChordLayout,
  width: number,
  text: { name: boolean; value: boolean; format(v: number): string },
): ChordDrawing {
  const words = (n: ChordNode) => ({ name: text.name ? n.name : '', value: text.value ? text.format(n.total) : '' });
  const room = width / 4;
  const wanted = Math.max(
    0,
    ...layout.nodes.map((n) => Math.max(textWidth(words(n).name, FONT), textWidth(words(n).value, FONT))),
  );
  const side = text.name || text.value ? Math.min(room, wanted) + LABEL_GAP : 4;
  const r = Math.max(MIN_R, Math.min(MAX_R, width / 2 - side));
  const lines = (text.name ? 1 : 0) + (text.value ? 1 : 0);
  const above = lines ? LABEL_GAP + lines * LINE : 4;
  const height = Math.round(2 * (r + above));
  const cx = width / 2;
  const cy = height / 2;
  const labels: ChordLabel[] = [];
  if (lines) {
    for (const n of layout.nodes) {
      const mid = (n.start + n.end) / 2;
      const [x, y] = polar(cx, cy, r + LABEL_GAP, mid);
      const sin = Math.sin((mid * Math.PI) / 180);
      const cos = Math.cos((mid * Math.PI) / 180);
      const anchor = sin > 0.3 ? 'start' : sin < -0.3 ? 'end' : 'middle';
      const space =
        anchor === 'middle' ? Math.min(width, 2 * Math.min(x, width - x)) : anchor === 'start' ? width - x : x;
      const w = words(n);
      // Top labels sit above their point, bottom ones below, side ones centred on it.
      const block = lines * LINE;
      const top = cos > 0.3 ? y - block : cos < -0.3 ? y : y - block / 2;
      labels.push({
        node: n,
        x,
        y: top + FONT,
        anchor,
        name: fitText(w.name, space - 2, FONT),
        value: textWidth(w.value, FONT) <= space ? w.value : '',
      });
    }
  }
  return { width, height, cx, cy, r, labels };
}

function labelText(l: ChordLabel): SVGTemplateResult {
  return svg`<text class="label" x=${l.x.toFixed(1)} text-anchor=${l.anchor} font-size=${FONT}>
    ${l.name ? svg`<tspan class="name" x=${l.x.toFixed(1)} y=${l.y.toFixed(1)}>${l.name}</tspan>` : nothing}
    ${
      l.value
        ? svg`<tspan class="value" x=${l.x.toFixed(1)} y=${(l.y + (l.name ? LINE : 0)).toFixed(1)}>${l.value}</tspan>`
        : nothing
    }
  </text>`;
}

function tooltip(r: ChordRibbon | undefined, d: ChordDrawing, color: string, value: string) {
  if (!r) return nothing;
  const inner = d.r - RING - INSET;
  const [ax, ay] = polar(d.cx, d.cy, inner, (r.s.start + r.s.end) / 2);
  const [bx, by] = polar(d.cx, d.cy, inner, (r.t.start + r.t.end) / 2);
  // Halfway along the ribbon's curve: a quarter of each end plus half the centre.
  const x = (ax + bx) / 4 + d.cx / 2;
  const y = (ay + by) / 4 + d.cy / 2;
  const left = Math.min(Math.max(x, 70), d.width - 70);
  return html`<div
    class="tooltip chord-tip"
    aria-hidden="true"
    style="left:${(left / d.width) * 100}%;top:${(Math.max(y, 0) / d.height) * 100}%"
  >
    <div class="tooltip-row">
      <span class="swatch" style="background:${color}"></span>
      <span class="tooltip-name">${r.flow.from} → ${r.flow.to}</span>
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
  const pad = typeof ctx.raw.pad === 'number' ? ctx.raw.pad : DEFAULT_PAD;
  const layout = chordLayout(flows, pad, ctx.config.sort as ChordSort);
  if (!layout.ribbons.length) return message('sankey_nothing', ctx.hass);
  // Unit and decimals come from the first flow, like a total's.
  const first = ctx.items[flows[0].index];
  const format = (v: number) => withUnit(formatNumber(v, first.decimals, ctx.hass), first.unit);
  const width = Math.max(200, chartWidth(ctx) - 32);
  const { show } = ctx.config;
  const d = drawChord(layout, width, { name: show.name, value: show.value, format });
  const colors = chordColors(layout, (i) => {
    const c = (ctx.items[i].config as FlowEntity).color;
    return typeof c === 'string' && c ? c : undefined;
  });
  const state = hovered.get(ctx.host) ?? {};
  const set = (next: { ribbon?: number; node?: string } | undefined) => () => {
    if (next) hovered.set(ctx.host, next);
    else hovered.delete(ctx.host);
    ctx.requestUpdate();
  };
  const shown = layout.ribbons.find((r) => r.flow.index === state.ribbon);
  const lit = (r: ChordRibbon) =>
    r === shown || (state.node !== undefined && (r.source.name === state.node || r.target.name === state.node));
  const dark = ctx.hass.themes?.darkMode === true;
  const describe = (r: ChordRibbon) =>
    localize(ctx.hass, 'sankey_flow', { from: r.flow.from, to: r.flow.to, value: format(r.value) });
  const label = localize(ctx.hass, 'chord_aria', { flows: layout.ribbons.map(describe).join(', ') });
  const opacity = typeof ctx.raw.ribbon_opacity === 'number' ? ctx.raw.ribbon_opacity : undefined;
  const inner = d.r - RING - INSET;

  const ribbons = layout.ribbons.map((r) => {
    const e = ctx.items[r.flow.index];
    const interactive = isInteractive(e.config);
    return svg`<g
      class="entity ribbon ${interactive ? 'interactive' : ''} ${lit(r) ? 'active' : ''}"
      data-index=${r.flow.index}
      tabindex=${interactive ? 0 : nothing}
      aria-label=${`${describe(r)} (${e.name})`}
      @pointerenter=${set({ ribbon: r.flow.index })}
      @pointerleave=${set(undefined)}
      @focus=${set({ ribbon: r.flow.index })}
      @blur=${set(undefined)}
    >
      <title>${describe(r)}</title>
      <path d=${ribbonPath(d.cx, d.cy, inner, r.s, r.t)} fill=${colors.ribbon.get(r.flow.index)!}></path>
    </g>`;
  });
  const nodes = layout.nodes.map(
    (n) =>
      svg`<path class="node" d=${ringPath(d.cx, d.cy, d.r - RING, d.r, n.start, Math.max(n.end, n.start + 0.5))}
        fill=${colors.node.get(n.name)!}
        @pointerenter=${set({ node: n.name })}
        @pointerleave=${set(undefined)}
      ><title>${n.name} ${format(n.total)}</title></path>`,
  );
  const hovering = shown !== undefined || state.node !== undefined;
  return html`<div class="chord-wrap">
    <svg
      class="chord ${dark ? 'dark' : ''} ${hovering ? 'hovering' : ''}"
      viewBox="0 0 ${d.width} ${d.height}"
      role="img"
      aria-label=${label}
      style=${opacity === undefined ? nothing : `--cd-ribbon-opacity:${opacity}`}
    >
      <g class="ribbons">${ribbons}</g>
      <g class="nodes">${nodes}</g>
      <g class="labels" aria-hidden="true">${d.labels.map(labelText)}</g>
    </svg>
    ${tooltip(shown, d, shown ? colors.ribbon.get(shown.flow.index)! : '', shown ? format(shown.value) : '')}
  </div>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'chord_pad', path: ['pad'], default: DEFAULT_PAD },
  { name: 'chord_ribbon_opacity', path: ['ribbon_opacity'] },
];

export function chordEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('chord', ctx.hass, () => [
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'chord_pad',
          selector: { number: { min: 0, max: 20, step: 1, mode: 'box', unit_of_measurement: '°' } },
        },
        { name: 'chord_ribbon_opacity', selector: { number: { min: 0.05, max: 1, step: 0.05, mode: 'slider' } } },
      ],
    },
  ]);
  return chartForm(ctx, 'chart', schema, FIELDS);
}

/** Same per-entity fields as the Sankey, so a card can switch between the two and keep its flows. */
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

/** Readable errors for the options this style reads. Flows may go both ways and round in loops. */
export function validateChord(raw: CardConfig): void {
  if (raw.pad !== undefined && (typeof raw.pad !== 'number' || !(raw.pad >= 0 && raw.pad <= 20))) {
    throw new Error('"pad" must be a number of degrees from 0 to 20');
  }
  if (
    raw.ribbon_opacity !== undefined &&
    (typeof raw.ribbon_opacity !== 'number' || !(raw.ribbon_opacity > 0 && raw.ribbon_opacity <= 1))
  ) {
    throw new Error('"ribbon_opacity" must be a number above 0, up to 1');
  }
  (raw.entities ?? []).forEach((e, i) => {
    if (typeof e !== 'object' || e === null) return;
    const own = e as { from?: unknown; to?: unknown };
    for (const key of ['from', 'to'] as const) {
      if (own[key] !== undefined && typeof own[key] !== 'string') {
        throw new Error(`Entity ${i + 1}: "${key}" must be a node name`);
      }
    }
    const from = typeof own.from === 'string' ? own.from.trim() : '';
    const to = typeof own.to === 'string' ? own.to.trim() : '';
    if (from && to && from === to) throw new Error(`Entity ${i + 1}: "from" and "to" must be different nodes`);
  });
}

export const chord: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 300,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .chord-wrap {
      position: relative;
    }
    .chord {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
      --cd-ribbon-opacity: 0.35;
    }
    .chord.dark {
      --cd-ribbon-opacity: 0.45;
    }
    .chord .ribbon path {
      fill-opacity: var(--cd-ribbon-opacity);
      transition:
        fill-opacity 0.15s ease,
        opacity var(--cd-duration) var(--cd-easing);
    }
    .chord.hovering .ribbon path {
      fill-opacity: calc(var(--cd-ribbon-opacity) * 0.4);
    }
    .chord .ribbon:hover path,
    .chord .ribbon:focus-visible path,
    .chord .ribbon.active path {
      fill-opacity: 0.8;
    }
    .chord .ribbon {
      cursor: pointer;
      outline: none;
    }
    .chord .ribbon:focus-visible {
      box-shadow: none;
    }
    .chord .node {
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host(:not([ready])) .chord .ribbon path,
    :host(:not([ready])) .chord .node {
      opacity: 0;
    }
    :host([static]) .chord .ribbon path,
    :host([static]) .chord .node {
      transition: none;
    }
    .chord .label {
      pointer-events: none;
    }
    .chord .name {
      fill: var(--primary-text-color);
    }
    .chord .value {
      fill: var(--secondary-text-color);
    }
    .chord-tip {
      pointer-events: none;
      white-space: nowrap;
      max-width: none;
      transform: translate(-50%, calc(-100% - 6px));
    }
  `,
  thumbnail: () => svg`
    <g fill-opacity="0.45">
      <path d="M36.4 7.8 A13 13 0 0 1 43.3 13.5 Q32 20 38.5 31.3 A13 13 0 0 1 32 33 Q32 20 36.4 7.8Z"
        fill="var(--primary-color, #03a9f4)" />
      <path d="M44.8 17.7 A13 13 0 0 1 44.6 23.4 Q32 20 25.5 31.3 A13 13 0 0 1 19.8 24.4 Q32 20 44.8 17.7Z"
        fill="var(--warning-color, #f59e0b)" />
      <path d="M19.2 17.7 A13 13 0 0 1 23.6 10 Q32 20 35.4 7.4 A13 13 0 0 1 38.5 8.7 Q32 20 19.2 17.7Z"
        fill="var(--purple-color, #8b6cff)" />
    </g>
    <g fill="none" stroke-width="3">
      <path d="M33.1 4 A16 16 0 0 1 47 25.5" stroke="var(--primary-color, #03a9f4)" />
      <path d="M46.1 27.5 A16 16 0 0 1 29.2 35.8" stroke="var(--warning-color, #f59e0b)" />
      <path d="M27.1 35.2 A16 16 0 0 1 16.2 22.8" stroke="var(--success-color, #43a047)" />
      <path d="M16 20.6 A16 16 0 0 1 29.8 4.2" stroke="var(--purple-color, #8b6cff)" />
    </g>`,
  validate: validateChord,
  editor: chordEditor,
  entityFields: () => ({ schema: ENTITY_SCHEMA, fields: ENTITY_FIELDS }),
  disconnect(host) {
    stopChartWidth(host);
    hovered.delete(host);
  },
  render,
};
