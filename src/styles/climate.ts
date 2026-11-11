import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { formatDateTime, validateAxisOptions } from '../chart/axes';
import {
  CLIMATE_ATTRIBUTES,
  actionKind,
  actionSpans,
  climateData,
  climateRequests,
  holdRuns,
  rangeBandPath,
  rangePoints,
  valueAt,
} from '../chart/climate-data';
import type { ActionKind, ClimateData } from '../chart/climate-data';
import { downsample } from '../chart/downsample';
import { VIEW_H, VIEW_W, disconnectHistory, frameStyles, periodNav, validateHistoryOptions } from '../chart/frame';
import type { HistoryFrame } from '../chart/frame';
import { chartArea, gridStyles, plotAxes, plotWidth, stopChartWidth } from '../chart/grid';
import type { PlotScales } from '../chart/grid';
import { chartFrame, chartLayout, headerOver, layoutStyles, validateLayout } from '../chart/layout';
import { runPath, runs } from '../chart/paths';
import type { Curve } from '../chart/paths';
import { extent } from '../chart/scale';
import { DEFAULT_LINE_WIDTH, validateSeriesStyle } from '../chart/series-style';
import {
  hoverHandlers,
  hoverTime,
  stopHover,
  tooltipEnabled,
  tooltipSide,
  tooltipStyles,
  validateTooltipOptions,
} from '../chart/tooltip';
import { climateEditor } from '../editor/climate-editor';
import { formatNumber, withUnit } from '../format';
import { key } from '../history/fetch';
import { parsePeriod, periodRange, stepsFor } from '../history/period';
import { storeFor } from '../history/store';
import { zoneFor } from '../history/timezone';
import type { Point, Range } from '../history/types';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import { conversion, convertPoints } from '../units';
import type { Conversion } from '../units';
import type { ChartContext, ChartStyleModule } from './index';

/** Room-temperature points kept after thinning: about two per pixel on a wide card. */
const MAX_POINTS = 500;

/** The card's climate options with defaults filled in. */
export interface ClimateOptions {
  setPoint: boolean;
  shading: boolean;
  shadeFan: boolean;
  colors: { current: string; setPoint: string } & Record<ActionKind, string>;
}

/** Colours for each kind of running, from Home Assistant's own climate theme variables. */
const ACTION_COLORS: Record<ActionKind, string> = {
  heat: 'var(--state-climate-heat-color, #ff8100)',
  cool: 'var(--state-climate-cool-color, #2b9af9)',
  dry: 'var(--state-climate-dry-color, #efbd07)',
  fan: 'var(--state-climate-fan_only-color, #8a8a8a)',
};

const BOOLEANS = ['set_point', 'shading', 'shade_fan'] as const;
const COLORS = ['current_color', 'set_point_color', 'heating_color', 'cooling_color'] as const;

/** Throw a readable error for a bad climate option. */
export function validateClimateOptions(raw: CardConfig): void {
  if (raw.source !== undefined && raw.source !== 'history') {
    throw new Error('"source" must be history: long-term statistics don\'t keep a thermostat\'s set point or action');
  }
  if (raw.group_by !== undefined) throw new Error('"group_by" is not available on a climate chart');
  for (const k of BOOLEANS) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  for (const k of COLORS) {
    if (raw[k] !== undefined && (typeof raw[k] !== 'string' || raw[k] === '')) {
      throw new Error(`"${k}" must be a colour name or CSS colour`);
    }
  }
}

export function climateOptions(raw: CardConfig): ClimateOptions {
  const color = (k: (typeof COLORS)[number], fallback: string) => baseColor((raw[k] as string | undefined) ?? fallback);
  return {
    setPoint: raw.set_point !== false,
    shading: raw.shading !== false,
    shadeFan: raw.shade_fan === true,
    colors: {
      current: color('current_color', 'primary'),
      setPoint: color('set_point_color', 'red'),
      heat: color('heating_color', ACTION_COLORS.heat),
      cool: color('cooling_color', ACTION_COLORS.cool),
      dry: ACTION_COLORS.dry,
      fan: ACTION_COLORS.fan,
    },
  };
}

/** An `hvac_action` in words: Home Assistant's own translation when it has one, else ours. */
export function actionLabel(hass: HomeAssistant | undefined, entity: ResolvedEntity, action: string): string {
  if (entity.stateObj && hass?.formatEntityAttributeValue) {
    const text = hass.formatEntityAttributeValue(entity.stateObj, CLIMATE_ATTRIBUTES.action, action);
    if (text) return text;
  }
  const own = localize(hass, `climate_action_${action}`);
  return own === `climate_action_${action}` ? action : own;
}

export interface Temps {
  unit: string;
  decimals: number;
  /** Set when the card's `unit` converts Home Assistant's temperature unit (°F to °C). */
  conversion?: Conversion;
  /** A temperature attribute (in Home Assistant's unit) in the shown unit; anything else as it was. */
  convert(v: unknown): unknown;
  /** A temperature already in the shown unit as text, or a dash. */
  text(v: unknown): string;
}

/**
 * How this thermostat's temperatures are written: the card's unit and decimals, else HA's unit and
 * one decimal. A thermostat reports its temperatures in Home Assistant's unit system, so a `unit`
 * in the same family converts them (°F to °C, as `unit` does on a sensor); any other is only shown.
 */
export function temps(entity: ResolvedEntity, hass: HomeAssistant): Temps {
  const system = (hass.config as { unit_system?: { temperature?: string } } | undefined)?.unit_system;
  const own = system?.temperature ?? '°C';
  const unit = entity.config.unit ?? own;
  const decimals = entity.config.decimals ?? 1;
  const c = conversion(own, entity.config.unit);
  return {
    unit,
    decimals,
    ...(c ? { conversion: c } : {}),
    convert: (v) => (c && typeof v === 'number' && Number.isFinite(v) ? c.apply(v) : v),
    text: (v) => (typeof v === 'number' && Number.isFinite(v) ? withUnit(formatNumber(v, decimals, hass), unit) : '—'),
  };
}

/** The set point as words: one temperature, or a heat/cool range, or a dash when there's none. */
function setPointText(t: Temps, target: unknown, low: unknown, high: unknown, hass: HomeAssistant): string {
  if (typeof target === 'number') return t.text(target);
  if (typeof low === 'number' && typeof high === 'number') {
    return localize(hass, 'climate_range', { low: formatNumber(low, t.decimals, hass), high: t.text(high) });
  }
  return '—';
}

/** Names and values above the chart: room temperature, set point, and what it's doing now. */
function header(ctx: ChartContext, entity: ResolvedEntity, options: ClimateOptions, t: Temps) {
  const { show } = ctx.config;
  if (!show.name && !show.value) return nothing;
  const attrs = entity.stateObj?.attributes ?? {};
  // A thermostat that isn't reporting, or an entity that isn't one, shows its state instead.
  const live =
    entity.entityId.startsWith('climate.') &&
    entity.stateObj !== undefined &&
    !['unavailable', 'unknown'].includes(entity.stateObj.state);
  const action =
    typeof attrs[CLIMATE_ATTRIBUTES.action] === 'string' ? (attrs[CLIMATE_ATTRIBUTES.action] as string) : undefined;
  const kind = actionKind(action);
  const item = (swatch: TemplateResult, name: string, value: string) =>
    html`<div class="entity series-item" data-index="0" tabindex="0" aria-label=${`${name}, ${value}`}>
      ${swatch} ${show.name ? html`<span class="series-name">${name}</span>` : nothing}
      ${show.value ? html`<span class="series-value">${value}</span>` : nothing}
    </div>`;
  return html`<div class="series-header">
    ${item(
      html`<span class="swatch" style="background:${options.colors.current}"></span>`,
      entity.name,
      live ? t.text(t.convert(attrs[CLIMATE_ATTRIBUTES.current])) : entity.display,
    )}
    ${
      options.setPoint && live
        ? item(
            html`<span class="swatch set-point-swatch" style="border-color:${options.colors.setPoint}"></span>`,
            localize(ctx.hass, 'climate_set_point'),
            setPointText(
              t,
              t.convert(attrs[CLIMATE_ATTRIBUTES.target]),
              t.convert(attrs[CLIMATE_ATTRIBUTES.low]),
              t.convert(attrs[CLIMATE_ATTRIBUTES.high]),
              ctx.hass,
            ),
          )
        : nothing
    }
    ${
      live && action
        ? html`<div
            class="entity series-item action-item"
            data-index="0"
            tabindex="0"
            aria-label=${actionLabel(ctx.hass, entity, action)}
          >
            <span
              class="swatch action-swatch"
              style=${kind ? `background:${options.colors[kind]}` : 'background:transparent;outline:1px solid var(--divider-color);outline-offset:-1px'}
            ></span>
            <span class="series-value action-value">${actionLabel(ctx.hass, entity, action)}</span>
          </div>`
        : nothing
    }
  </div>`;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** The guide, a dot on the room temperature, and a box with the temperature, set point and action then. */
function tooltip(
  ctx: ChartContext,
  entity: ResolvedEntity,
  data: ClimateData,
  options: ClimateOptions,
  scales: PlotScales,
  t: Temps,
  at: number | undefined,
) {
  if (at === undefined) return nothing;
  const x = scales.x(at) / VIEW_W;
  if (!(x >= 0 && x <= 1)) return nothing;
  const side = tooltipSide(x, plotWidth(ctx));
  const current = valueAt(data.current, at);
  const action = valueAt(data.action, at)?.s;
  const kind = actionKind(action);
  const v = (points: Point[]) => valueAt(points, at)?.v ?? undefined;
  const top = current && current.v !== null ? scales.y(current.v) / VIEW_H : -1;
  const row = (swatch: TemplateResult, name: string, value: string) =>
    html`<div class="tooltip-row">
      ${swatch}<span class="tooltip-name">${name}</span><span class="tooltip-value">${value}</span>
    </div>`;
  return html`<div class="hover-layer" aria-hidden="true">
    <div class="crosshair" style="left:${pct(x)}"></div>
    ${
      top >= 0 && top <= 1
        ? html`<span
            class="hover-dot"
            style="left:${pct(x)};top:${pct(top)};background:${options.colors.current}"
          ></span>`
        : nothing
    }
    <div class="tooltip ${side}" style=${side.startsWith('pin') ? '' : `left:${pct(x)}`}>
      <div class="tooltip-time">${formatDateTime(at, ctx.hass)}</div>
      ${row(
        html`<span class="swatch" style="background:${options.colors.current}"></span>`,
        entity.name,
        t.text(current?.v),
      )}
      ${
        options.setPoint
          ? row(
              html`<span class="swatch set-point-swatch" style="border-color:${options.colors.setPoint}"></span>`,
              localize(ctx.hass, 'climate_set_point'),
              setPointText(t, v(data.target), v(data.low), v(data.high), ctx.hass),
            )
          : nothing
      }
      ${
        action
          ? row(
              html`<span
                class="swatch action-swatch"
                style=${kind ? `background:${options.colors[kind]}` : 'background:transparent;outline:1px solid var(--divider-color);outline-offset:-1px'}
              ></span>`,
              actionLabel(ctx.hass, entity, action),
              '',
            )
          : nothing
      }
    </div>
  </div>`;
}

const message = (text: string, error = false) => html`<div class="chart-message ${error ? 'error' : ''}">${text}</div>`;

/** A stepped, dashed set-point line through held values. */
function setPointPath(points: Point[], scales: PlotScales): string {
  return holdRuns(points)
    .map((run) =>
      runPath(
        run.map((p) => [scales.x(p.t), scales.y(p.v)]),
        'step',
      ),
    )
    .join('');
}

export const climate: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 240,
  styles: css`
    ${frameStyles}
    ${gridStyles}
    ${tooltipStyles}
    ${layoutStyles}
    .style-climate .current {
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .style-climate .set-point {
      stroke-dasharray: 6 5;
      stroke-width: 2px;
    }
    .style-climate .range-band {
      fill-opacity: 0.08;
    }
    .style-climate .action-span {
      fill-opacity: 0.2;
    }
    .style-climate .set-point-swatch {
      box-sizing: border-box;
      height: 0;
      border-radius: 0;
      border-top: 3px dashed;
    }
    .style-climate .action-swatch {
      border-radius: 2px;
      opacity: 0.45;
    }
  `,
  thumbnail: () => svg`
    <rect x="14" y="4" width="14" height="32" fill="var(--state-climate-heat-color, #ff8100)" opacity="0.25" />
    <rect x="40" y="4" width="8" height="32" fill="var(--state-climate-heat-color, #ff8100)" opacity="0.25" />
    <path d="M4 26 H14 V14 H50 V24 H60" fill="none" stroke="var(--error-color, #ef3b5a)" stroke-width="2"
      stroke-dasharray="3 2" />
    <path d="M4 28 C10 30 12 27 16 22 S24 15 30 16 S44 18 50 17 S56 24 60 27" fill="none"
      stroke="var(--primary-color, #03a9f4)" stroke-width="3" stroke-linecap="round" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    validateAxisOptions(raw);
    validateTooltipOptions(raw);
    validateSeriesStyle(raw);
    validateLayout(raw);
    validateClimateOptions(raw);
  },
  editor: climateEditor,
  disconnect(host) {
    disconnectHistory(host);
    stopChartWidth(host);
    stopHover(host);
  },
  render(ctx) {
    const layout = chartLayout(ctx.raw);
    const options = climateOptions(ctx.raw);
    // One thermostat per chart: the first entity. Several rooms are several cards in a stack.
    const entity = ctx.items[0];
    const period = parsePeriod(ctx.raw.period as CardConfig['period']);
    const zone = zoneFor(ctx.hass);
    const now = Date.now();
    const span = periodRange(period, now, zone, period.navigate ? stepsFor(ctx.host, period) : 0);
    const range: Range = { start: span.start, end: span.end };
    const t = temps(entity, ctx.hass);
    const thermostat = entity.entityId.startsWith('climate.');
    const head = header(ctx, entity, thermostat ? options : { ...options, setPoint: false }, t);
    if (!thermostat) {
      return chartFrame(
        { ...layout, header: 'above' },
        head,
        message(localize(ctx.hass, 'climate_not_thermostat', { name: entity.name })),
      );
    }
    const requests = climateRequests(entity.entityId);
    const loaded = storeFor(ctx.host, ctx.requestUpdate).get(ctx.hass, Object.values(requests), range, 'history', {
      live: span.live,
    });
    const read = climateData(loaded.data, requests, Math.min(range.end, now), key);
    // The temperatures' history in the shown unit too; the action is words.
    const temp = (points: Point[]) => convertPoints(points, t.conversion);
    const data: ClimateData = t.conversion
      ? { ...read, current: temp(read.current), target: temp(read.target), low: temp(read.low), high: temp(read.high) }
      : read;
    const frame: HistoryFrame = {
      status: loaded.status,
      error: loaded.error,
      range,
      period,
      source: 'history',
      series: [],
      live: span.live,
      back: span.back,
      zone,
    };
    const nav = periodNav(frame, ctx);
    const top = nav === nothing && head === nothing ? nothing : html`${nav}${head}`;
    const kinds: ActionKind[] = options.shadeFan ? ['heat', 'cool', 'dry', 'fan'] : ['heat', 'cool', 'dry'];
    const spans = options.shading ? actionSpans(data.action, Math.min(range.end, now), kinds) : [];
    const numbers = options.setPoint ? [data.current, data.target, data.low, data.high] : [data.current];
    let body: TemplateResult | undefined;
    if (loaded.status === 'loading') body = message(localize(ctx.hass, 'chart_loading'));
    else if (loaded.status === 'error') {
      body = message(localize(ctx.hass, 'chart_error', { error: loaded.error ?? '' }), true);
    } else if (numbers.every((p) => p.every((x) => x.v === null)) && spans.length === 0) {
      body = message(localize(ctx.hass, 'chart_no_data'));
    }
    if (body) return chartFrame(layout.header === 'over' ? { ...layout, header: 'above' } : layout, top, body);

    const axes = plotAxes(ctx, range, extent(numbers));
    const { scales } = axes;
    const width = (ctx.raw.line_width as number | undefined) ?? DEFAULT_LINE_WIDTH;
    const curve = (ctx.raw.curve as Curve | undefined) ?? 'smooth';
    const shading = svg`${spans.map(
      (s) => svg`<rect
        class="action-span action-${s.kind}"
        x=${scales.x(s.start)}
        y="0"
        width=${Math.max(0, scales.x(s.end) - scales.x(s.start))}
        height=${VIEW_H}
        fill=${options.colors[s.kind]}
      ></rect>`,
    )}`;
    const range2 = rangePoints(data.low, data.high);
    const setPoint = options.setPoint
      ? svg`
        <path class="range-band" d=${rangeBandPath(range2, scales.x, scales.y)} fill=${options.colors.setPoint}></path>
        ${[data.target, data.low, data.high].map(
          (points) =>
            svg`<path class="set-point" d=${setPointPath(points, scales)} fill="none" stroke=${options.colors.setPoint}></path>`,
        )}`
      : nothing;
    const current = runs(downsample(data.current, MAX_POINTS))
      .map((run) =>
        runPath(
          run.map((p) => [scales.x(p.t), scales.y(p.v as number)]),
          curve,
        ),
      )
      .join('');
    const content = svg`${shading}${setPoint}<path
      class="current"
      d=${current}
      fill="none"
      stroke=${options.colors.current}
      style="stroke-width:${width}px"
    ></path>`;
    const label = localize(ctx.hass, 'chart_aria', {
      style: localize(ctx.hass, 'editor_style_climate'),
      names: entity.name,
    });
    const hover = tooltipEnabled(ctx.raw);
    return chartFrame(
      layout,
      top,
      chartArea({
        axes,
        ctx,
        content,
        label,
        overlay: html`${layout.header === 'over' ? headerOver(top) : nothing}
        ${hover ? tooltip(ctx, entity, data, options, scales, t, hoverTime(ctx.host)) : nothing}`,
        hover: hover
          ? hoverHandlers(ctx, range, [data.current, data.target, data.low, data.high, data.action])
          : undefined,
      }),
    );
  },
};
