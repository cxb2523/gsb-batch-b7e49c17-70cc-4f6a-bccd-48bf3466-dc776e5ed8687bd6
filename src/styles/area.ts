import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { validateAxisOptions } from '../chart/axes';
import { downsample } from '../chart/downsample';
import {
  VIEW_H,
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  seriesHeader,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartArea, gridStyles, plotAxes, plotWidth, stopChartWidth } from '../chart/grid';
import type { PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { runPath, runs } from '../chart/paths';
import type { Curve, XY } from '../chart/paths';
import { extent } from '../chart/scale';
import { conditionStrip, conditionStyles, ghostLines } from '../chart/condition-strip';
import { ghostOn } from '../history/condition';
import { MAX_DOTS, dotSize, dotsPath, drawOrder, seriesStyle, validateSeriesStyle } from '../chart/series-style';
import { STACK_MODES, align, stackExtent, stackValues, totals, validateStack } from '../chart/stack';
import type { Layer, StackMode } from '../chart/stack';
import {
  hoverHandlers,
  hoverTime,
  sharedUnit,
  stopHover,
  totalRow,
  tooltipEnabled,
  tooltipLayer,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import type { TooltipOptions } from '../chart/tooltip';
import {
  AXES_FIELDS,
  ENERGY_SPLIT_FIELD,
  HISTORY_FIELDS,
  LAYOUT_FIELDS,
  axesSchema,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  historyVariant,
  layoutSchema,
} from '../editor/chart-editors';
import { LINE_WIDTH_SELECTOR, entitySeriesFields, entitySeriesSchema } from '../editor/schemas';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { CURVES } from '../chart/paths';
import { localize } from '../localize';
import { shownValue } from '../history/energy';
import type { Point } from '../history/types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';
import type { CardConfig, HomeAssistant } from '../types';

/** Points kept per series after thinning: about two per pixel on a wide card. */
const MAX_POINTS = 500;
/** Area outlines are a little finer than a line chart's: the fill carries the shape. */
export const AREA_LINE_WIDTH = 2;

/**
 * Value-axis ends to fix so a filled chart stands on zero: readings that are all positive (or all
 * negative) and reach down near zero get an axis that starts exactly there, not at a padded −500
 * under a solar curve. Readings far from zero (a room at 18 to 22 °C) keep a fitted axis, and an
 * end the user set always wins.
 */
export function zeroFloor(data: [number, number] | undefined, raw: CardConfig): CardConfig {
  if (!data) return raw;
  const [lo, hi] = data;
  const out: Record<string, unknown> = {};
  if (raw.y_min === undefined && lo >= 0 && lo <= hi / 2) out.y_min = 0;
  if (raw.y_max === undefined && hi <= 0 && hi >= lo / 2) out.y_max = 0;
  return Object.keys(out).length ? { ...raw, ...out } : raw;
}

/** The corners of a stepped line, so it can be drawn (and walked backwards) as straight lines. */
export function stepCorners(pts: XY[]): XY[] {
  const out: XY[] = [];
  pts.forEach((p, i) => {
    if (i > 0) out.push([p[0], pts[i - 1][1]]);
    out.push(p);
  });
  return out;
}

/**
 * A closed fill between `top` and `base` (same x positions): along the top, back along the base.
 * The same curve is used both ways, so a stacked layer's lower edge is exactly the upper edge of
 * the one below it.
 */
export function areaPath(top: XY[], base: XY[], curve: Curve): string {
  if (top.length < 2) return '';
  const [t, b, c] = curve === 'step' ? [stepCorners(top), stepCorners(base), 'straight' as Curve] : [top, base, curve];
  return `${runPath(t, c)}${runPath([...b].reverse(), c).replace(/^M/, 'L')}Z`;
}

/** The outline's path: steps drawn as their corners too, so it lines up with the fill. */
export function edgePath(top: XY[], curve: Curve): string {
  return curve === 'step' ? runPath(stepCorners(top), 'straight') : runPath(top, curve);
}

/**
 * A vertical fill gradient for one series: strongest at the plot's top (or bottom, below zero),
 * fading towards the zero line, with `below` (export, say) as the colour under zero.
 */
export function fillGradient(id: string, color: string, below: string, zeroY: number, strong = 0.42, faint = 0.05) {
  const at = Math.min(1, Math.max(0, zeroY / VIEW_H));
  return svg`<linearGradient id=${id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2=${VIEW_H}>
    <stop offset="0" stop-color=${color} stop-opacity=${strong}></stop>
    <stop offset=${at} stop-color=${color} stop-opacity=${faint}></stop>
    <stop offset=${at} stop-color=${below} stop-opacity=${faint}></stop>
    <stop offset="1" stop-color=${below} stop-opacity=${strong}></stop>
  </linearGradient>`;
}

/** An outline that changes colour where it crosses zero. */
export function lineGradient(id: string, color: string, below: string, zeroY: number) {
  const at = Math.min(1, Math.max(0, zeroY / VIEW_H));
  return svg`<linearGradient id=${id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2=${VIEW_H}>
    <stop offset=${at} stop-color=${color}></stop>
    <stop offset=${at} stop-color=${below}></stop>
  </linearGradient>`;
}

/** The colour a series uses below zero: its own `negative_color`, else its colour. */
export function belowColor(s: ChartSeries): string {
  const own = (s.entity.config as { negative_color?: unknown }).negative_color;
  return typeof own === 'string' && own.trim() ? baseColor(own.trim()) : s.color;
}

export interface AreaDrawing {
  defs: SVGTemplateResult;
  body: SVGTemplateResult;
}

/**
 * One series' fill and outline. `layers` stacks it (base and top per point); without, it fills
 * from its readings to `zeroY`. Shared with the combined chart.
 */
export function drawArea(
  s: ChartSeries,
  points: Point[],
  scales: PlotScales,
  raw: CardConfig,
  options: { layers?: Layer[]; stacked?: boolean; range?: { start: number; end: number } } = {},
): AreaDrawing {
  const style = seriesStyle(s.entity.config, raw);
  const width = (s.entity.config as { line_width?: number }).line_width ?? (raw.line_width as number | undefined);
  const zeroY = scales.y(Math.min(Math.max(0, scales.domain[0]), scales.domain[1]));
  const below = belowColor(s);
  const fillId = `cd-area-${s.index}`;
  const lineId = `cd-area-line-${s.index}`;
  const twoTone = below !== s.color;
  const defs = svg`${fillGradient(fillId, s.color, below, zeroY, options.stacked ? 0.6 : 0.42, options.stacked ? 0.35 : 0.05)}
    ${twoTone ? lineGradient(lineId, s.color, below, zeroY) : nothing}`;
  const fills: string[] = [];
  const edges: string[] = [];
  const dots: XY[] = [];
  if (options.layers) {
    // Unbroken runs of moments where this series has a slice of the stack.
    const layers = options.layers;
    let run: number[] = [];
    const flush = () => {
      if (run.length) {
        const top = run.map((i) => [scales.x(points[i].t), scales.y(layers[i]![1])] as XY);
        const base = run.map((i) => [scales.x(points[i].t), scales.y(layers[i]![0])] as XY);
        fills.push(areaPath(top, base, s.curve));
        edges.push(edgePath(top, s.curve));
      }
      run = [];
    };
    for (let i = 0; i < points.length; i++) {
      if (layers[i]) run.push(i);
      else flush();
    }
    flush();
  } else {
    for (const r of runs(points)) {
      const top = r.map((p) => [scales.x(p.t), scales.y(p.v as number)] as XY);
      fills.push(
        areaPath(
          top,
          top.map(([x]) => [x, zeroY] as XY),
          s.curve,
        ),
      );
      edges.push(edgePath(top, s.curve));
    }
  }
  if (style.dots) {
    const range = options.range;
    points.forEach((p, i) => {
      if (p.v === null || (range && (p.t === range.start || p.t === range.end))) return;
      const y = options.layers ? options.layers[i]?.[1] : p.v;
      if (y !== undefined) dots.push([scales.x(p.t), scales.y(y)]);
    });
  }
  const lineWidth = width ?? AREA_LINE_WIDTH;
  const stroke = twoTone ? `url(#${lineId})` : s.color;
  const body = svg`<g class="series" data-series=${s.index}>
    <path class="fill" d=${fills.join('')} fill="url(#${fillId})" stroke="none"></path>
    <path class="line ${s.dash ? 'dashed' : ''}" d=${edges.join('')} fill="none" stroke=${stroke}
      style="stroke-width:${lineWidth}px"></path>
    ${
      dots.length > 0 && dots.length <= MAX_DOTS
        ? svg`<path class="dots" d=${dotsPath(dots)} fill="none" stroke=${stroke}
            style="stroke-width:${dotSize(lineWidth)}px"></path>`
        : nothing
    }
  </g>`;
  return { defs, body };
}

function render(ctx: ChartContext): TemplateResult {
  const mode = (ctx.raw.stack as StackMode | undefined) ?? 'none';
  // The faint line of hidden readings: unstacked only (a hidden reading has no place in a pile).
  const frame: HistoryFrame = historyFrame(ctx, Date.now(), { ghost: mode === 'none' && ghostOn(ctx.raw) });
  const nav = periodNav(frame, ctx);
  const names = seriesHeader(frame, ctx);
  const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
  const message = frameMessage(frame, ctx);
  const layout = chartLayout(ctx.raw);
  if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
  const thinned = frame.series.map((s) => ({ ...s, points: downsample(s.points, MAX_POINTS) }));
  let shown: ChartSeries[] = thinned;
  let drawn: AreaDrawing[];
  let axes;
  const tip: TooltipOptions = {};
  let ghosts: SVGTemplateResult | typeof nothing = nothing;
  if (mode === 'none') {
    const data = extent([...thinned.map((s) => s.points), ...thinned.flatMap((s) => (s.hidden ? [s.hidden] : []))]);
    axes = plotAxes({ ...ctx, raw: zeroFloor(data, ctx.raw) }, frame.range, data);
    const scales = axes.scales;
    // Listed order, last on top, with any series marked "on top" drawn after the rest.
    const ordered = drawOrder(thinned, (s) => seriesStyle(s.entity.config, ctx.raw).onTop);
    drawn = ordered.map((s) => drawArea(s, s.points, scales, ctx.raw, { range: frame.range }));
    ghosts = ghostLines(thinned, scales);
  } else {
    // Every series read at every moment any of them changed, then piled up.
    const aligned = align(thinned.map((s) => s.points));
    const layers = stackValues(aligned.values, mode);
    const sums = totals(aligned.values);
    shown = thinned.map((s, k) => ({ ...s, points: aligned.times.map((t, i) => ({ t, v: aligned.values[k][i] })) }));
    const data = stackExtent(layers);
    const fixed = mode === 'percent' ? { y_min: data[0] < 0 ? -100 : 0, y_max: data[1] > 0 ? 100 : 0 } : {};
    axes = plotAxes({ ...ctx, raw: zeroFloor(data, { ...fixed, ...ctx.raw }) }, frame.range, data);
    const scales = axes.scales;
    // Drawn from the top of the pile down, so each layer's outline sits over the fill above it.
    drawn = shown
      .map((s, k) => drawArea(s, s.points, scales, ctx.raw, { layers: layers[k], stacked: true, range: frame.range }))
      .reverse();
    const index = new Map<Point, number>();
    shown.forEach((s) => s.points.forEach((p, i) => index.set(p, i)));
    tip.dotY = (s, p) => {
      const layer = layers[s.index][index.get(p) ?? -1];
      return layer ? scales.y(layer[1]) : null;
    };
    const unit = sharedUnit(shown);
    const decimals = Math.max(...shown.map((s) => s.entity.decimals));
    tip.footer = (rows) => {
      const i = rows.length ? index.get(rows[0].p as Point) : undefined;
      return totalRow(ctx, i === undefined ? null : sums[i], unit, decimals);
    };
    if (mode === 'percent') {
      tip.text = (s, p) => {
        const layer = p ? layers[s.index][index.get(p) ?? -1] : null;
        if (!p || p.v === null || !layer) return '—';
        const share = Math.round(Math.abs(layer[1] - layer[0]));
        return `${withUnit(formatNumber(shownValue(s.entity, p.v), s.entity.decimals, ctx.hass), s.entity.unit)} · ${share} %`;
      };
    }
  }
  const tooltip = tooltipEnabled(ctx.raw);
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_area'),
    names: frame.series.map((s) => s.entity.name).join(', '),
  });
  return chartFrame(
    layout,
    header,
    chartArea({
      axes,
      ctx,
      content: svg`${ghosts}${drawn.map((d) => d.body)}`,
      defs: svg`${drawn.map((d) => d.defs)}`,
      label,
      overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}
      ${tooltip ? tooltipLayer(ctx, shown, axes.scales, hoverTime(ctx.host), plotWidth(ctx), tip) : nothing}`,
      hover: tooltip
        ? hoverHandlers(
            ctx,
            frame.range,
            shown.map((s) => s.points),
          )
        : undefined,
      ...conditionStrip(ctx, frame, frame.range, axes.scales),
    }),
  );
}

const AREA_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  ENERGY_SPLIT_FIELD,
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'stack', path: ['stack'], default: 'none' },
  { name: 'line_width', path: ['line_width'], default: AREA_LINE_WIDTH },
  { name: 'dots', path: ['dots'], default: false },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

export function areaEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`area|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ctx.config),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'curve', selector: choice(ctx.hass, 'curve', CURVES) },
        { name: 'stack', selector: choice(ctx.hass, 'stack', STACK_MODES) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
        { name: 'dots', selector: { boolean: {} } },
      ],
    },
    ...axesSchema(ctx.hass),
    ...layoutSchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, AREA_FIELDS);
}

const NEGATIVE_FIELD: FieldBinding = { name: 'negative_color', path: ['negative_color'] };
const entityFieldCache = new Map<boolean, FieldBinding[]>();

/** The line chart's per-series options, plus a colour for the part below zero. */
export function areaEntityFields(hass: HomeAssistant | undefined, config: CardConfig) {
  const dots = config.dots === true;
  let fields = entityFieldCache.get(dots);
  if (!fields) {
    fields = [...entitySeriesFields(dots), NEGATIVE_FIELD];
    entityFieldCache.set(dots, fields);
  }
  return {
    schema: cachedSchema('area-entity', hass, () => [
      ...entitySeriesSchema(hass),
      { name: 'negative_color', selector: { text: {} } },
    ]),
    fields,
  };
}

/** Throw a readable error for a bad `negative_color` on an entity. */
export function validateNegativeColor(raw: CardConfig): void {
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object') continue;
    const v = (e as { negative_color?: unknown }).negative_color;
    if (v !== undefined && typeof v !== 'string') throw new Error(`"negative_color" of ${e.entity} must be a colour`);
  }
}

export const areaStyles = css`
  .plot .fill {
    vector-effect: none;
  }
  .style-area .line,
  .plot .series .line {
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .plot .series .dots {
    stroke-linecap: round;
  }
  .plot .series .line.dashed {
    stroke-dasharray: 6 5;
  }
`;

export const area: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${areaStyles}
    ${conditionStyles}
  `,
  thumbnail: () => svg`
    <defs>
      <linearGradient id="cd-thumb-area" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--primary-color, #03a9f4)" stop-opacity="0.5" />
        <stop offset="1" stop-color="var(--primary-color, #03a9f4)" stop-opacity="0.05" />
      </linearGradient>
    </defs>
    <path d="M4 30 C14 28 16 12 26 14 S40 26 46 18 S56 8 60 10 V36 H4 Z" fill="url(#cd-thumb-area)" />
    <path d="M4 30 C14 28 16 12 26 14 S40 26 46 18 S56 8 60 10" fill="none"
      stroke="var(--primary-color, #03a9f4)" stroke-width="2.5" stroke-linecap="round" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateSeriesStyle(raw);
    validateLayout(raw);
    validateStack(raw);
    validateNegativeColor(raw);
  },
  editor: areaEditor,
  entityFields: areaEntityFields,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render,
};
