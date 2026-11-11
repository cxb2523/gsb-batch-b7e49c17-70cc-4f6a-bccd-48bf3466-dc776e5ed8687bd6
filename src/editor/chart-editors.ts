import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { AXIS_LABELS, DEFAULT_AXES, Y_SCALES } from '../chart/axes';
import { HEADER_PLACES } from '../chart/layout';
import { LEGEND_TOGGLE_FIELDS, LEGEND_TOGGLE_SCHEMA } from '../chart/legend-toggle';
import { CURVES } from '../chart/paths';
import { LABEL_POSITIONS, LABEL_SHOW } from '../chart/data-labels';
import { EXTREMES_FIELDS, extremesSchema } from '../chart/extremes';
import { FORECAST_FIELDS, forecastSchema, forecastVariant } from '../chart/forecast';
import { ANOMALY_FIELDS, anomalySchema, anomalyVariant } from '../chart/anomaly';
import { COMPARE_FIELDS, compareSchema, compareVariant } from '../chart/compare-ghost';
import { MAX_MULTIPLES_COLUMNS, MULTIPLES_SCALES } from '../chart/multiples';
import { DEFAULT_LINE_WIDTH } from '../chart/series-style';
import { SOURCES } from '../chart/frame';
import {
  ENERGY_FLOWS,
  ENERGY_SPLIT_STYLES,
  ENERGY_TIME_STYLES,
  SANKEY_FLOWS,
  withEnergyDefaults,
} from '../history/energy';
import { AGGREGATES, GROUP_UNITS } from '../history/group';
import { CALENDAR_SPANS, PERIOD_UNITS, PERIOD_UNTIL } from '../history/period';
import { languageOf, localize } from '../localize';
import type { ChartEditorContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { annotationsEditor } from './annotations-editor';
import { NOW_MARKER_FIELDS, nowMarkerSchema } from './now-marker-editor';
import { LINE_WIDTH_SELECTOR, applyFormData, formData } from './schemas';
import type { FieldBinding } from './schemas';

/** A dropdown of fixed values, labelled from `editor_<prefix>_<value>`. */
export function choice(hass: HomeAssistant | undefined, prefix: string, values: readonly string[]) {
  return {
    select: {
      mode: 'dropdown',
      options: values.map((value) => ({ value, label: localize(hass, `editor_${prefix}_${value}`) })),
    },
  };
}

/** Fields every history chart shows first: what span it covers, and where the readings come from. */
export const HISTORY_FIELDS: FieldBinding[] = [
  { name: 'period_calendar', path: ['period', 'calendar'], default: 'rolling' },
  { name: 'period_last', path: ['period', 'last'], default: 24 },
  { name: 'period_unit', path: ['period', 'unit'], default: 'hour' },
  { name: 'period_offset', path: ['period', 'offset'], default: 0 },
  { name: 'period_until', path: ['period', 'until'], default: 'now' },
  { name: 'period_navigate', path: ['period', 'navigate'], default: false },
  { name: 'source', path: ['source'], default: 'history' },
  { name: 'energy_flows', path: ['energy_flows'] },
  { name: 'group_by', path: ['group_by'], default: 'none' },
  { name: 'aggregate', path: ['aggregate'], default: 'mean' },
];

/** Column and area only (listed after their history fields): energy leaving the house below the axis. */
export const ENERGY_SPLIT_FIELD: FieldBinding = { name: 'energy_split', path: ['energy_split'], default: true };

/** Which history fields apply to this config; part of a chart editor's schema cache key. */
export function historyVariant(config: CardConfig | undefined): string {
  const period = config?.period as { calendar?: unknown } | undefined;
  // Styles that can draw the Energy dashboard offer it as a source, and its flows once chosen
  // (and, on column and area, whether export and charging go below the axis).
  const style = config?.style as never;
  const chosen = config?.source === 'energy' ? `|energy${ENERGY_SPLIT_STYLES.includes(style) ? '|split' : ''}` : '';
  const energy = ENERGY_TIME_STYLES.includes(style) ? chosen || '|energy-able' : '';
  return `${period?.calendar ? 'calendar' : 'rolling'}${config?.group_by ? '|grouped' : ''}${energy}`;
}

/**
 * The history fields as ha-form schema: a rolling span asks how far back, a calendar one whether
 * to draw to now or to its end, and grouped readings how to combine them. Cache it under
 * `historyVariant(config)`.
 */
export function historySchema(hass?: HomeAssistant, config?: CardConfig) {
  const [span, ...flags] = historyVariant(config).split('|');
  const calendar = span === 'calendar';
  const grouped = flags.includes('grouped');
  const sources = flags.includes('energy') || flags.includes('energy-able') ? [...SOURCES, 'energy'] : SOURCES;
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'period_calendar', selector: choice(hass, 'period_calendar', ['rolling', ...CALENDAR_SPANS]) },
        ...(calendar
          ? [{ name: 'period_until', selector: choice(hass, 'period_until', PERIOD_UNTIL) }]
          : [
              { name: 'period_last', selector: { number: { min: 1, mode: 'box' } } },
              { name: 'period_unit', selector: choice(hass, 'period_unit', PERIOD_UNITS) },
            ]),
        { name: 'period_offset', selector: { number: { min: 0, mode: 'box' } } },
      ],
    },
    { name: 'period_navigate', selector: { boolean: {} } },
    { name: 'source', selector: choice(hass, 'source', sources) },
    ...(flags.includes('energy') ? [energyFlowsField(hass, ENERGY_FLOWS)] : []),
    ...(flags.includes('split') ? [{ name: 'energy_split', selector: { boolean: {} } }] : []),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'group_by', selector: choice(hass, 'group_by', ['none', ...GROUP_UNITS]) },
        ...(grouped ? [{ name: 'aggregate', selector: choice(hass, 'aggregate', AGGREGATES) }] : []),
      ],
    },
  ];
}

/** The multi-select of Energy dashboard flows. */
function energyFlowsField(hass: HomeAssistant | undefined, flows: readonly string[]) {
  return {
    name: 'energy_flows',
    selector: {
      select: {
        multiple: true,
        mode: 'list',
        options: flows.map((value) => ({ value, label: localize(hass, `energy_flow_${value}`) })),
      },
    },
  };
}

/**
 * Pie and Sankey: where the values come from (the entities' current values, or the Energy
 * dashboard's totals), and for the Energy dashboard, over what span and which flows.
 */
export const ENERGY_TOTALS_FIELDS: FieldBinding[] = [
  { name: 'source', path: ['source'], default: 'current' },
  ...HISTORY_FIELDS.filter((f) => f.name.startsWith('period_') && f.name !== 'period_navigate'),
  { name: 'energy_flows', path: ['energy_flows'] },
];

/** Which totals fields apply; part of the pie's and Sankey's schema cache key. */
export function energyTotalsVariant(config: CardConfig | undefined): string {
  if (config?.source !== 'energy') return 'current';
  return (config.period as { calendar?: unknown } | undefined)?.calendar ? 'calendar' : 'rolling';
}

export function energyTotalsSchema(hass: HomeAssistant | undefined, config: CardConfig | undefined) {
  const variant = energyTotalsVariant(config);
  const source = { name: 'source', selector: choice(hass, 'source', ['current', 'energy']) };
  if (variant === 'current') return [source];
  // The span's fields, as every history chart has them, less the previous / next buttons.
  const span = historySchema(hass, { ...config, source: 'history' } as CardConfig)[0];
  const flows = config?.style === 'sankey' ? SANKEY_FLOWS : ENERGY_FLOWS;
  return [source, span, energyFlowsField(hass, flows)];
}

/** History fields for charts that only read a rolling span (how far back, and from where). */
export const ROLLING_HISTORY_FIELDS: FieldBinding[] = HISTORY_FIELDS.filter((f) =>
  ['period_last', 'period_unit', 'source'].includes(f.name),
);

/** `historySchema` for those charts: no calendar spans, offset, buttons or grouping. */
export function rollingHistorySchema(hass?: HomeAssistant) {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'period_last', selector: { number: { min: 1, mode: 'box' } } },
        { name: 'period_unit', selector: choice(hass, 'period_unit', PERIOD_UNITS) },
      ],
    },
    { name: 'source', selector: choice(hass, 'source', SOURCES) },
  ];
}

/** Spacing and where the names and current values go, shared by every history chart. */
export const LAYOUT_FIELDS: FieldBinding[] = [
  { name: 'header', path: ['header'], default: 'above' },
  { name: 'compact', path: ['compact'], default: false },
  ...LEGEND_TOGGLE_FIELDS,
];

/** `toggles`: the chart's header names can hide and show series (charts drawn with `seriesHeader`). */
export function layoutSchema(hass?: HomeAssistant, toggles = true) {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'header', selector: choice(hass, 'header', HEADER_PLACES) },
        { name: 'compact', selector: { boolean: {} } },
      ],
    },
    ...(toggles ? LEGEND_TOGGLE_SCHEMA : []),
  ];
}

/** Axis labels, gridlines, the value range and the hover tooltip, shared by every history chart. Empty min/max fit the readings. */
export const AXES_FIELDS: FieldBinding[] = [
  { name: 'x_axis', path: ['x_axis'], default: DEFAULT_AXES.x },
  { name: 'y_axis', path: ['y_axis'], default: DEFAULT_AXES.y },
  { name: 'axis_labels', path: ['axis_labels'], default: DEFAULT_AXES.labels },
  { name: 'grid_horizontal', path: ['gridlines', 'horizontal'], default: DEFAULT_AXES.horizontal },
  { name: 'grid_vertical', path: ['gridlines', 'vertical'], default: DEFAULT_AXES.vertical },
  { name: 'y_min', path: ['y_min'] },
  { name: 'y_max', path: ['y_max'] },
  { name: 'tooltip', path: ['tooltip'], default: true },
];

export function axesSchema(hass?: HomeAssistant) {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'x_axis', selector: { boolean: {} } },
        { name: 'y_axis', selector: { boolean: {} } },
        { name: 'grid_horizontal', selector: { boolean: {} } },
        { name: 'grid_vertical', selector: { boolean: {} } },
      ],
    },
    { name: 'axis_labels', selector: choice(hass, 'axis_labels', AXIS_LABELS) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'y_min', selector: { number: { mode: 'box', step: 'any' } } },
        { name: 'y_max', selector: { number: { mode: 'box', step: 'any' } } },
      ],
    },
    { name: 'tooltip', selector: { boolean: {} } },
  ];
}

/** Zoom gestures and the overview strip, shared by every history chart. */
export const ZOOM_FIELDS: FieldBinding[] = [
  { name: 'zoom', path: ['zoom'], default: false },
  { name: 'overview', path: ['overview'], default: false },
];

export const ZOOM_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'zoom', selector: { boolean: {} } },
      { name: 'overview', selector: { boolean: {} } },
    ],
  },
];
/** Shading the severity bands behind a history chart; the annotation list has its own editor. */
export const ANNOTATION_FIELDS: FieldBinding[] = [{ name: 'zones', path: ['zones'], default: false }];
export const ANNOTATION_SCHEMA = [{ name: 'zones', selector: { boolean: {} } }];
/** Value labels on a chart's readings: on/off, then which, where, and whether they may overlap. */
export const LABEL_FIELDS: FieldBinding[] = [
  { name: 'labels', path: ['labels'], default: false },
  { name: 'labels_show', path: ['labels_show'], default: 'all' },
  { name: 'labels_position', path: ['labels_position'], default: 'auto' },
  { name: 'labels_overlap', path: ['labels_overlap'], default: false },
];

/** The label fields; the choices show once labels are on (cache under `labelsVariant`). */
export function labelSchema(hass: HomeAssistant | undefined, config: CardConfig | undefined) {
  return [
    { name: 'labels', selector: { boolean: {} } },
    ...(config?.labels === true
      ? [
          {
            type: 'grid',
            name: '',
            schema: [
              { name: 'labels_show', selector: choice(hass, 'labels_show', LABEL_SHOW) },
              { name: 'labels_position', selector: choice(hass, 'labels_position', LABEL_POSITIONS) },
            ],
          },
          { name: 'labels_overlap', selector: { boolean: {} } },
        ]
      : []),
  ];
}

export const labelsVariant = (config: CardConfig | undefined) => (config?.labels === true ? 'labels' : '');
/** A group name shared with other charts on the dashboard. */
export const SYNC_FIELDS: FieldBinding[] = [{ name: 'sync', path: ['sync'] }];
export const SYNC_SCHEMA = [{ name: 'sync', selector: { text: {} } }];

/** Small multiples: on/off, then how the charts share a scale and how many go across. */
export const MULTIPLES_FIELDS: FieldBinding[] = [
  { name: 'multiples', path: ['multiples'], default: false },
  { name: 'multiples_scale', path: ['multiples_scale'], default: 'auto' },
  { name: 'multiples_columns', path: ['multiples_columns'] },
];

export const multiplesVariant = (config: CardConfig | undefined) => (config?.multiples === true ? 'multiples' : '');

/** The small-multiples fields; scale and columns show once it is on (cache under `multiplesVariant`). */
export function multiplesSchema(hass: HomeAssistant | undefined, config: CardConfig | undefined) {
  return [
    { name: 'multiples', selector: { boolean: {} } },
    ...(config?.multiples === true
      ? [
          {
            type: 'grid',
            name: '',
            schema: [
              { name: 'multiples_scale', selector: choice(hass, 'multiples_scale', MULTIPLES_SCALES) },
              {
                name: 'multiples_columns',
                selector: { number: { min: 1, max: MAX_MULTIPLES_COLUMNS, mode: 'box' } },
              },
            ],
          },
        ]
      : []),
  ];
}

const cache = new Map<string, unknown[]>();

/** Build a schema once per language (and per style), so ha-form isn't handed a new one each render. */
export function cachedSchema(id: string, hass: HomeAssistant | undefined, build: () => unknown[]): unknown[] {
  const k = `${id}|${languageOf(hass)}`;
  let schema = cache.get(k);
  if (!schema) {
    schema = build();
    cache.set(k, schema);
  }
  return schema;
}

/** An ha-form bound to card-config paths; a value set back to its default removes the key. */
export function chartForm(
  ctx: ChartEditorContext,
  section: string,
  schema: unknown[],
  fields: FieldBinding[],
  /** Label keys for fields whose name means something else on another chart (`editor_<name>` otherwise). */
  labels: Record<string, string> = {},
): TemplateResult {
  return html`<ha-form
    data-section=${section}
    .hass=${ctx.hass}
    .data=${formData(ctx.config, fields)}
    .schema=${schema}
    .computeLabel=${(s: { name: string }) => localize(ctx.hass, labels[s.name] ?? `editor_${s.name}`)}
    @value-changed=${(ev: CustomEvent) => {
      ev.stopPropagation();
      const next = withEnergyDefaults(
        ctx.config,
        applyFormData(ctx.config, fields, (ev.detail?.value ?? {}) as Record<string, unknown>),
      );
      if (next !== ctx.config) ctx.commit(next);
    }}
  ></ha-form>`;
}

const LINE_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  ...COMPARE_FIELDS,
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'color_by', path: ['color_by'], default: 'series' },
  ...LABEL_FIELDS,
  { name: 'line_width', path: ['line_width'], default: DEFAULT_LINE_WIDTH },
  { name: 'dots', path: ['dots'], default: false },
  ...AXES_FIELDS,
  { name: 'y_scale', path: ['y_scale'], default: DEFAULT_AXES.scale },
  ...ZOOM_FIELDS,
  ...FORECAST_FIELDS,
  ...ANNOTATION_FIELDS,
  ...NOW_MARKER_FIELDS,
  ...EXTREMES_FIELDS,
  ...ANOMALY_FIELDS,
  ...SYNC_FIELDS,
  ...LAYOUT_FIELDS,
  ...MULTIPLES_FIELDS,
];

export function lineEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(
    `line|${historyVariant(ctx.config)}|${labelsVariant(ctx.config)}|${multiplesVariant(ctx.config)}|${forecastVariant(ctx.config)}|${anomalyVariant(ctx.config)}|${compareVariant(ctx.config)}`,
    ctx.hass,
    () => [
      ...historySchema(ctx.hass, ctx.config),
      ...compareSchema(ctx.hass, ctx.config),
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'curve', selector: choice(ctx.hass, 'curve', CURVES) },
          { name: 'color_by', selector: choice(ctx.hass, 'color_by', ['series', 'bands']) },
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
      ...labelSchema(ctx.hass, ctx.config),
      ...axesSchema(ctx.hass),
      // Only the line chart draws on a log scale: columns and stacked areas stand on zero.
      { name: 'y_scale', selector: choice(ctx.hass, 'y_scale', Y_SCALES) },
      ...ZOOM_SCHEMA,
      ...forecastSchema(ctx.config),
      ...ANNOTATION_SCHEMA,
      ...nowMarkerSchema(ctx.hass),
      ...extremesSchema(ctx.hass),
      ...anomalySchema(ctx.config),
      ...SYNC_SCHEMA,
      ...layoutSchema(ctx.hass),
      ...multiplesSchema(ctx.hass, ctx.config),
    ],
  );
  return html`${chartForm(ctx, 'chart', schema, LINE_FIELDS)}${annotationsEditor(ctx)}`;
}
