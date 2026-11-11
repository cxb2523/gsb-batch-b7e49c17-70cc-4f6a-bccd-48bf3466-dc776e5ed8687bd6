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
import type { Category, CategoryGeometry, ValueScale } from '../chart/category-plot';
import { dotReadings, sampleReadings, summarize } from '../chart/density';
import type { Reading, Summary } from '../chart/density';
import {
  disconnectHistory,
  frameMessage,
  frameStyles,
  historyFrame,
  periodNav,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { stopChartWidth } from '../chart/grid';
import { chartFrame, chartLayout, layoutStyles } from '../chart/layout';
import { jitter } from '../chart/scatter-plot';
import { dotsPath } from '../chart/series-style';
import { tooltipEnabled, tooltipStyles } from '../chart/tooltip';
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
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const STRIP_MARKERS = ['median', 'mean', 'none'] as const;
export type StripMarker = (typeof STRIP_MARKERS)[number];

export const DEFAULT_STRIP_DOT = 5;
export const MIN_STRIP_DOT = 2;
export const MAX_STRIP_DOT = 16;
/** How much of its row a strip spreads over, in percent. */
export const DEFAULT_JITTER = 70;
export const MAX_JITTER = 100;
/**
 * At most this many dots per row; more are evenly sampled (the count still says how many). Dots
 * are not packed, so a strip can draw far more of them than a beeswarm for the same cost.
 */
export const MAX_STRIP_DOTS = 2000;
/** A row's height across, before compact. */
const ROW_PX = 56;

export interface StripOptions {
  /** 0–1 of the row the dots spread over. */
  jitter: number;
  dot: number;
  marker: StripMarker;
}

export function stripOptions(raw: CardConfig): StripOptions {
  return {
    jitter: (typeof raw.jitter === 'number' ? raw.jitter : DEFAULT_JITTER) / 100,
    dot: typeof raw.dot_size === 'number' ? raw.dot_size : DEFAULT_STRIP_DOT,
    marker: (raw.marker as StripMarker | undefined) ?? 'median',
  };
}

/**
 * Where across its row each dot goes, as a fraction of the row (−0.5…0.5, 0 is the middle). The
 * offset comes from the reading's own time and the row, not its place in the list, so a dot
 * stays where it is as new readings arrive and old ones drop off: redraws don't shimmer. The
 * spread is `amount` of the row, less the dot itself so it stays inside.
 */
export function stripOffsets(times: number[], row: number, amount: number, dotPx: number, bandPx: number): number[] {
  const room = Math.max(0, amount - dotPx / Math.max(1, bandPx));
  return times.map((t) => (jitter(t, row) * room) / 2);
}

/** One row: the dots shown, and what the summary is worked out from (every reading, not the sample). */
interface Row {
  series: ChartSeries;
  shown: Reading[];
  summary?: Summary;
  total: number;
  /** The value the sensor held all period, when it took no reading in it (see `dotReadings`). */
  held?: number;
}

function rowsOf(frame: HistoryFrame, now: number): Row[] {
  const until = Math.min(frame.range.end, now);
  return frame.series.map((series) => {
    // One dot per reading taken in the period, or the one value a sensor held all period.
    const { readings, held } = dotReadings(series.points, frame.source === 'history' && !frame.group, until);
    return {
      series,
      shown: sampleReadings(readings, MAX_STRIP_DOTS),
      // Each reading counts once, as each is one dot: the marker sits among the dots it sums up.
      summary: summarize(readings),
      total: held === undefined ? readings.length : 0,
      ...(held === undefined ? {} : { held }),
    };
  });
}

function markerValue(row: Row, marker: StripMarker): number | undefined {
  if (!row.summary || marker === 'none') return undefined;
  return marker === 'mean' ? row.summary.mean : row.summary.median;
}

function fmt(row: Row, v: number, hass: HomeAssistant | undefined): string {
  return withUnit(formatNumber(v, row.series.entity.decimals, hass), row.series.entity.unit);
}

/** The line under a row's name: its marker's value, or how many readings it has. */
function detail(row: Row, marker: StripMarker, hass: HomeAssistant | undefined): string {
  if (row.held !== undefined) return localize(hass, 'swarm_no_change', { value: fmt(row, row.held, hass) });
  if (row.total === 0) return localize(hass, 'swarm_none');
  const v = markerValue(row, marker);
  if (v === undefined) return localize(hass, 'swarm_readings', { n: formatNumber(row.total, 0, hass) });
  return localize(hass, marker === 'mean' ? 'strip_mean_value' : 'strip_median_value', { value: fmt(row, v, hass) });
}

function drawRow(row: Row, i: number, g: CategoryGeometry, o: StripOptions): SVGTemplateResult {
  if (row.shown.length === 0) return svg``;
  const offsets = stripOffsets(
    row.shown.map((r) => r.t),
    row.series.index,
    o.jitter,
    o.dot,
    g.bandPx,
  );
  const pts = row.shown.map((r, k) => g.at(r.v, i, offsets[k]));
  // A value held all period is its own median and mean: a line there would only hide its dot.
  const v = row.held === undefined ? markerValue(row, o.marker) : undefined;
  const half = Math.max(o.jitter, 0.3) / 2 + 0.06;
  const marker =
    v === undefined
      ? nothing
      : (() => {
          const [x1, y1] = g.at(v, i, -half);
          const [x2, y2] = g.at(v, i, half);
          // A halo in the card's colour underneath keeps the line clear of the dots it sits among.
          return svg`<line class="strip-halo" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
            <line class="strip-marker ${o.marker}" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
        })();
  return svg`<g class="strip entity" data-index=${row.series.index} stroke=${row.series.color}>
    <path class="dots" d=${dotsPath(pts)} style="stroke-width:${o.dot}px"></path>
    ${marker}
  </g>`;
}

function tooltipRows(row: Row, hass: HomeAssistant | undefined): [string, string][] {
  const s = row.summary;
  if (!s) return [];
  const f = (v: number) => fmt(row, v, hass);
  if (row.held !== undefined) return [[localize(hass, 'swarm_held'), f(row.held)]];
  return [
    [localize(hass, 'dist_count'), formatNumber(row.total, 0, hass)],
    ...(row.shown.length < row.total
      ? ([[localize(hass, 'swarm_shown'), formatNumber(row.shown.length, 0, hass)]] as [string, string][])
      : []),
    [localize(hass, 'dist_median'), f(s.median)],
    [localize(hass, 'strip_mean'), f(s.mean)],
    [localize(hass, 'dist_middle'), `${f(s.q1)} – ${f(s.q3)}`],
    [localize(hass, 'dist_range'), `${f(s.min)} – ${f(s.max)}`],
  ];
}

const STRIP_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'strip_marker', path: ['marker'], default: 'median' },
  { name: 'strip_jitter', path: ['jitter'], default: DEFAULT_JITTER },
  { name: 'dot_size', path: ['dot_size'], default: DEFAULT_STRIP_DOT },
  ...CATEGORY_FIELDS,
];

function stripEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`strip_plot|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...historySchema(ctx.hass, ctx.config),
    { name: 'strip_marker', selector: choice(ctx.hass, 'strip_marker', STRIP_MARKERS) },
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'strip_jitter',
          selector: { number: { min: 0, max: MAX_JITTER, step: 5, mode: 'slider', unit_of_measurement: '%' } },
        },
        {
          name: 'dot_size',
          selector: {
            number: { min: MIN_STRIP_DOT, max: MAX_STRIP_DOT, step: 1, mode: 'box', unit_of_measurement: 'px' },
          },
        },
      ],
    },
    ...categorySchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, STRIP_FIELDS);
}

const ENTITY_FIELDS = {
  schema: [{ name: 'fill_color', selector: { text: {} } }],
  fields: [{ name: 'fill_color', path: ['color'] }],
};

export const stripPlot: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 240,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    ${layoutStyles}
    ${categoryStyles}
    .strip .dots {
      fill: none;
      stroke-linecap: round;
      stroke-opacity: 0.7;
    }
    .strip .strip-halo {
      stroke: var(--card-background-color, #fff);
      stroke-width: 5px;
      stroke-linecap: round;
    }
    .strip .strip-marker {
      stroke: var(--primary-text-color);
      stroke-width: 2px;
      stroke-linecap: round;
    }
  `,
  thumbnail: () => svg`
    <g fill="var(--primary-color, #03a9f4)" fill-opacity="0.6">
      ${[8, 12, 15, 17, 19, 20, 22, 24, 27, 31, 36].map(
        (x, k) => svg`<circle cx=${x + 6} cy=${12 + ((k * 7) % 5) - 2} r="2" />`,
      )}
    </g>
    <g fill="var(--warning-color, #f59e0b)" fill-opacity="0.6">
      ${[24, 29, 32, 35, 37, 39, 41, 44, 48, 53].map(
        (x, k) => svg`<circle cx=${x + 2} cy=${29 + ((k * 3) % 5) - 2} r="2" />`,
      )}
    </g>
    <path d="M26 6V18M41 23V35" stroke="var(--primary-text-color, #212121)" stroke-width="2" stroke-linecap="round" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateCategoryOptions(raw);
    if (raw.marker !== undefined && !STRIP_MARKERS.includes(raw.marker as StripMarker)) {
      throw new Error(`"marker" must be one of: ${STRIP_MARKERS.join(', ')}`);
    }
    const j = raw.jitter;
    if (j !== undefined && !(typeof j === 'number' && j >= 0 && j <= MAX_JITTER)) {
      throw new Error(`"jitter" must be a number from 0 to ${MAX_JITTER}`);
    }
    const dot = raw.dot_size;
    if (dot !== undefined && !(typeof dot === 'number' && dot >= MIN_STRIP_DOT && dot <= MAX_STRIP_DOT)) {
      throw new Error(`"dot_size" must be a number from ${MIN_STRIP_DOT} to ${MAX_STRIP_DOT}`);
    }
  },
  editor: stripEditor,
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
    const o = stripOptions(ctx.raw);
    const rows = rowsOf(frame, now);
    const options = categoryOptions(ctx.raw);
    const probe = categoryGeometry(ctx, rows.length, { domain: [0, 1] }, ROW_PX);
    const count = labelCount(probe.valuePx, options.orientation);
    const all = rows.flatMap((r) => (r.summary ? [r.summary.min, r.summary.max] : []));
    const scale: ValueScale = numberScale(
      all.length ? [Math.min(...all), Math.max(...all)] : undefined,
      ctx.raw,
      count,
      ctx.hass,
    );
    const geometry = categoryGeometry(ctx, rows.length, scale, ROW_PX);
    const content = svg`${rows.map((row, i) => drawRow(row, i, geometry, o))}`;
    const categories: Category[] = rows.map((row) => {
      const d = detail(row, o.marker, ctx.hass);
      return {
        index: row.series.index,
        name: row.series.entity.name,
        detail: d,
        color: row.series.color,
        label: `${row.series.entity.name}, ${d}`,
      };
    });
    const tooltip = tooltipEnabled(ctx.raw);
    const at = tooltip ? hoveredBand(ctx.host) : undefined;
    const hovered = at === undefined ? undefined : rows[at];
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_strip_plot'),
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
          hovered && hovered.summary && at !== undefined
            ? bandTooltip(
                geometry,
                at,
                hovered.series.entity.name,
                tooltipRows(hovered, ctx.hass),
                hovered.series.color,
              )
            : nothing,
      }),
    );
  },
};
