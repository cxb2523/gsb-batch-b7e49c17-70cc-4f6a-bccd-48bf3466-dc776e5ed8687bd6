import { css, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import {
  CATEGORY_FIELDS,
  bandTooltip,
  categoryGeometry,
  categoryOptions,
  categoryPlot,
  categorySchema,
  categoryStyles,
  hoveredBand,
  labelCount,
  numberScale,
  stopCategoryHover,
  validateCategoryOptions,
} from '../chart/category-plot';
import type { Category, CategoryGeometry } from '../chart/category-plot';
import {
  bandwidth,
  densityCurve,
  jitter,
  readingsOf,
  sampleReadings,
  splitReadings,
  summarize,
} from '../chart/density';
import type { Reading, Summary } from '../chart/density';
import {
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries } from '../chart/frame';
import { stopChartWidth } from '../chart/grid';
import { chartFrame, chartLayout, layoutStyles } from '../chart/layout';
import type { XY } from '../chart/paths';
import { dotsPath } from '../chart/series-style';
import { tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import {
  HISTORY_FIELDS,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  historyVariant,
} from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import { boundaries } from '../history/timezone';
import type { Zone } from '../history/timezone';
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const SHAPES = ['violin', 'raincloud'] as const;
export type Shape = (typeof SHAPES)[number];

export const SPLITS = ['none', 'day', 'week', 'month'] as const;
export type Split = (typeof SPLITS)[number];

/** Half a violin's widest point, as a share of its band. */
const HALF = 0.42;
/** At most this many readings are drawn as dots per shape; the shape itself uses them all. */
const MAX_DOTS = 300;
/** A band wider than this (px) draws its shape as if it were this wide. */
const MAX_BAND_PX = 110;

/** One shape to draw: an entity, or an entity's day / week / month. */
interface Group {
  series: ChartSeries;
  readings: Reading[];
  summary?: Summary;
  name: string;
  detail: string;
}

export interface ViolinOptions {
  shape: Shape;
  box: boolean;
  readings: boolean;
  bandwidth?: number;
  split: Split;
}

export function violinOptions(raw: CardConfig): ViolinOptions {
  const shape = (raw.shape as Shape | undefined) ?? 'violin';
  return {
    shape,
    box: raw.box !== false,
    readings: (raw.readings as boolean | undefined) ?? shape === 'raincloud',
    bandwidth: typeof raw.bandwidth === 'number' ? raw.bandwidth : undefined,
    split: (raw.split_by as Split | undefined) ?? 'none',
  };
}

function dateName(t: number, split: Split, zone: Zone, hass: HomeAssistant | undefined): string {
  const options: Intl.DateTimeFormatOptions =
    split === 'month'
      ? { month: 'short', year: 'numeric', timeZone: zone.timeZone }
      : { weekday: split === 'day' ? 'short' : undefined, day: 'numeric', month: 'short', timeZone: zone.timeZone };
  try {
    return new Intl.DateTimeFormat(hass?.locale?.language ?? hass?.language ?? 'en', options).format(t);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(t);
  }
}

const median = (s: Summary | undefined, series: ChartSeries, hass: HomeAssistant | undefined) =>
  s ? withUnit(formatNumber(s.median, series.entity.decimals, hass), series.entity.unit) : '';

/** The shapes to draw: one per entity, or per entity and period (empty periods left out). */
function groupsOf(
  series: ChartSeries[],
  readings: Reading[][],
  o: ViolinOptions,
  bounds: number[],
  weighted: boolean,
  zone: Zone,
  hass: HomeAssistant | undefined,
): Group[] {
  const detail = (s: Summary | undefined, ser: ChartSeries) =>
    s ? localize(hass, 'violin_median', { value: median(s, ser, hass) }) : localize(hass, 'violin_none');
  if (o.split === 'none') {
    return series.map((ser, i) => {
      const summary = summarize(readings[i]);
      return { series: ser, readings: readings[i], summary, name: ser.entity.name, detail: detail(summary, ser) };
    });
  }
  const parts = series.map((_, i) => splitReadings(readings[i], bounds, weighted));
  const out: Group[] = [];
  for (let p = 0; p + 1 < bounds.length; p++) {
    for (let i = 0; i < series.length; i++) {
      const r = parts[i][p];
      if (r.length === 0) continue;
      const summary = summarize(r);
      const date = dateName(bounds[p], o.split, zone, hass);
      out.push({
        series: series[i],
        readings: r,
        summary,
        name: series.length > 1 ? `${date} · ${series[i].entity.name}` : date,
        detail: detail(summary, series[i]),
      });
    }
  }
  return out;
}

/** A closed outline through `left` and back along `right`. */
function outline(left: XY[], right: XY[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  const pts = [...left, ...[...right].reverse()];
  return `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join('')}Z`;
}

/** A rectangle between two corners, whichever way round the plot is. */
function rectBetween([x0, y0]: XY, [x1, y1]: XY) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** The violin (or a raincloud's half) for one group. */
export function shapePath(
  curve: { x: number; d: number }[],
  g: CategoryGeometry,
  i: number,
  half: boolean,
  base = 0,
  size = HALF,
): string {
  if (curve.length === 0) return '';
  const left = curve.map((p) => g.at(p.x, i, base - p.d * size));
  const right = curve.map((p) => g.at(p.x, i, half ? base : base + p.d * size));
  return outline(left, right);
}

/** Where a reading's dot sits across its band: scattered inside the violin, or in the rain. */
function dotOffset(k: number, d: number, raincloud: boolean): number {
  return raincloud ? 0.3 + jitter(k) * 0.22 : jitter(k) * 1.6 * HALF * d;
}

function densityAt(curve: { x: number; d: number }[], v: number): number {
  if (curve.length === 0) return 0;
  let j = 0;
  while (j < curve.length - 1 && curve[j + 1].x < v) j++;
  const a = curve[j];
  const b = curve[Math.min(curve.length - 1, j + 1)];
  if (b.x === a.x) return a.d;
  return a.d + ((b.d - a.d) * (v - a.x)) / (b.x - a.x);
}

function drawGroup(
  group: Group,
  i: number,
  g: CategoryGeometry,
  o: ViolinOptions,
  domain: [number, number],
): SVGTemplateResult {
  const { summary: s, series } = group;
  if (!s) return svg``;
  const h = o.bandwidth ?? bandwidth(group.readings);
  const curve = densityCurve(group.readings, h, domain);
  const rain = o.shape === 'raincloud';
  // Wide columns (few entities standing up) keep a violin's width, rather than growing fat.
  const k = Math.min(1, MAX_BAND_PX / g.bandPx);
  // A raincloud: the cloud above its line, the box just under it, the readings falling below.
  const shape = svg`<path class="shape" d=${shapePath(curve, g, i, rain, rain ? -0.04 * k : 0, (rain ? 0.44 : HALF) * k)}
    fill=${series.color} stroke=${series.color}></path>`;
  const boxAt = rain ? 0.08 * k : 0;
  const iqr = rectBetween(g.at(s.q1, i, boxAt - 0.045 * k), g.at(s.q3, i, boxAt + 0.045 * k));
  const [lx, ly] = g.at(s.low, i, boxAt);
  const [hx, hy] = g.at(s.high, i, boxAt);
  const box = o.box
    ? svg`<g class="box">
        <line class="whisker" x1=${lx} y1=${ly} x2=${hx} y2=${hy} stroke=${series.color}></line>
        <rect class="iqr" x=${iqr.x} y=${iqr.y} width=${iqr.width} height=${iqr.height} fill=${series.color}></rect>
        <path class="median" d=${dotsPath([g.at(s.median, i, boxAt)])}></path>
      </g>`
    : nothing;
  const dots = o.readings
    ? svg`<path class="dots" stroke=${series.color} d=${dotsPath(
        sampleReadings(group.readings, MAX_DOTS).map((r, n) =>
          g.at(r.v, i, k * dotOffset(n, densityAt(curve, r.v), rain)),
        ),
      )}></path>`
    : nothing;
  return svg`<g class="group">${shape}${box}${dots}</g>`;
}

const pctRow = (s: Summary, ser: ChartSeries, hass: HomeAssistant | undefined): [string, string][] => {
  const f = (v: number) => formatNumber(v, ser.entity.decimals, hass);
  const u = (t: string) => withUnit(t, ser.entity.unit);
  return [
    [localize(hass, 'dist_median'), u(f(s.median))],
    [localize(hass, 'dist_middle'), u(`${f(s.q1)} – ${f(s.q3)}`)],
    [localize(hass, 'dist_range'), u(`${f(s.min)} – ${f(s.max)}`)],
    [localize(hass, 'dist_count'), formatNumber(s.n, 0, hass)],
  ];
};

const VIOLIN_FIELDS_BASE: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'shape', path: ['shape'], default: 'violin' },
  { name: 'box', path: ['box'], default: true },
  { name: 'split_by', path: ['split_by'], default: 'none' },
  { name: 'bandwidth', path: ['bandwidth'] },
  ...CATEGORY_FIELDS,
];

const fieldsByShape = new Map<Shape, FieldBinding[]>();

/** The fields, with "every reading as a dot" defaulting on for a raincloud and off for a violin. */
function violinFields(shape: Shape): FieldBinding[] {
  let fields = fieldsByShape.get(shape);
  if (!fields) {
    fields = [...VIOLIN_FIELDS_BASE, { name: 'readings', path: ['readings'], default: shape === 'raincloud' }];
    fieldsByShape.set(shape, fields);
  }
  return fields;
}

export function violinEditor(ctx: ChartEditorContext): TemplateResult {
  const o = violinOptions(ctx.config);
  const schema = cachedSchema(`violin|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ctx.config),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'shape', selector: choice(ctx.hass, 'shape', SHAPES) },
        { name: 'split_by', selector: choice(ctx.hass, 'split_by', SPLITS) },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'box', selector: { boolean: {} } },
        { name: 'readings', selector: { boolean: {} } },
      ],
    },
    { name: 'bandwidth', selector: { number: { min: 0, mode: 'box', step: 'any' } } },
    ...categorySchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, violinFields(o.shape));
}

const ENTITY_FIELDS = {
  schema: [{ name: 'fill_color', selector: { text: {} } }],
  fields: [{ name: 'fill_color', path: ['color'] }],
};

export const violin: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 240,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${categoryStyles}
    .style-violin .shape {
      fill-opacity: 0.35;
      stroke-width: 1.5px;
      stroke-linejoin: round;
    }
    .style-violin .whisker {
      stroke-width: 1.5px;
    }
    .style-violin .median {
      stroke: var(--card-background-color, #fff);
      stroke-width: 6px;
      stroke-linecap: round;
    }
    .style-violin .dots {
      fill: none;
      stroke-width: 4px;
      stroke-linecap: round;
      stroke-opacity: 0.7;
    }
  `,
  thumbnail: () => svg`
    <path d="M6 14 C14 6 22 6 32 10 S50 6 58 14 C50 22 42 18 32 18 S14 22 6 14 Z"
      fill="var(--primary-color, #03a9f4)" fill-opacity="0.4" stroke="var(--primary-color, #03a9f4)" stroke-width="1.5" />
    <line x1="18" x2="46" y1="14" y2="14" stroke="var(--primary-color, #03a9f4)" stroke-width="1.5" />
    <rect x="26" y="12" width="12" height="4" fill="var(--primary-color, #03a9f4)" />
    <path d="M10 32 C18 24 26 22 34 26 S50 26 56 32 Z" fill="var(--success-color, #43a047)" fill-opacity="0.4"
      stroke="var(--success-color, #43a047)" stroke-width="1.5" />
    <g fill="var(--success-color, #43a047)"><circle cx="20" cy="36" r="1.3" /><circle cx="28" cy="37" r="1.3" />
      <circle cx="34" cy="35.5" r="1.3" /><circle cx="42" cy="37" r="1.3" /></g>`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateTooltipOptions(raw);
    validateCategoryOptions(raw);
    if (raw.shape !== undefined && !SHAPES.includes(raw.shape as Shape)) {
      throw new Error(`"shape" must be one of: ${SHAPES.join(', ')}`);
    }
    if (raw.split_by !== undefined && !SPLITS.includes(raw.split_by as Split)) {
      throw new Error(`"split_by" must be one of: ${SPLITS.join(', ')}`);
    }
    for (const k of ['box', 'readings']) {
      if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
    }
    const bw = raw.bandwidth;
    if (bw !== undefined && !(typeof bw === 'number' && Number.isFinite(bw) && bw > 0)) {
      throw new Error('"bandwidth" must be a number above 0');
    }
  },
  editor: violinEditor,
  entityFields: () => ENTITY_FIELDS,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopCategoryHover(host);
  },
  render(ctx: ChartContext) {
    const now = Date.now();
    const frame = historyFrame(ctx, now);
    const nav = periodNav(frame, ctx);
    const layout = { ...chartLayout(ctx.raw), header: 'above' as const };
    const message = frameMessage(frame, ctx);
    if (message) return chartFrame(layout, nav, message);
    const o = violinOptions(ctx.raw);
    const until = Math.min(frame.range.end, now);
    const weighted = frame.source === 'history' && !frame.group;
    const readings = frame.series.map((s) => readingsOf(s.points, weighted, until));
    const bounds = o.split === 'none' ? [] : boundaries(o.split, frame.range.start, until, frame.zone);
    const groups = groupsOf(frame.series, readings, o, bounds, weighted, frame.zone, ctx.hass);
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of groups) {
      if (!g.summary) continue;
      // Room for the tails, which run a little past the lowest and highest readings.
      const h = o.bandwidth ?? bandwidth(g.readings);
      lo = Math.min(lo, g.summary.min - h);
      hi = Math.max(hi, g.summary.max + h);
    }
    const options = categoryOptions(ctx.raw);
    const probe = categoryGeometry(ctx, groups.length, { domain: [0, 1] });
    const scale = numberScale(
      lo === Infinity ? undefined : [lo, hi],
      ctx.raw,
      labelCount(probe.valuePx, options.orientation),
      ctx.hass,
    );
    const geometry = categoryGeometry(ctx, groups.length, scale);
    const content = svg`${groups.map((g, i) => drawGroup(g, i, geometry, o, scale.domain))}`;
    const categories: Category[] = groups.map((g) => ({
      index: g.series.index,
      name: g.name,
      detail: g.detail,
      color: g.series.color,
      label: `${g.name}, ${g.detail}`,
    }));
    const tooltip = tooltipEnabled(ctx.raw);
    const at = tooltip ? hoveredBand(ctx.host) : undefined;
    const hovered = at === undefined ? undefined : groups[at];
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, o.shape === 'raincloud' ? 'violin_raincloud' : 'editor_style_violin'),
      names: frame.series.map((s) => s.entity.name).join(', '),
    });
    return chartFrame(
      layout,
      nav,
      categoryPlot({
        ctx,
        geometry,
        categories,
        scale,
        content,
        label,
        hover: tooltip,
        overlay:
          hovered?.summary && at !== undefined
            ? bandTooltip(
                geometry,
                at,
                hovered.name,
                pctRow(hovered.summary, hovered.series, ctx.hass),
                hovered.series.color,
              )
            : nothing,
      }),
    );
  },
};
