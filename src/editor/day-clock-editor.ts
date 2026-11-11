import type { TemplateResult } from 'lit';
import { BUCKETS } from '../chart/day-clock';
import { AGGREGATES } from '../history/group';
import type { ChartEditorContext, EntityFields } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { cachedSchema, chartForm, choice } from './chart-editors';
import type { FieldBinding } from './schemas';

export const DAY_CLOCK_FIELDS: FieldBinding[] = [
  { name: 'days', path: ['days'], default: 1 },
  { name: 'period_offset', path: ['period', 'offset'], default: 0 },
  { name: 'period_navigate', path: ['period', 'navigate'], default: false },
  { name: 'center', path: ['center'], default: 'total' },
  { name: 'bucket', path: ['bucket'], default: '60' },
  { name: 'aggregate', path: ['aggregate'], default: 'auto' },
  { name: 'tooltip', path: ['tooltip'], default: true },
];

function schema(hass?: HomeAssistant) {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'days', selector: { number: { min: 1, max: 31, mode: 'box' } } },
        { name: 'period_offset', selector: { number: { min: 0, mode: 'box' } } },
      ],
    },
    { name: 'period_navigate', selector: { boolean: {} } },
    { name: 'center', selector: choice(hass, 'day_clock_center', ['total', 'now', 'none']) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'bucket', selector: choice(hass, 'bucket', BUCKETS.map(String)) },
        { name: 'aggregate', selector: choice(hass, 'aggregate', ['auto', ...AGGREGATES]) },
      ],
    },
    { name: 'tooltip', selector: { boolean: {} } },
  ];
}

/** The dropdown speaks strings ("30"); the config keeps a number (30). */
function bucketAsText(config: CardConfig): CardConfig {
  return typeof config.bucket === 'number' ? { ...config, bucket: String(config.bucket) } : config;
}

function bucketAsNumber(config: CardConfig): CardConfig {
  return typeof config.bucket === 'string' ? { ...config, bucket: Number(config.bucket) } : config;
}

/** The Chart section: which days, what the middle says, and how numbers become bars. */
export function dayClockEditor(ctx: ChartEditorContext): TemplateResult {
  const view: ChartEditorContext = {
    ...ctx,
    config: bucketAsText(ctx.config),
    commit: (config) => ctx.commit(bucketAsNumber(config)),
  };
  return chartForm(
    view,
    'chart',
    cachedSchema('day_clock', ctx.hass, () => schema(ctx.hass)),
    DAY_CLOCK_FIELDS,
  );
}

const ENTITY_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'ring_color', selector: { text: {} } },
      { name: 'active', selector: { text: { multiple: true } } },
    ],
  },
];

const ENTITY_FIELDS: FieldBinding[] = [
  { name: 'ring_color', path: ['color'] },
  { name: 'active', path: ['active'] },
];

/** Each entity's ring colour, and which of its states count as on. */
export function dayClockEntityFields(): EntityFields {
  return { schema: ENTITY_SCHEMA, fields: ENTITY_FIELDS };
}
