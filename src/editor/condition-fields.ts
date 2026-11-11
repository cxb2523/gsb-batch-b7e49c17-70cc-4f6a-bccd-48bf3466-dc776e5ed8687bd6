import type { EntityFields } from '../styles/index';
import type { FieldBinding } from './schemas';

/**
 * History charts a series' `when` applies to: those that load through the shared frame, and the
 * box plot, candlestick, day clock and wind rose, which load their own. Not the climate chart:
 * it is one thermostat's own record, whose heating band already says when it ran.
 */
export const CONDITION_STYLES = [
  'line',
  'area',
  'column',
  'combined',
  'range_area',
  'sparkline',
  'streamgraph',
  'beeswarm',
  'violin',
  'histogram',
  'heatmap',
  'dumbbell',
  'slope',
  'trend',
  'waterfall',
  'timeline',
  'box',
  'candlestick',
  'day_clock',
  'wind_rose',
  'spiral',
  'strip_plot',
  'cycle_plot',
];

/** Charts that can also draw the hidden readings faintly and the strip under the plot. */
export const STRIP_STYLES = ['line', 'area'];

/** Each series' condition: the entity, and the state it must be in or the values it must be between. */
export const CONDITION_FIELDS: FieldBinding[] = [
  { name: 'when_entity', path: ['when', 'entity'] },
  { name: 'when_state', path: ['when', 'state'] },
  { name: 'when_above', path: ['when', 'above'] },
  { name: 'when_below', path: ['when', 'below'] },
];

const NUMBER = { number: { mode: 'box', step: 'any' } };

const CONDITION: EntityFields = {
  schema: [
    { name: 'when_entity', selector: { entity: {} } },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'when_state', selector: { text: {} } },
        { name: 'when_above', selector: NUMBER },
        { name: 'when_below', selector: NUMBER },
      ],
    },
  ],
  fields: CONDITION_FIELDS,
};

/** The card's `when`, for every series without its own. */
export const CARD_CONDITION_FIELDS: FieldBinding[] = [
  { name: 'when_card_entity', path: ['when', 'entity'] },
  { name: 'when_card_state', path: ['when', 'state'] },
  { name: 'when_card_above', path: ['when', 'above'] },
  { name: 'when_card_below', path: ['when', 'below'] },
];

const DRAWING_FIELDS: FieldBinding[] = [
  { name: 'when_ghost', path: ['when_ghost'], default: false },
  { name: 'when_strip', path: ['when_strip'], default: false },
];

const CARD_SCHEMA = [
  { name: 'when_card_entity', selector: { entity: {} } },
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'when_card_state', selector: { text: {} } },
      { name: 'when_card_above', selector: NUMBER },
      { name: 'when_card_below', selector: NUMBER },
    ],
  },
];

const CARD: EntityFields = { schema: CARD_SCHEMA, fields: CARD_CONDITION_FIELDS };
const CARD_DRAWN: EntityFields = {
  schema: [
    ...CARD_SCHEMA,
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'when_ghost', selector: { boolean: {} } },
        { name: 'when_strip', selector: { boolean: {} } },
      ],
    },
  ],
  fields: [...CARD_CONDITION_FIELDS, ...DRAWING_FIELDS],
};

/**
 * The card's condition form, in the Chart section under the style's own options, for the styles
 * in `CONDITION_STYLES` (with the faint line and strip switches on line and area charts).
 */
export function cardConditionFields(style: string | undefined): EntityFields | undefined {
  if (style === undefined || !CONDITION_STYLES.includes(style)) return undefined;
  return STRIP_STYLES.includes(style) ? CARD_DRAWN : CARD;
}

/**
 * The per-entity condition form, for the styles in `CONDITION_STYLES` (undefined for others). Its
 * own form beside the style's per-entity fields, so styles' field lists stay as they are.
 */
export function conditionFields(style: string | undefined): EntityFields | undefined {
  return style !== undefined && CONDITION_STYLES.includes(style) ? CONDITION : undefined;
}
