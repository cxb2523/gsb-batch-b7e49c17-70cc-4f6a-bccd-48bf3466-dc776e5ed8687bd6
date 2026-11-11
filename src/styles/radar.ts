import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { seriesColor } from '../chart/colors';
import { groupPath, parseGroupBy, splitGroup, validateGroups } from '../chart/hierarchy';
import { axisAngle, labelAnchor, polar, polygonPoints } from '../chart/polar';
import { cachedSchema, chartForm, choice } from '../editor/chart-editors';
import { entityOptionsForm } from '../editor/entity-options';
import { GROUP_FIELDS, HIERARCHY_LABELS, entityGroupsForm, groupBySchema, withGroupList } from '../editor/group-fields';
import type { FieldBinding } from '../editor/schemas';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const RADAR_SCALES = ['limits', 'shared'] as const;
export type RadarScale = (typeof RADAR_SCALES)[number];

/** Half the drawing's width and height, and the radius of the outer ring, in SVG units (≈ px). */
const HALF_W = 170;
const HALF_H = 120;
const RADIUS = 84;
const RINGS = 4;

/** Short names for device classes whose readable form is an abbreviation. */
const DEVICE_CLASS_NAMES: Record<string, string> = {
  aqi: 'AQI',
  carbon_dioxide: 'CO₂',
  carbon_monoxide: 'CO',
  pm1: 'PM1',
  pm10: 'PM10',
  pm25: 'PM2.5',
  volatile_organic_compounds: 'VOC',
  volatile_organic_compounds_parts: 'VOC',
};

/** "carbon_dioxide" → "CO₂", "humidity" → "Humidity". */
export function deviceClassName(deviceClass: string): string {
  if (DEVICE_CLASS_NAMES[deviceClass]) return DEVICE_CLASS_NAMES[deviceClass];
  const text = deviceClass.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface RadarPoint {
  /** Index into the chart's items. */
  index: number;
  axis: number;
  /** Distance from the centre, 0–1; null when there is no value to plot. */
  r: number | null;
}

export interface RadarSeries {
  name: string;
  color: string;
  points: RadarPoint[];
}

export interface RadarModel {
  axes: { name: string; entity?: ResolvedEntity }[];
  series: RadarSeries[];
}

/** How far out a value sits: its place between the entity's limits, or its share of the largest. */
export function radius(e: ResolvedEntity, scale: RadarScale, largest: number): number | null {
  if (!e.available || e.value === null) return null;
  if (scale === 'limits') return e.position;
  return largest > 0 ? Math.min(1, Math.max(0, e.value / largest)) : 0;
}

/**
 * Sort the entities into axes and series. Without groups there is one series and every entity is
 * an axis. With groups, each group is a series and entities line up on an axis by their `axis`
 * name, else their device class, else their own name.
 */
export function radarModel(items: ResolvedEntity[], raw: CardConfig, hass: HomeAssistant): RadarModel {
  const levels = parseGroupBy(raw.group_by);
  const grouped = levels.length > 0 || items.some((e) => splitGroup((e.config as { group?: unknown }).group).length);
  const scale: RadarScale = (raw.scale as RadarScale | undefined) ?? 'limits';
  const values = items.filter((e) => e.available && e.value !== null).map((e) => e.value as number);
  const largest = values.length ? Math.max(...values) : 0;
  const ownAxis = (e: ResolvedEntity) => {
    const axis = (e.config as { axis?: unknown }).axis;
    return typeof axis === 'string' && axis.trim() ? axis.trim() : undefined;
  };
  if (!grouped) {
    return {
      axes: items.map((e) => ({ name: ownAxis(e) ?? e.name, entity: e })),
      series: [
        {
          name: '',
          color: seriesColor(0),
          points: items.map((e, index) => ({ index, axis: index, r: radius(e, scale, largest) })),
        },
      ],
    };
  }
  const other = localize(hass, 'radar_other');
  const axes: { name: string }[] = [];
  const series: RadarSeries[] = [];
  items.forEach((e, index) => {
    const deviceClass = e.stateObj?.attributes?.device_class;
    const axisName = ownAxis(e) ?? (typeof deviceClass === 'string' ? deviceClassName(deviceClass) : e.name);
    let axis = axes.findIndex((a) => a.name === axisName);
    if (axis === -1) axis = axes.push({ name: axisName }) - 1;
    const name = groupPath(e, levels, hass, other).join(' / ') || other;
    let s = series.find((x) => x.name === name);
    if (!s) {
      s = { name, color: seriesColor(series.length), points: [] };
      series.push(s);
    }
    s.points.push({ index, axis, r: radius(e, scale, largest) });
  });
  return { axes, series };
}

function grid(n: number): SVGTemplateResult {
  const rings = Array.from({ length: RINGS }, (_, i) => (RADIUS * (i + 1)) / RINGS);
  const ring = (r: number) =>
    n >= 3
      ? svg`<polygon class="grid" points=${polygonPoints(Array.from({ length: n }, (_, i) => polar(r, axisAngle(i, n))))}></polygon>`
      : svg`<circle class="grid" r=${r}></circle>`;
  return svg`${rings.map(ring)}
    ${Array.from({ length: n }, (_, i) => {
      const [x, y] = polar(RADIUS, axisAngle(i, n));
      return svg`<line class="grid spoke" x1="0" y1="0" x2=${x} y2=${y}></line>`;
    })}`;
}

function axisLabels(model: RadarModel, ctx: ChartContext, single: boolean): SVGTemplateResult {
  const n = model.axes.length;
  const showValue = single && ctx.config.show.value;
  return svg`${model.axes.map((axis, i) => {
    const angle = axisAngle(i, n);
    const [x, y] = polar(RADIUS + 12, angle);
    const anchor = labelAnchor(angle);
    // Labels below the centre hang down from their point; above it they sit on it.
    const below = Math.cos(angle) < -0.2;
    const lines = showValue && axis.entity ? 2 : 1;
    const dy = below ? 10 : Math.abs(Math.cos(angle)) <= 0.2 ? 4 - (lines - 1) * 6 : -(lines - 1) * 12;
    return svg`<text class="axis-label" x=${x} y=${y + dy} text-anchor=${anchor}>
      ${ctx.config.show.name || !showValue ? svg`<tspan>${axis.name}</tspan>` : nothing}
      ${
        showValue && axis.entity
          ? svg`<tspan class="axis-value ${axis.entity.available ? '' : 'muted'}" x=${x} dy="13">${axis.entity.display}</tspan>`
          : nothing
      }
    </text>`;
  })}`;
}

function shape(s: RadarSeries, n: number, items: ResolvedEntity[], fill: boolean): SVGTemplateResult {
  const plotted = s.points
    .filter((p) => p.r !== null)
    .sort((a, b) => a.axis - b.axis)
    .map((p) => ({ p, xy: polar(RADIUS * (p.r as number), axisAngle(p.axis, n)) }));
  return svg`<g class="series">
    ${
      plotted.length > 1
        ? svg`<polygon class="area ${fill ? 'filled' : ''}" points=${polygonPoints(plotted.map((x) => x.xy))}
            stroke=${s.color} fill=${fill ? s.color : 'none'}></polygon>`
        : nothing
    }
    ${plotted.map(
      ({ p, xy }) => svg`<g class="entity marker" data-index=${p.index} tabindex="0" aria-label=${items[p.index].label}
        role="img">
        <circle class="hit" cx=${xy[0]} cy=${xy[1]} r="9"></circle>
        <circle class="dot" cx=${xy[0]} cy=${xy[1]} r="3.5" stroke=${s.color}></circle>
      </g>`,
    )}
  </g>`;
}

const FIELDS: FieldBinding[] = [
  { name: 'radar_scale', path: ['scale'], default: 'limits' },
  { name: 'radar_fill', path: ['fill'], default: true },
  ...GROUP_FIELDS,
];

export function radarEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('radar', ctx.hass, () => [
    { name: 'radar_scale', selector: choice(ctx.hass, 'radar_scale', RADAR_SCALES) },
    { name: 'radar_fill', selector: { boolean: {} } },
    groupBySchema(ctx.hass),
  ]);
  return html`${chartForm(withGroupList(ctx), 'chart', schema, FIELDS, HIERARCHY_LABELS)} ${entityGroupsForm(ctx)}
  ${entityOptionsForm(ctx, 'radar_axis', 'axis', { text: {} })}`;
}

export const radar: ChartStyleModule = {
  layout: 'chart',
  group: 'compare',
  height: 280,
  styles: css`
    .radar-plot {
      display: block;
      width: 100%;
      height: 240px;
      overflow: visible;
    }
    .radar-plot .grid {
      fill: none;
      stroke: var(--divider-color, rgba(127, 127, 127, 0.25));
      stroke-width: 1;
    }
    .radar-plot .axis-label {
      fill: var(--secondary-text-color);
      font-size: 12px;
    }
    .radar-plot .axis-value {
      fill: var(--primary-text-color);
      font-weight: 500;
    }
    .radar-plot .axis-value.muted {
      fill: var(--secondary-text-color);
      font-weight: 400;
    }
    .radar-plot .area {
      stroke-width: 2;
      stroke-linejoin: round;
      fill-opacity: 0;
    }
    .radar-plot .area.filled {
      fill-opacity: 0.2;
    }
    .radar-plot .dot {
      fill: var(--card-background-color, #fff);
      stroke-width: 2;
    }
    .radar-plot .hit {
      fill: transparent;
    }
    .radar-plot .marker {
      cursor: pointer;
      outline: none;
    }
    .radar-plot .marker:focus-visible .dot {
      stroke-width: 4;
    }
    .radar-grow {
      transform-box: fill-box;
      transform-origin: center;
      transform: scale(0);
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .radar-grow {
      transform: scale(1);
    }
    :host([static]) .radar-grow {
      transition: none;
    }
    .radar-legend {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px 16px;
      padding-top: 4px;
      font-size: 0.875em;
      color: var(--secondary-text-color);
    }
    .radar-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .radar-legend .swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
  `,
  thumbnail: () => svg`
    <polygon points="32,4 52,15 49,34 15,34 12,15" fill="none" stroke="var(--divider-color, #ccc)" />
    <polygon points="32,10 46,17 40,30 20,32 18,18" fill="var(--primary-color, #03a9f4)" fill-opacity="0.25"
      stroke="var(--primary-color, #03a9f4)" stroke-width="2" stroke-linejoin="round" />`,
  validate(raw: CardConfig) {
    validateGroups(raw);
    if (raw.scale !== undefined && !RADAR_SCALES.includes(raw.scale as RadarScale)) {
      throw new Error(`"scale" must be one of: ${RADAR_SCALES.join(', ')}`);
    }
    if (raw.fill !== undefined && typeof raw.fill !== 'boolean') throw new Error('"fill" must be true or false');
    (raw.entities ?? []).forEach((e, i) => {
      const axis = typeof e === 'object' && e ? (e as { axis?: unknown }).axis : undefined;
      if (axis !== undefined && axis !== null && typeof axis !== 'string') {
        throw new Error(`Entity ${i + 1}: "axis" must be text`);
      }
    });
  },
  editor: radarEditor,
  render(ctx) {
    const model = radarModel(ctx.items, ctx.raw, ctx.hass);
    const n = model.axes.length;
    const single = model.series.length === 1 && model.series[0].name === '';
    const fill = ctx.raw.fill !== false;
    const label = localize(ctx.hass, 'radar_aria', {
      names: (single ? ctx.items.map((e) => e.name) : model.series.map((s) => s.name)).join(', '),
    });
    return html`<svg
        class="radar-plot"
        viewBox="${-HALF_W} ${-HALF_H} ${HALF_W * 2} ${HALF_H * 2}"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label=${label}
      >
        ${grid(n)} ${axisLabels(model, ctx, single)}
        <g class="radar-grow">
          <circle r=${RADIUS} fill="none" stroke="none"></circle>
          ${model.series.map((s) => shape(s, n, ctx.items, fill))}
        </g>
      </svg>
      ${
        single
          ? nothing
          : html`<div class="radar-legend">
              ${model.series.map(
                (s) =>
                  html`<span class="radar-legend-item"
                    ><span class="swatch" style="background:${s.color}"></span>${s.name}</span
                  >`,
              )}
            </div>`
      }`;
  },
};
