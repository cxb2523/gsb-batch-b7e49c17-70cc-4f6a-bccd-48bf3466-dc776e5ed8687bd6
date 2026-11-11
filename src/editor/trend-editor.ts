import type { TemplateResult } from 'lit';
import { CURVES } from '../chart/paths';
import { DEFAULT_LINE_WIDTH } from '../chart/series-style';
import { AGGREGATES } from '../history/group';
import type { ChartEditorContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { HISTORY_FIELDS, cachedSchema, chartForm, choice, historySchema, historyVariant } from './chart-editors';
import { LINE_WIDTH_SELECTOR } from './schemas';
import type { FieldBinding } from './schemas';

/** The trend style's Chart section and per-entity options. Defaults match the style's (see styles/trend.ts). */

const TREND_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS,
  { name: 'points_per_hour', path: ['points_per_hour'], default: 0.5 },
  { name: 'graph', path: ['graph'], default: 'line' },
  { name: 'fill', path: ['fill'], default: 'fade' },
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'line_width', path: ['line_width'], default: DEFAULT_LINE_WIDTH },
  { name: 'points', path: ['points'], default: 'hover' },
  { name: 'labels', path: ['labels'], default: 'hover' },
  { name: 'height', path: ['height'], default: 150 },
  { name: 'bar_spacing', path: ['bar_spacing'], default: 4 },
  { name: 'color_transition', path: ['color_transition'], default: 'smooth' },
  { name: 'extrema', path: ['extrema'], default: false },
  { name: 'average', path: ['average'], default: false },
  { name: 'legend', path: ['legend'], default: true },
  { name: 'trend_y_min', path: ['y_min'] },
  { name: 'trend_y_max', path: ['y_max'] },
  { name: 'min_range', path: ['min_range'] },
  { name: 'y_min_secondary', path: ['y_min_secondary'] },
  { name: 'y_max_secondary', path: ['y_max_secondary'] },
  { name: 'min_range_secondary', path: ['min_range_secondary'] },
  { name: 'value_factor', path: ['value_factor'], default: 0 },
  { name: 'align_header', path: ['align_header'], default: 'default' },
  { name: 'align_icon', path: ['align_icon'], default: 'right' },
  { name: 'align_state', path: ['align_state'], default: 'left' },
  { name: 'font_size', path: ['font_size'], default: 100 },
  { name: 'font_size_header', path: ['font_size_header'] },
  { name: 'color_name', path: ['color_name'], default: false },
  { name: 'color_value', path: ['color_value'], default: false },
  { name: 'trend_color_icon', path: ['color_icon'], default: false },
  { name: 'group', path: ['group'], default: false },
  { name: 'icon_image', path: ['icon_image'] },
  { name: 'trend_tooltip', path: ['tooltip'], default: true },
];

const grid = (...schema: unknown[]) => ({ type: 'grid', name: '', schema });
const bool = (name: string) => ({ name, selector: { boolean: {} } });
const box = (name: string, min?: number, max?: number, step: number | 'any' = 'any') => ({
  name,
  selector: {
    number: { mode: 'box', step, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) },
  },
});
/** A bound takes a number or `~` and a number, so it is a text field; the card turns digits into a number. */
const bound = (name: string) => ({ name, selector: { text: {} } });

function trendSchema(hass: HomeAssistant | undefined, config: CardConfig) {
  return [
    ...historySchema(hass, config),
    box('points_per_hour', 0, 60),
    grid(
      { name: 'graph', selector: choice(hass, 'graph', ['line', 'bar', 'none']) },
      { name: 'fill', selector: choice(hass, 'fill', ['fade', 'solid', 'none']) },
      { name: 'curve', selector: choice(hass, 'curve', CURVES) },
      { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
      { name: 'points', selector: choice(hass, 'points', ['hover', 'always', 'never']) },
      { name: 'labels', selector: choice(hass, 'labels', ['hover', 'always', 'never']) },
      box('height', 20, 1000, 1),
      box('bar_spacing', 0, 50, 1),
    ),
    { name: 'color_transition', selector: choice(hass, 'color_transition', ['smooth', 'hard']) },
    grid(bool('extrema'), bool('average'), bool('legend'), bool('trend_tooltip')),
    grid(bound('trend_y_min'), bound('trend_y_max'), box('min_range', 0)),
    grid(bound('y_min_secondary'), bound('y_max_secondary'), box('min_range_secondary', 0)),
    grid(
      { name: 'align_header', selector: choice(hass, 'align_header', ['default', 'left', 'right', 'center']) },
      { name: 'align_icon', selector: choice(hass, 'align_icon', ['right', 'left', 'state']) },
      { name: 'align_state', selector: choice(hass, 'align_state', ['left', 'right', 'center']) },
      box('font_size', 25, 400, 1),
      box('font_size_header', 6, 60, 1),
      box('value_factor', -9, 9, 1),
    ),
    grid(bool('color_name'), bool('trend_color_icon'), bool('color_value'), bool('group')),
    { name: 'icon_image', selector: { text: {} } },
  ];
}

/** Bounds typed as digits become numbers, so `y_min: 0` stays a number in YAML. */
function numericBounds(config: CardConfig): CardConfig {
  let next = config;
  for (const k of ['y_min', 'y_max', 'y_min_secondary', 'y_max_secondary']) {
    const v = next[k];
    if (typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith('~') && Number.isFinite(Number(v))) {
      next = { ...next, [k]: Number(v) };
    } else if (v === '') {
      next = { ...next };
      delete next[k];
    }
  }
  return next;
}

export function trendEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`trend|${historyVariant(ctx.config)}`, ctx.hass, () => trendSchema(ctx.hass, ctx.config));
  const form = {
    ...ctx,
    // ha-form's text field hands back strings; keep bounds as numbers when they are.
    config: { ...ctx.config, ...stringBounds(ctx.config) },
    commit: (config: CardConfig) => ctx.commit(numericBounds(config)),
  };
  return chartForm(form, 'chart', schema, TREND_FIELDS, {
    legend: 'editor_trend_legend',
    labels: 'editor_trend_labels',
    group: 'editor_trend_group',
  });
}

/** Numbers shown in the bound text fields as text. */
function stringBounds(config: CardConfig): Partial<CardConfig> {
  const out: Partial<CardConfig> = {};
  for (const k of ['y_min', 'y_max', 'y_min_secondary', 'y_max_secondary']) {
    if (typeof config[k] === 'number') out[k] = String(config[k]);
  }
  return out;
}

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'series_color', path: ['color'] },
  { name: 'curve', path: ['curve'] },
  { name: 'line_width', path: ['line_width'] },
  { name: 'entity_aggregate', path: ['aggregate'] },
  { name: 'y_axis_side', path: ['y_axis'], default: 'primary' },
  { name: 'fixed_value', path: ['fixed_value'], default: false },
  { name: 'show_graph', path: ['show_graph'], default: true },
  { name: 'show_line', path: ['show_line'], default: true },
  { name: 'show_fill', path: ['show_fill'], default: true },
  { name: 'show_points', path: ['show_points'] },
  { name: 'show_legend_entity', path: ['show_legend'], default: true },
  { name: 'show_legend_state', path: ['show_legend_state'], default: false },
  { name: 'show_indicator', path: ['show_indicator'], default: false },
  { name: 'show_state', path: ['show_state'], default: false },
];

function entitySchema(hass: HomeAssistant | undefined) {
  return [
    grid(
      { name: 'series_color', selector: { text: {} } },
      { name: 'curve', selector: choice(hass, 'curve', CURVES) },
      { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
      { name: 'entity_aggregate', selector: choice(hass, 'aggregate', AGGREGATES) },
      { name: 'y_axis_side', selector: choice(hass, 'y_axis_side', ['primary', 'secondary']) },
    ),
    grid(
      bool('show_state'),
      bool('show_indicator'),
      bool('show_graph'),
      bool('show_line'),
      bool('show_fill'),
      bool('show_points'),
      bool('show_legend_entity'),
      bool('show_legend_state'),
      bool('fixed_value'),
    ),
  ];
}

/** Colour, shape, axis and what shows for one entity. */
export function trendEntityFields(hass: HomeAssistant | undefined) {
  return { schema: cachedSchema('trend-entity', hass, () => entitySchema(hass)), fields: ENTITY_FIELDS };
}
