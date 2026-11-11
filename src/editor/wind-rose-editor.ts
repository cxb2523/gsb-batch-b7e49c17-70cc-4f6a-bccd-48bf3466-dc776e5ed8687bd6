import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { SECTOR_COUNTS } from '../chart/wind';
import { localize } from '../localize';
import type { ChartEditorContext } from '../styles/index';
import type { CardConfig } from '../types';
import { HISTORY_FIELDS, cachedSchema, chartForm, choice, historySchema, historyVariant } from './chart-editors';
import type { FieldBinding } from './schemas';

/** The history fields with the wind rose's month as the default span, and no grouping. */
const PERIOD_FIELDS: FieldBinding[] = HISTORY_FIELDS.filter((f) => f.name !== 'group_by' && f.name !== 'aggregate').map(
  (f) => (f.name === 'period_last' ? { ...f, default: 30 } : f.name === 'period_unit' ? { ...f, default: 'day' } : f),
);

const WIND_FIELDS: FieldBinding[] = [
  ...PERIOD_FIELDS,
  { name: 'sectors', path: ['sectors'], default: '16' },
  { name: 'calm', path: ['calm'] },
  { name: 'tooltip', path: ['tooltip'], default: true },
  { name: 'compact', path: ['compact'], default: false },
];

/** ha-form's dropdown hands back text, so sectors are shown as text and written back as a number. */
function sectorsAsText(config: CardConfig): CardConfig {
  return typeof config.sectors === 'number' ? { ...config, sectors: String(config.sectors) } : config;
}

function sectorsAsNumber(config: CardConfig): CardConfig {
  if (typeof config.sectors !== 'string') return config;
  const n = Number(config.sectors);
  return { ...config, sectors: Number.isFinite(n) ? n : config.sectors };
}

function entityName(ctx: ChartEditorContext, raw: CardConfig['entities'] extends (infer E)[] | undefined ? E : never) {
  if (raw === undefined) return localize(ctx.hass, 'editor_wind_none');
  const id = typeof raw === 'string' ? raw : raw.entity;
  const own = typeof raw === 'string' ? undefined : raw.name;
  return own ?? (ctx.hass?.states[id]?.attributes?.friendly_name as string | undefined) ?? id;
}

/** The wind rose's Chart section: which entity is which, the span, sectors, calm and layout. */
export function windRoseEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`wind_rose|${historyVariant(ctx.config)}`, ctx.hass, () => [
    // Grouping readings means nothing to a rose: leave its row out.
    ...historySchema(ctx.hass, ctx.config).filter(
      (field) => !(field as { schema?: { name: string }[] }).schema?.some((f) => f.name === 'group_by'),
    ),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'sectors', selector: choice(ctx.hass, 'sectors', SECTOR_COUNTS.map(String)) },
        { name: 'calm', selector: { number: { min: 0, mode: 'box', step: 'any' } } },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'tooltip', selector: { boolean: {} } },
        { name: 'compact', selector: { boolean: {} } },
      ],
    },
  ]);
  const entities = ctx.config.entities ?? [];
  const view: ChartEditorContext = {
    ...ctx,
    config: sectorsAsText(ctx.config),
    commit: (config) => ctx.commit(sectorsAsNumber(config)),
  };
  const note = 'margin: 0 0 12px; color: var(--secondary-text-color); font-size: 0.875em; line-height: 1.4;';
  return html`<p class="wind-roles" style=${note}>
      ${localize(ctx.hass, 'editor_wind_roles')}
      <br /><b
        >${localize(ctx.hass, 'editor_wind_now', {
          direction: entityName(ctx, entities[0]),
          speed: entityName(ctx, entities[1]),
        })}</b
      >
    </p>
    ${
      ctx.config.source === 'statistics'
        ? html`<p class="wind-statistics" style=${note}>${localize(ctx.hass, 'editor_wind_statistics')}</p>`
        : nothing
    }
    ${chartForm(view, 'chart', schema, WIND_FIELDS)}`;
}
