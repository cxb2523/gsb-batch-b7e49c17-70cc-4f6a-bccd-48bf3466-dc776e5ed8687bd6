import type { TemplateResult } from 'lit';
import { CURVES } from '../chart/paths';
import { DEFAULT_LINE_WIDTH } from '../chart/series-style';
import type { ChartEditorContext } from '../styles/index';
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
} from './chart-editors';
import { LINE_WIDTH_SELECTOR } from './schemas';
import type { FieldBinding } from './schemas';

/** Climate charts read attributes, which only history keeps, and draw them ungrouped. */
const NOT_FOR_CLIMATE = new Set(['source', 'group_by', 'aggregate']);

export const CLIMATE_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS.filter((f) => !NOT_FOR_CLIMATE.has(f.name)),
  { name: 'set_point', path: ['set_point'], default: true },
  { name: 'shading', path: ['shading'], default: true },
  { name: 'shade_fan', path: ['shade_fan'], default: false },
  { name: 'curve', path: ['curve'], default: 'smooth' },
  { name: 'line_width', path: ['line_width'], default: DEFAULT_LINE_WIDTH },
  // Empty colours follow the theme: primary, error, and Home Assistant's heat and cool colours.
  { name: 'current_color', path: ['current_color'] },
  { name: 'set_point_color', path: ['set_point_color'] },
  { name: 'heating_color', path: ['heating_color'] },
  { name: 'cooling_color', path: ['cooling_color'] },
  ...AXES_FIELDS,
  ...LAYOUT_FIELDS,
];

/** The history schema without the source and grouping rows. */
function climateHistorySchema(ctx: ChartEditorContext): unknown[] {
  type Row = { name?: string; schema?: Row[] };
  return (historySchema(ctx.hass, ctx.config) as Row[]).filter(
    (row) => !NOT_FOR_CLIMATE.has(row.name ?? '') && !(row.schema ?? []).some((s) => NOT_FOR_CLIMATE.has(s.name ?? '')),
  );
}

export function climateEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`climate|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...climateHistorySchema(ctx),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'set_point', selector: { boolean: {} } },
        { name: 'shading', selector: { boolean: {} } },
        { name: 'shade_fan', selector: { boolean: {} } },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'curve', selector: choice(ctx.hass, 'curve', CURVES) },
        { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'current_color', selector: { text: {} } },
        { name: 'set_point_color', selector: { text: {} } },
        { name: 'heating_color', selector: { text: {} } },
        { name: 'cooling_color', selector: { text: {} } },
      ],
    },
    ...axesSchema(ctx.hass),
    ...layoutSchema(ctx.hass, false),
  ]);
  return chartForm(ctx, 'chart', schema, CLIMATE_FIELDS);
}
