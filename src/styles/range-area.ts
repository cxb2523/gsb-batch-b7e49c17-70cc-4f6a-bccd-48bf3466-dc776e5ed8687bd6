import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { validateAxisOptions } from '../chart/axes';
import {
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  seriesHeader,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries } from '../chart/frame';
import { chartArea, gridStyles, plotAxes, plotWidth, stopChartWidth } from '../chart/grid';
import type { PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { CURVES, runPath } from '../chart/paths';
import type { Curve, XY } from '../chart/paths';
import { extent } from '../chart/scale';
import { DEFAULT_LINE_WIDTH, validateSeriesStyle } from '../chart/series-style';
import {
  hoverHandlers,
  hoverTime,
  stopHover,
  tooltipEnabled,
  tooltipLayer,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import type { TooltipOptions } from '../chart/tooltip';
import {
  AXES_FIELDS,
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
import { LINE_WIDTH_SELECTOR } from '../editor/schemas';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import type { Point } from '../history/types';
import { localize } from '../localize';
import type { CardConfig } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

/**
 * Where a range area reads from when the card doesn't say: long-term statistics, which keep each
 * period's lowest, average and highest. History has no spread until it is grouped, so a history
 * range area with no grouping is grouped by hour (two days or less) or by day.
 */
export function rangeRaw(raw: CardConfig): CardConfig {
  const out: Record<string, unknown> = { ...raw, source: raw.source ?? 'statistics' };
  if (out.source === 'history' && raw.group_by === undefined) {
    const period = (raw.period ?? {}) as { last?: number; unit?: string; calendar?: string };
    const hours = (period.last ?? 24) * ({ hour: 1, day: 24, week: 168, month: 720 }[period.unit ?? 'hour'] ?? 1);
    out.group_by = period.calendar === 'day' || (!period.calendar && hours <= 48) ? 'hour' : 'day';
  }
  return out as CardConfig;
}

/** Corners of a stepped line, so the band's lower edge can be walked back along the same steps. */
function corners(pts: XY[]): XY[] {
  return pts.flatMap((p, i) => (i > 0 ? [[p[0], pts[i - 1][1]] as XY, p] : [p]));
}

/** The closed band between the highs and lows of one unbroken run. */
export function bandPath(highs: XY[], lows: XY[], curve: Curve): string {
  if (highs.length < 2) return '';
  const [h, l, c] = curve === 'step' ? [corners(highs), corners(lows), 'straight' as Curve] : [highs, lows, curve];
  return `${runPath(h, c)}${runPath([...l].reverse(), c).replace(/^M/, 'L')}Z`;
}

/** Unbroken runs of points that have a value; each point's low and high default to its value. */
export function bandRuns(points: Point[]): { t: number; v: number; lo: number; hi: number }[][] {
  const out: { t: number; v: number; lo: number; hi: number }[][] = [];
  let run: { t: number; v: number; lo: number; hi: number }[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (run.length) out.push(run);
      run = [];
      continue;
    }
    run.push({ t: p.t, v: p.v, lo: p.min ?? p.v, hi: p.max ?? p.v });
  }
  if (run.length) out.push(run);
  return out;
}

function drawSeries(s: ChartSeries, scales: PlotScales, mean: boolean, width: number) {
  const bands: string[] = [];
  const edges: string[] = [];
  const lines: string[] = [];
  for (const run of bandRuns(s.points)) {
    const highs = run.map((p) => [scales.x(p.t), scales.y(p.hi)] as XY);
    const lows = run.map((p) => [scales.x(p.t), scales.y(p.lo)] as XY);
    bands.push(bandPath(highs, lows, s.curve));
    edges.push(runPath(highs, s.curve), runPath(lows, s.curve));
    lines.push(
      runPath(
        run.map((p) => [scales.x(p.t), scales.y(p.v)] as XY),
        s.curve,
      ),
    );
  }
  return svg`<g class="series" data-series=${s.index}>
    <path class="band" d=${bands.join('')} fill=${s.color} stroke="none"></path>
    <path class="band-edge" d=${edges.join('')} fill="none" stroke=${s.color}></path>
    ${
      mean
        ? svg`<path class="line ${s.dash ? 'dashed' : ''}" d=${lines.join('')} fill="none" stroke=${s.color}
            style="stroke-width:${width}px"></path>`
        : nothing
    }
  </g>`;
}

function render(ctx0: ChartContext): TemplateResult {
  const ctx = { ...ctx0, raw: rangeRaw(ctx0.raw) };
  const frame = historyFrame(ctx, Date.now(), { range: true });
  const nav = periodNav(frame, ctx);
  const names = seriesHeader(frame, ctx);
  const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
  const message = frameMessage(frame, ctx);
  const layout = chartLayout(ctx.raw);
  if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
  const series = frame.series;
  const axes = plotAxes(ctx, frame.range, extent(series.map((s) => s.points)));
  const mean = ctx.raw.mean !== false;
  const width = (ctx.raw.line_width as number | undefined) ?? DEFAULT_LINE_WIDTH;
  const tip: TooltipOptions = {
    text: (s, p) => {
      if (!p || p.v === null) return '—';
      const f = (v: number) => formatNumber(v, s.entity.decimals, ctx.hass);
      const lo = p.min ?? p.v;
      const hi = p.max ?? p.v;
      return withUnit(`${f(lo)} – ${f(hi)}`, s.entity.unit) + (mean ? ` · ${f(p.v)}` : '');
    },
  };
  if (!mean) tip.dotY = () => null;
  const tooltip = tooltipEnabled(ctx.raw);
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_range_area'),
    names: frame.series.map((s) => s.entity.name).join(', '),
  });
  return chartFrame(
    layout,
    header,
    chartArea({
      axes,
      ctx,
      content: svg`${series.map((s) => drawSeries(s, axes.scales, mean, width))}`,
      label,
      overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}
      ${tooltip ? tooltipLayer(ctx, series, axes.scales, hoverTime(ctx.host), plotWidth(ctx), tip) : nothing}`,
      hover: tooltip
        ? hoverHandlers(
            ctx,
            frame.range,
            series.map((s) => s.points),
          )
        : undefined,
    }),
  );
}

const RANGE_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS.map((f) => (f.name === 'source' ? { ...f, default: 'statistics' } : f)),
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'mean', path: ['mean'], default: true },
  { name: 'line_width', path: ['line_width'], default: DEFAULT_LINE_WIDTH },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

export function rangeAreaEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`range_area|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ctx.config),
    { name: 'curve', selector: choice(ctx.hass, 'curve', CURVES) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'mean', selector: { boolean: {} } },
        { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
      ],
    },
    ...axesSchema(ctx.hass),
    ...layoutSchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, RANGE_FIELDS);
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'range_color', path: ['color'] },
  { name: 'curve', path: ['curve'] },
  { name: 'dash', path: ['dash'], default: false },
];

export const rangeArea: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    .plot .band {
      fill-opacity: 0.22;
    }
    .plot .band-edge {
      stroke-width: 1px;
      stroke-opacity: 0.45;
    }
    .plot .series .line {
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .plot .series .line.dashed {
      stroke-dasharray: 6 5;
    }
  `,
  thumbnail: () => svg`
    <path d="M4 18 C14 12 22 8 32 12 S50 20 60 10 V24 C50 32 42 26 32 28 S14 32 4 30 Z"
      fill="var(--primary-color, #03a9f4)" fill-opacity="0.25" />
    <path d="M4 24 C14 22 22 18 32 20 S50 26 60 17" fill="none"
      stroke="var(--primary-color, #03a9f4)" stroke-width="2.5" stroke-linecap="round" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateSeriesStyle(raw);
    validateLayout(raw);
    if (raw.mean !== undefined && typeof raw.mean !== 'boolean') throw new Error('"mean" must be true or false');
  },
  editor: rangeAreaEditor,
  entityFields: (hass) => ({
    schema: cachedSchema('range-area-entity', hass, () => [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'range_color', selector: { text: {} } },
          { name: 'curve', selector: choice(hass, 'curve', CURVES) },
          { name: 'dash', selector: { boolean: {} } },
        ],
      },
    ]),
    fields: ENTITY_FIELDS,
  }),
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render,
};
