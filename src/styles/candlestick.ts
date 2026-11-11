import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { formatDateTime, validateAxisOptions } from '../chart/axes';
import { candleExtent, historyCandles, statisticsCandles, underValues } from '../chart/candles';
import type { Candle } from '../chart/candles';
import {
  SERIES_COLORS,
  VIEW_H,
  VIEW_W,
  disconnectHistory,
  frameMessage,
  frameStyles,
  periodNav,
  seriesHeader,
  seriesTransform,
  validateHistoryOptions,
} from '../chart/frame';
import type { ChartSeries, HistoryFrame } from '../chart/frame';
import { chartArea, gridStyles, plotAxes, plotWidth, stopChartWidth } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { withLegend } from '../chart/legend-toggle';
import { runPath, runs } from '../chart/paths';
import { linear } from '../chart/scale';
import {
  hoverHandlers,
  hoverTime,
  nearestIndex,
  stopHover,
  tooltipEnabled,
  tooltipSide,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import {
  AXES_FIELDS,
  HISTORY_FIELDS,
  LAYOUT_FIELDS,
  axesSchema,
  cachedSchema,
  chartForm,
  choice,
  historySchema,
  layoutSchema,
} from '../editor/chart-editors';
import type { FieldBinding } from '../editor/schemas';
import { key } from '../history/fetch';
import type { StatisticsPeriod, StatisticsQuery } from '../history/fetch';
import { AGGREGATES, GROUP_UNITS } from '../history/group';
import type { Aggregate, GroupUnit } from '../history/group';
import { parsePeriod, periodRange, stepsFor } from '../history/period';
import { storeFor } from '../history/store';
import { convertPoints } from '../units';
import { chartConditions, conditionStatus, conditionalPoints } from '../history/condition';
import { boundaries, startOf, zoneFor } from '../history/timezone';
import type { Zone } from '../history/timezone';
import type { Point, Range, Source } from '../history/types';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const UNDERNEATH = ['columns', 'line'] as const;
export type Underneath = (typeof UNDERNEATH)[number];

/** A candle's body is this share of its period's width. */
const BODY = 0.7;
/** With series underneath, the candles take the top of the plot and they take this much of the bottom. */
const STRIP = 0.22;
/** The gap between the candles and the strip, as a share of the plot's height. */
const STRIP_GAP = 0.05;
/** The thinnest body (a period that closed where it opened), in plot units. */
const MIN_BODY = 1.5;

/** The card's period, with a candlestick's defaults: the last 14 days. */
export function candlePeriod(raw: CardConfig): CardConfig['period'] {
  const own = raw.period as Record<string, unknown> | undefined;
  return { last: 14, unit: 'day', ...(own ?? {}) } as CardConfig['period'];
}

function unitOf(raw: CardConfig): GroupUnit {
  return (raw.group_by as GroupUnit | undefined) ?? 'day';
}

function sourceOf(raw: CardConfig): Source {
  return (raw.source as Source | undefined) ?? 'statistics';
}

/**
 * Statistics rows to build candles from: five-minute rows for hourly candles, hourly rows for
 * daily ones (an open and close within the day), and daily rows for weeks and months when Home
 * Assistant's days are the card's own (otherwise hourly, cut up here). Mean, min, max and state,
 * so a measurement and a meter both have something.
 */
export function candleQuery(unit: GroupUnit, zone: Zone, serverTimeZone: string | undefined): StatisticsQuery {
  let period: StatisticsPeriod = 'hour';
  if (unit === 'hour') period = '5minute';
  else if (unit !== 'day' && zone.timeZone === serverTimeZone) period = 'day';
  return { period, types: ['mean', 'min', 'max', 'state'], value: 'mean' };
}

interface CandleFrame extends HistoryFrame {
  /** The first entity's candles, one per period (null where there is no reading). */
  candles: (Candle | null)[];
  unit: GroupUnit;
}

/**
 * Load the card's readings and turn them into candles (the first entity) and one value per
 * period for the rest. Like the line chart's history frame, but the candles need every reading
 * in a period, not one combined value, and the range always runs to the end of the last period.
 */
function candleFrame(ctx: ChartContext, now = Date.now()): CandleFrame {
  const period = parsePeriod(candlePeriod(ctx.raw));
  const source = sourceOf(ctx.raw);
  const unit = unitOf(ctx.raw);
  const aggregate = (ctx.raw.aggregate as Aggregate | undefined) ?? 'mean';
  const zone = zoneFor(ctx.hass);
  const span = periodRange(period, now, zone, period.navigate ? stepsFor(ctx.host, period) : 0);
  const start = startOf(unit, span.start, zone);
  const bounds = boundaries(unit, start, span.end, zone);
  const range: Range = { start, end: bounds[bounds.length - 1] };
  const until = Math.min(span.end, now);
  const requests = ctx.items.map((e) => ({ entity: e.entityId, attribute: e.config.attribute }));
  const store = storeFor(ctx.host, ctx.requestUpdate);
  const statistics = source === 'statistics' ? candleQuery(unit, zone, ctx.hass.config?.time_zone) : undefined;
  const loaded = store.get(ctx.hass, requests, { start, end: span.end }, source, { live: span.live, statistics });
  // Series with a `when` (their own or the card's) keep only the readings taken while it held.
  const conditions = chartConditions(ctx, { start, end: span.end }, span.live);
  let candles: (Candle | null)[] = [];
  const series = ctx.items.map((entity, index): ChartSeries => {
    const own = entity.config as typeof entity.config & { color?: string };
    const points = conditionalPoints(
      entity.config,
      convertPoints(loaded.data.get(key(requests[index])) ?? [], entity.conversion),
      conditions,
    );
    let grouped: Point[];
    // The entity's history transform (running total, rate of change), before the readings are grouped.
    const shown = seriesTransform(entity, points, range, until, zone, ctx.hass);
    if (index === 0) {
      candles =
        source === 'statistics'
          ? statisticsCandles(shown.points, bounds, until)
          : historyCandles(shown.points, bounds, until);
      grouped = candles.map((c, i) => ({ t: bounds[i], end: bounds[i + 1], v: c ? c.close : null }));
    } else {
      grouped = underValues(shown.points, bounds, aggregate, source, until);
    }
    return {
      index,
      entity: shown.entity,
      points: grouped,
      color: baseColor(own.color ?? (index === 0 ? SERIES_COLORS[0] : 'grey')),
      curve: 'smooth',
      dash: false,
    };
  });
  return {
    status: conditionStatus(loaded.status, conditions),
    error: loaded.error,
    range,
    period,
    source,
    series,
    live: span.live,
    back: span.back,
    zone,
    group: { unit, aggregate },
    candles,
    unit,
  };
}

/** A period's name in the tooltip: a time for hours, a date for days, "Week of …", a month. */
export function periodTitle(t: number, unit: GroupUnit, hass: HomeAssistant | undefined, zone: Zone): string {
  if (unit === 'hour') return formatDateTime(t, hass);
  const options: Intl.DateTimeFormatOptions =
    unit === 'month'
      ? { month: 'long', year: 'numeric', timeZone: zone.timeZone }
      : { weekday: unit === 'day' ? 'short' : undefined, day: 'numeric', month: 'short', timeZone: zone.timeZone };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(hass?.locale?.language ?? hass?.language ?? 'en', options);
  } catch {
    format = new Intl.DateTimeFormat('en', options);
  }
  const date = format.format(t);
  return unit === 'week' ? localize(hass, 'candle_week_of', { date }) : date;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

function candleTooltip(ctx: ChartContext, frame: CandleFrame, x: (t: number) => number, t: number | undefined) {
  if (t === undefined) return nothing;
  const mids = frame.series[0].points.map((p) => ({ t: (p.t + (p.end ?? p.t)) / 2 }));
  const i = nearestIndex(mids, t);
  if (i < 0) return nothing;
  const c = frame.candles[i];
  const at = x(mids[i].t) / VIEW_W;
  const side = tooltipSide(at, plotWidth(ctx));
  const first = frame.series[0].entity;
  const fmt = (v: number, s = first) => withUnit(formatNumber(v, s.decimals, ctx.hass), s.unit);
  const rows: [string, string, string?][] = c
    ? [
        [localize(ctx.hass, 'candle_open'), fmt(c.open)],
        [localize(ctx.hass, 'candle_high'), fmt(c.high)],
        [localize(ctx.hass, 'candle_low'), fmt(c.low)],
        [localize(ctx.hass, 'candle_close'), fmt(c.close)],
      ]
    : [[first.name, '—']];
  for (const s of frame.series.slice(1)) {
    const v = s.points[i]?.v;
    rows.push([s.entity.name, v === null || v === undefined ? '—' : fmt(v, s.entity), s.color]);
  }
  return html`<div class="hover-layer" aria-hidden="true">
    <div class="crosshair" style="left:${pct(at)}"></div>
    <div class="tooltip ${side}" style=${side.startsWith('pin') ? '' : `left:${pct(at)}`}>
      <div class="tooltip-time">${periodTitle(frame.series[0].points[i].t, frame.unit, ctx.hass, frame.zone)}</div>
      ${rows.map(
        ([name, value, color]) =>
          html`<div class="tooltip-row">
            ${color ? html`<span class="swatch" style="background:${color}"></span>` : nothing}
            <span class="tooltip-name">${name}</span>
            <span class="tooltip-value">${value}</span>
          </div>`,
      )}
    </div>
  </div>`;
}

/** The series under the candles, each scaled to its own largest value, in the strip at the bottom. */
function underneath(frame: CandleFrame, x: (t: number) => number, kind: Underneath): SVGTemplateResult {
  const under = frame.series.slice(1);
  const top = VIEW_H * (1 - STRIP);
  return svg`${under.map((s, n) => {
    const values = s.points.map((p) => p.v).filter((v): v is number => v !== null);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const y = linear([lo, hi === lo ? lo + 1 : hi], [VIEW_H, top]);
    if (kind === 'line') {
      const d = runs(s.points)
        .map((run) =>
          runPath(
            run.map((p) => [x((p.t + (p.end ?? p.t)) / 2), y(p.v as number)]),
            'straight',
          ),
        )
        .join('');
      return svg`<path class="under-line entity" data-index=${s.index} d=${d} fill="none" stroke=${s.color}></path>`;
    }
    return svg`<g class="under-columns entity" data-index=${s.index} fill=${s.color}>
      ${s.points.map((p) => {
        if (p.v === null) return nothing;
        const x0 = x(p.t);
        const w = x(p.end ?? p.t) - x0;
        const each = (w * BODY) / under.length;
        const left = x0 + (w * (1 - BODY)) / 2 + n * each;
        const y0 = y(Math.max(0, p.v));
        return svg`<rect x=${left} width=${Math.max(0.5, each * 0.9)} y=${y0} height=${Math.max(0, y(Math.min(0, p.v)) - y0)}></rect>`;
      })}
    </g>`;
  })}`;
}

const CANDLE_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS.map((f) => {
    if (f.name === 'period_last') return { ...f, default: 14 };
    if (f.name === 'period_unit') return { ...f, default: 'day' };
    if (f.name === 'source') return { ...f, default: 'statistics' };
    if (f.name === 'group_by') return { name: 'candle_by', path: ['group_by'], default: 'day' };
    if (f.name === 'aggregate') return { name: 'under_aggregate', path: ['aggregate'], default: 'mean' };
    return f;
  }),
  { name: 'up_color', path: ['up_color'], default: 'green' },
  { name: 'down_color', path: ['down_color'], default: 'red' },
  { name: 'underneath', path: ['underneath'], default: 'columns' },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

/** The history fields, with "one candle per" in place of grouping (candles are always grouped). */
function candleHistorySchema(hass: HomeAssistant | undefined, config: CardConfig): unknown[] {
  return historySchema(hass, { ...config, group_by: unitOf(config) }).map((item) => {
    const grid = item as { schema?: { name: string }[] };
    if (!grid.schema?.some((s) => s.name === 'group_by')) return item;
    return {
      ...grid,
      schema: [
        { name: 'candle_by', selector: choice(hass, 'group_by', GROUP_UNITS) },
        { name: 'under_aggregate', selector: choice(hass, 'aggregate', AGGREGATES) },
      ],
    };
  });
}

export function candleEditor(ctx: ChartEditorContext): TemplateResult {
  const calendar = (ctx.config.period as { calendar?: unknown } | undefined)?.calendar ? 'calendar' : 'rolling';
  const schema = cachedSchema(`candlestick|${calendar}`, ctx.hass, () => [
    ...candleHistorySchema(ctx.hass, ctx.config),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'up_color', selector: { text: {} } },
        { name: 'down_color', selector: { text: {} } },
      ],
    },
    { name: 'underneath', selector: choice(ctx.hass, 'underneath', UNDERNEATH) },
    ...axesSchema(ctx.hass),
    ...layoutSchema(ctx.hass),
  ]);
  return chartForm(ctx, 'chart', schema, CANDLE_FIELDS);
}

const ENTITY_FIELDS = {
  schema: [{ name: 'fill_color', selector: { text: {} } }],
  fields: [{ name: 'fill_color', path: ['color'] }],
};

export const candlestick: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    .candle {
      cursor: pointer;
    }
    .candle .wick {
      stroke-width: 1.5px;
    }
    .under-columns rect {
      opacity: 0.45;
    }
    .under-line {
      stroke-width: 2px;
      stroke-linejoin: round;
      opacity: 0.7;
    }
  `,
  thumbnail: () => svg`
    <g stroke-width="1.5">
      <line x1="12" x2="12" y1="8" y2="26" stroke="var(--error-color, #db4437)" />
      <rect x="8" y="11" width="8" height="10" fill="var(--error-color, #db4437)" />
      <line x1="26" x2="26" y1="14" y2="32" stroke="var(--error-color, #db4437)" />
      <rect x="22" y="18" width="8" height="9" fill="var(--error-color, #db4437)" />
      <line x1="40" x2="40" y1="10" y2="30" stroke="var(--success-color, #43a047)" />
      <rect x="36" y="14" width="8" height="12" fill="var(--success-color, #43a047)" />
      <line x1="54" x2="54" y1="4" y2="22" stroke="var(--success-color, #43a047)" />
      <rect x="50" y="7" width="8" height="10" fill="var(--success-color, #43a047)" />
    </g>`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateLayout(raw);
    parsePeriod(candlePeriod(raw));
    for (const k of ['up_color', 'down_color']) {
      if (raw[k] !== undefined && (typeof raw[k] !== 'string' || raw[k] === '')) {
        throw new Error(`"${k}" must be a colour name or CSS colour`);
      }
    }
    if (raw.underneath !== undefined && !UNDERNEATH.includes(raw.underneath as Underneath)) {
      throw new Error(`"underneath" must be one of: ${UNDERNEATH.join(', ')}`);
    }
  },
  editor: candleEditor,
  entityFields: () => ENTITY_FIELDS,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render(ctx) {
    // The candles' own entity is always drawn: hiding it would leave nothing to read the rest against.
    const frame = withLegend(candleFrame(ctx), ctx, (s) => s.index === 0);
    const nav = periodNav(frame, ctx);
    const names = seriesHeader(frame, ctx);
    const header = nav === nothing && names === nothing ? nothing : html`${nav}${names}`;
    const message = frameMessage(frame, ctx);
    const layout = chartLayout(ctx.raw);
    if (message) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, header, message);
    const axes = plotAxes(ctx, frame.range, candleExtent(frame.candles));
    const strip = frame.series.length > 1;
    if (strip) {
      // Candles in the top of the plot, the other entities in a strip at the bottom.
      axes.scales.y = linear(axes.value.domain, [VIEW_H * (1 - STRIP - STRIP_GAP), 0]);
    }
    const { x, y } = axes.scales;
    const up = baseColor((ctx.raw.up_color as string | undefined) ?? 'green');
    const down = baseColor((ctx.raw.down_color as string | undefined) ?? 'red');
    const first = frame.series[0];
    const candles = frame.candles.map((c) => {
      if (!c) return nothing;
      const x0 = x(c.t);
      const w = x(c.end) - x0;
      const mid = x0 + w / 2;
      const color = c.close >= c.open ? up : down;
      const top = y(Math.max(c.open, c.close));
      const height = Math.max(MIN_BODY, y(Math.min(c.open, c.close)) - top);
      return svg`<g
        class="candle entity ${c.close >= c.open ? 'up' : 'down'}"
        data-index="0"
        aria-label=${first.entity.label}
      >
        <line class="wick" x1=${mid} x2=${mid} y1=${y(c.high)} y2=${y(c.low)} stroke=${color}></line>
        <rect class="body" x=${x0 + (w * (1 - BODY)) / 2} width=${w * BODY} y=${top} height=${height} fill=${color}></rect>
      </g>`;
    });
    const kind = (ctx.raw.underneath as Underneath | undefined) ?? 'columns';
    const content = svg`${strip ? underneath(frame, x, kind) : nothing}${candles}`;
    const tooltip = tooltipEnabled(ctx.raw);
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_candlestick'),
      names: frame.series.map((s) => s.entity.name).join(', '),
    });
    const mids = first.points.map((p) => ({ t: (p.t + (p.end ?? p.t)) / 2, v: p.v }));
    return chartFrame(
      layout,
      header,
      chartArea({
        axes,
        ctx,
        content,
        label,
        overlay: html`${layout.header === 'over' ? headerOver(header) : nothing}
        ${tooltip ? candleTooltip(ctx, frame, x, hoverTime(ctx.host)) : nothing}`,
        hover: tooltip ? hoverHandlers(ctx, frame.range, [mids]) : undefined,
      }),
    );
  },
};
