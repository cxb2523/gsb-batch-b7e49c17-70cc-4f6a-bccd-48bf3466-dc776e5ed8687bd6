import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { downsample } from '../chart/downsample';
import { validateAxisOptions } from '../chart/axes';
import {
  VIEW_H,
  VIEW_W,
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
import type { PlotAxes, PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { runPath, runs } from '../chart/paths';
import { MAX_DOTS, dotSize, dotsPath, drawOrder, seriesStyle, validateSeriesStyle } from '../chart/series-style';
import {
  hoverHandlers,
  hoverTime,
  stopHover,
  tooltipEnabled,
  tooltipLayer,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import { extent } from '../chart/scale';
import {
  overviewLines,
  overviewStrip,
  stopZoom,
  validateZoomOptions,
  visiblePoints,
  zoomBusy,
  zoomGestures,
  zoomLayer,
  zoomStyles,
  zoomView,
} from '../chart/zoom';
import {
  annotationEntities,
  annotationLayers,
  annotationUnit,
  annotationStyles,
  annotationValues,
  stopAnnotations,
  validateAnnotations,
} from '../chart/annotations';
import {
  extremesLayer,
  extremesOn,
  extremesOptions,
  extremesStyles,
  validateExtremes,
  withEntityExtremes,
  withEntityExtremesFields,
} from '../chart/extremes';
import { dataLabelStyles, dataLabels, labelOptions, validateLabelOptions } from '../chart/data-labels';
import { stopSync, syncChart, validateSyncOptions } from '../chart/sync';
import { nowMarkerLayer, nowMarkerStyles, stopNowMarker, validateNowMarker } from '../chart/now-marker';
import { multiplesGrid, multiplesOptions, multiplesStyles, validateMultiples } from '../chart/multiples';
import { positivePoints } from '../chart/log-scale';
import { conditionStrip, conditionStyles, ghostLines } from '../chart/condition-strip';
import { ghostOn } from '../history/condition';
import {
  forecastEntities,
  forecastLabel,
  forecastLayer,
  forecastLines,
  forecastStyles,
  forecastTooltipSeries,
  stopForecast,
  validateForecast,
  withForecastFields,
} from '../chart/forecast';
import { anomalyLayer, anomalyStyles, validateAnomalies } from '../chart/anomaly';
import {
  compareGhosts,
  compareKey,
  compareStyles,
  ghostLines as compareLines,
  stopCompare,
  validateCompare,
} from '../chart/compare-ghost';
import { lineEditor } from '../editor/chart-editors';
import { entitySeriesFields, entitySeriesSchema } from '../editor/schemas';
import { localize } from '../localize';
import type { ChartContext, ChartStyleModule } from './index';
import type { Range } from '../history/types';
import type { CardConfig, ResolvedBand } from '../types';

/** Points kept per series after thinning: about two per pixel on a wide card. */
const MAX_POINTS = 500;

const COLOR_BY = ['series', 'bands'] as const;

/**
 * A vertical gradient with a hard stop at each band's start, in plot coordinates, so a line
 * changes colour where it crosses a threshold.
 */
function bandGradient(id: string, bands: ResolvedBand[], scales: PlotScales): SVGTemplateResult {
  // Through the scale, so a log axis puts each stop where the value is drawn (zero and below: the bottom).
  const stop = (v: number) => {
    const at = (VIEW_H - scales.y(v)) / VIEW_H;
    return Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : 0;
  };
  const stops: SVGTemplateResult[] = [];
  bands.forEach((band, i) => {
    const from = Number.isFinite(band.from) ? stop(band.from) : 0;
    const to = i + 1 < bands.length ? stop(bands[i + 1].from) : 1;
    const color = baseColor(band.color);
    stops.push(svg`<stop offset=${from} stop-color=${color}></stop><stop offset=${to} stop-color=${color}></stop>`);
  });
  return svg`<linearGradient id=${id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1=${VIEW_H} y2="0">
    ${stops}
  </linearGradient>`;
}

/** One series' line (and dots), for the line chart and the combined chart. */
export function seriesPath(s: ChartSeries, scales: PlotScales, stroke: string, range: Range, raw: CardConfig) {
  const style = seriesStyle(s.entity.config, raw);
  const thinned = downsample(s.points, MAX_POINTS);
  const d = runs(thinned)
    .map((run) =>
      runPath(
        run.map((p) => [scales.x(p.t), scales.y(p.v as number)]),
        s.curve,
      ),
    )
    .join('');
  // Dots mark real readings: not the carried value at the edges, and not on a crowded series.
  const readings = style.dots ? thinned.filter((p) => p.v !== null && p.t !== range.start && p.t !== range.end) : [];
  const dots =
    readings.length > 0 && readings.length <= MAX_DOTS
      ? svg`<path
          class="dots"
          d=${dotsPath(readings.map((p) => [scales.x(p.t), scales.y(p.v as number)]))}
          fill="none"
          stroke=${stroke}
          style="stroke-width:${dotSize(style.width)}px"
        ></path>`
      : nothing;
  return svg`<g class="series" data-series=${s.index}>
    <path
      class="line ${s.dash ? 'dashed' : ''}"
      d=${d}
      fill="none"
      stroke=${stroke}
      style="stroke-width:${style.width}px"
    ></path>
    ${dots}
  </g>`;
}

/** Value labels on the line's readings, kept clear of each other. */
function pointLabels(
  frame: HistoryFrame,
  series: ChartSeries[],
  view: Range,
  scales: PlotScales,
  options: NonNullable<ReturnType<typeof labelOptions>>,
  compact: boolean,
  ctx: Parameters<ChartStyleModule['render']>[0],
) {
  const { range } = frame;
  return dataLabels(
    series.map((s) => ({
      points: s.points.filter((p) => p.t >= view.start && p.t <= view.end),
      decimals: s.entity.decimals,
      color: s.color,
    })),
    options,
    {
      at: (p) => [scales.x(p.t) / VIEW_W, scales.y(p.v as number) / VIEW_H],
      width: plotWidth(ctx),
      // The plot's height less its time labels, roughly.
      height: compact ? 96 : 162,
      // The points at either edge are carried readings, not new ones (groups are all real).
      skip: (p) => frame.group === undefined && (p.t === range.start || p.t === range.end),
    },
    ctx.hass,
  );
}

/**
 * One plot of `series`: the lines, value labels, tooltip and gridlines. `id` keeps band gradient
 * ids apart when a card draws several plots (small multiples).
 */
/** Rough height of the plot itself in px: the frame less the time labels and top padding. */
function plotHeight(compact: boolean, axes: { x: boolean; y: boolean; labels: string }): number {
  const outside = axes.labels === 'outside';
  return (compact ? 110 : 180) - (outside && axes.x ? (compact ? 14 : 18) : 0) - (outside && axes.y ? 6 : 0);
}

/** Roughly where a header laid over the plot sits, in px, so marks' labels keep clear of it. */
function overHeaderBox(frame: HistoryFrame, compact: boolean, width: number) {
  const chars = frame.series.reduce((n, s) => n + s.entity.name.length + s.entity.display.length + 6, 0);
  return { l: 0, t: 0, r: Math.min(width, chars * 8), b: compact ? 24 : 34 };
}

function linePlot(
  ctx: ChartContext,
  frame: HistoryFrame,
  series: ChartSeries[],
  axes: PlotAxes,
  width: number,
  id: string,
  over: TemplateResult | typeof nothing = nothing,
  time = hoverTime(ctx.host),
) {
  const { scales } = axes;
  const labels = labelOptions(ctx.raw);
  const tooltip = tooltipEnabled(ctx.raw);
  const byBands = ctx.raw.color_by === 'bands';
  const defs = byBands
    ? svg`${series.map((s) => bandGradient(`cd-bands-${s.index}${id}`, s.entity.bands, scales))}`
    : nothing;
  // Listed order, last on top, with any series marked "on top" drawn after the rest.
  const ordered = drawOrder(series, (s) => seriesStyle(s.entity.config, ctx.raw).onTop);
  const lines = svg`${ordered.map((s) =>
    seriesPath(s, scales, byBands ? `url(#cd-bands-${s.index}${id})` : s.color, frame.range, ctx.raw),
  )}`;
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_line'),
    names: series.map((s) => s.entity.name).join(', '),
  });
  return chartArea({
    axes,
    ctx,
    content: svg`${ghostLines(series, scales)}${lines}`,
    label,
    defs,
    overlay: html`${over} ${labels ? pointLabels(frame, series, frame.range, scales, labels, true, ctx) : nothing}
    ${tooltip ? tooltipLayer(ctx, series, scales, time, width) : nothing}`,
    hover: tooltip
      ? hoverHandlers(
          ctx,
          frame.range,
          series.map((s) => s.points),
        )
      : undefined,
  });
}

export const line: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${zoomStyles}
    ${annotationStyles}
    ${dataLabelStyles}
    ${extremesStyles}
    ${multiplesStyles}
    ${conditionStyles}
    ${forecastStyles}
    ${anomalyStyles}
    ${compareStyles}
    ${nowMarkerStyles}
    .style-line .line {
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .style-line .dots {
      stroke-linecap: round;
    }
    .style-line .line.dashed {
      stroke-dasharray: 6 5;
    }
  `,
  thumbnail: () => svg`
    <path d="M4 30 C14 28 16 14 26 16 S40 26 46 18 S56 8 60 10" fill="none"
      stroke="var(--primary-color, #03a9f4)" stroke-width="3" stroke-linecap="round" />
    <path d="M4 34 C16 33 22 26 32 28 S50 30 60 24" fill="none" stroke="var(--warning-color, #f59e0b)"
      stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 3" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateSeriesStyle(raw);
    validateLayout(raw);
    validateZoomOptions(raw);
    validateAnnotations(raw);
    validateLabelOptions(raw);
    validateExtremes(raw);
    validateSyncOptions(raw);
    validateMultiples(raw);
    validateForecast(raw);
    validateAnomalies(raw);
    validateCompare(raw);
    validateNowMarker(raw);
    if (raw.color_by !== undefined && !COLOR_BY.includes(raw.color_by as (typeof COLOR_BY)[number])) {
      throw new Error(`"color_by" must be one of: ${COLOR_BY.join(', ')}`);
    }
  },
  editor: lineEditor,
  entityFields: (hass, config) => {
    const schema = entitySeriesSchema(hass);
    const fields = entitySeriesFields(config.dots === true);
    // While the card marks highs, lows or averages, each series can opt out.
    const own = extremesOn(extremesOptions(config))
      ? { schema: withEntityExtremes(schema, hass), fields: withEntityExtremesFields(fields) }
      : { schema, fields };
    return withForecastFields(hass, own);
  },
  watch: (raw) => [...annotationEntities(raw), ...forecastEntities(raw)],
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
    stopZoom(host);
    stopAnnotations(host);
    stopSync(host);
    stopForecast(host);
    stopCompare(host);
    stopNowMarker(host);
  },
  render(ctx) {
    // Forecasts carry series on past now, stretching the span to show them.
    const ahead = forecastLayer(ctx, historyFrame(ctx, Date.now(), { ghost: ghostOn(ctx.raw) }));
    const frame = ahead.frame;
    // Charts in a sync group share the pointer's time: another chart's shows here too.
    const own = hoverTime(ctx.host);
    const shared = syncChart(ctx, frame, own);
    const nav = periodNav(frame, ctx);
    const names = seriesHeader(frame, ctx);
    // Earlier spans drawn faintly behind, moved over this one, named in a key under the header.
    const ghosts = compareGhosts(ctx, frame);
    const key = ctx.config.show.name ? compareKey(ctx, ghosts) : nothing;
    const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}${key}`;
    const message = frameMessage(frame, ctx);
    const layout = chartLayout(ctx.raw);
    if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
    const multiples = multiplesOptions(ctx.raw);
    if (multiples) {
      // A log axis has no place for zero or below: each small chart draws only the readings above it.
      const panels =
        ctx.raw.y_scale === 'log'
          ? {
              ...frame,
              series: frame.series.map((s) => ({
                ...s,
                points: positivePoints(s.points),
                ...(s.hidden ? { hidden: positivePoints(s.hidden) } : {}),
              })),
            }
          : frame;
      // One small chart per series: the period buttons stay above, each chart has its own title.
      return chartFrame(
        { ...layout, header: 'above' },
        nav,
        multiplesGrid(ctx, panels, multiples, own ?? shared, (s, axes, width) =>
          linePlot(ctx, panels, [s], axes, width, `-${s.index}`, nothing, own ?? shared),
        ),
      );
    }
    // Zoomed, the chart draws the readings in its window (and one either side), fitted to them.
    const zoom = zoomView(ctx, frame);
    const view = zoom.range;
    const log = ctx.raw.y_scale === 'log';
    const shown = zoom.zoomed
      ? frame.series.map((s) => ({
          ...s,
          points: visiblePoints(s.points, view),
          ...(s.hidden ? { hidden: visiblePoints(s.hidden, view) } : {}),
        }))
      : frame.series;
    const forecasts = ahead.series.map((s) => ({
      ...s,
      points: (log ? positivePoints : (p: typeof s.points) => p)(
        zoom.zoomed ? visiblePoints(s.points, view) : s.points,
      ),
    }));
    // A log axis has no place for zero or below: those readings are gaps in the drawing (the tooltip still reads them).
    const drawn = log
      ? shown.map((s) => ({
          ...s,
          points: positivePoints(s.points),
          ...(s.hidden ? { hidden: positivePoints(s.hidden) } : {}),
        }))
      : shown;
    const behind = ghosts.map((g) => {
      const points = zoom.zoomed ? visiblePoints(g.points, view) : g.points;
      return { ...g, points: log ? positivePoints(points) : points };
    });
    // Threshold lines widen the value axis, so a target off the readings' range still shows.
    const thresholds = annotationValues(ctx.raw, ctx.hass, annotationUnit(frame), ctx, frame)
      .filter((v) => !log || v > 0)
      .map((v) => ({ t: view.start, v }));
    // The faint line of hidden readings fits on the axis too, so it never runs off the plot.
    const hidden = drawn.flatMap((s) => (s.hidden ? [s.hidden] : []));
    const data = extent([
      ...drawn.map((s) => s.points),
      ...hidden,
      ...behind.map((s) => s.points),
      ...forecasts.map((s) => s.points),
      thresholds,
    ]);
    if (log && !data) {
      const empty = html`<div class="chart-message">${localize(ctx.hass, 'chart_log_nothing')}</div>`;
      return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, empty);
    }
    const axes = plotAxes(ctx, view, data);
    const { scales } = axes;
    const tooltip = tooltipEnabled(ctx.raw) && !zoomBusy(ctx.host);
    const byBands = ctx.raw.color_by === 'bands';
    const defs = byBands
      ? svg`${shown.map((s) => bandGradient(`cd-bands-${s.index}`, s.entity.bands, scales))}`
      : nothing;
    // Listed order, last on top, with any series marked "on top" drawn after the rest.
    const ordered = drawOrder(drawn, (s) => seriesStyle(s.entity.config, ctx.raw).onTop);
    const lines = svg`${ordered.map((s) =>
      seriesPath(s, scales, byBands ? `url(#cd-bands-${s.index})` : s.color, frame.range, ctx.raw),
    )}`;
    const hover = tooltipEnabled(ctx.raw)
      ? hoverHandlers(
          ctx,
          view,
          [...shown, ...forecasts].map((s) => s.points),
        )
      : undefined;
    const notes = annotationLayers(ctx, frame, scales, plotWidth(ctx));
    const labels = labelOptions(ctx.raw);
    const width = plotWidth(ctx);
    const marks = extremesLayer({
      ctx,
      series: shown,
      scales,
      range: view,
      group: frame.group,
      timeWeighted: frame.source === 'history' && frame.group === undefined,
      width,
      height: plotHeight(layout.compact, axes.options),
      until: Math.min(view.end, Date.now()),
      obstacles: layout.header === 'over' ? [overHeaderBox(frame, layout.compact, width)] : [],
    });
    // Readings far from their neighbours' mean, with the band of normal behind the lines.
    const anomalies = anomalyLayer({
      ctx,
      series: drawn,
      scales,
      range: view,
      width,
      height: plotHeight(layout.compact, axes.options),
      obstacles: layout.header === 'over' ? [overHeaderBox(frame, layout.compact, width)] : [],
    });
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_line'),
      names: frame.series.map((s) => s.entity.name).join(', '),
    });
    const strip = conditionStrip(
      ctx,
      frame,
      view,
      scales,
      zoom.options.overview ? overviewStrip(ctx, zoom, frame.range, overviewLines(frame.series, frame.range)) : nothing,
    );
    return chartFrame(
      layout,
      header,
      chartArea({
        axes,
        ctx,
        content: svg`${notes.behind}${compareLines(behind, scales)}${ghostLines(drawn, scales)}${anomalies.behind}${marks.lines}${forecastLines(forecasts, scales)}${lines}${notes.front}`,
        label,
        defs,
        overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}
        ${labels ? pointLabels(frame, drawn, view, scales, labels, layout.compact, ctx) : nothing}
        ${zoomLayer(ctx, zoom)} ${notes.overlay} ${marks.overlay} ${anomalies.overlay}
        ${nowMarkerLayer(ctx, frame, view, scales, width)}
        ${forecasts.length ? forecastLabel(ctx, forecasts, scales) : nothing}
        ${
          tooltip
            ? tooltipLayer(
                ctx,
                [...shown, ...behind, ...forecastTooltipSeries(ctx, forecasts, view.start)],
                scales,
                own ?? shared,
                plotWidth(ctx),
              )
            : nothing
        }`,
        hover,
        gestures: zoom.options.zoom ? zoomGestures(ctx, zoom, hover) : undefined,
        classes: zoom.options.zoom ? `zoomable ${zoom.zoomed ? 'zoomed' : ''}` : '',
        ...strip,
      }),
    );
  },
};
