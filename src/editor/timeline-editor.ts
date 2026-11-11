import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { localize } from '../localize';
import type { ChartEditorContext, EntityFields } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { HISTORY_FIELDS, cachedSchema, chartForm, choice, historySchema, historyVariant } from './chart-editors';
import type { FieldBinding } from './schemas';

/** A state timeline reads states, which statistics don't keep, and draws them ungrouped. */
const NOT_FOR_TIMELINE = new Set(['source', 'group_by', 'aggregate']);

export const TIMELINE_FIELDS: FieldBinding[] = [
  ...HISTORY_FIELDS.filter((f) => !NOT_FOR_TIMELINE.has(f.name)),
  { name: 'bar_labels', path: ['bar_labels'], default: 'state' },
  { name: 'x_axis', path: ['x_axis'], default: true },
  { name: 'grid_vertical', path: ['gridlines', 'vertical'], default: true },
  { name: 'tooltip', path: ['tooltip'], default: true },
  { name: 'timeline_legend', path: ['header'], default: 'above' },
  { name: 'compact', path: ['compact'], default: false },
];

function timelineHistorySchema(hass: HomeAssistant | undefined, config: CardConfig): unknown[] {
  type Row = { name?: string; schema?: Row[] };
  return (historySchema(hass, config) as Row[]).filter(
    (row) =>
      !NOT_FOR_TIMELINE.has(row.name ?? '') && !(row.schema ?? []).some((s) => NOT_FOR_TIMELINE.has(s.name ?? '')),
  );
}

const DELETE_ICON = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';
const TEXT = { text: {} };

function colorsOf(config: CardConfig): [string, string][] {
  const v = config.state_colors;
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v as Record<string, string>) : [];
}

/** The config with `state_colors` set to these entries; none removes the key. */
export function withStateColors(config: CardConfig, entries: [string, string][]): CardConfig {
  const next = { ...config };
  const kept = entries.filter(([state]) => state.trim() !== '');
  if (kept.length) next.state_colors = Object.fromEntries(kept.map(([s, c]) => [s.trim(), c]));
  else delete next.state_colors;
  return next;
}

/**
 * A state for a new row: the first current state of the card's entities that has no colour yet,
 * else a common one, so the user mostly just picks a colour.
 */
export function suggestState(config: CardConfig, hass: HomeAssistant | undefined): string {
  const taken = new Set(colorsOf(config).map(([s]) => s));
  const ids = (config.entities ?? []).map((e) => (typeof e === 'string' ? e : e.entity));
  const current = ids.map((id) => hass?.states[id]?.state).filter((s): s is string => !!s);
  const candidates = [...current, 'on', 'off', 'home', 'not_home', 'heat', 'idle'];
  return candidates.find((s) => !taken.has(s) && s !== 'unavailable' && s !== 'unknown') ?? `state_${taken.size + 1}`;
}

/** One row per coloured state: its name, its colour and a remove button, then an add button. */
function stateColorsEditor(ctx: ChartEditorContext): TemplateResult {
  const entries = colorsOf(ctx.config);
  const t = (k: string) => localize(ctx.hass, k);
  const set = (next: [string, string][]) => ctx.commit(withStateColors(ctx.config, next));
  const change = (i: number, part: 0 | 1) => (ev: CustomEvent) => {
    ev.stopPropagation();
    const value = String(ev.detail?.value ?? '');
    const next = entries.map((e) => [...e] as [string, string]);
    if (part === 1 && value.trim() === '') return;
    next[i][part] = value;
    set(next);
  };
  return html`<div class="state-colors" data-section="state-colors">
    <style>
      .state-colors {
        margin-top: 16px;
      }
      .state-colors .sc-title {
        font-weight: 500;
      }
      .state-colors .sc-help {
        font-size: 0.875em;
        color: var(--secondary-text-color);
        margin: 2px 0 8px;
      }
      .state-colors .sc-row {
        display: grid;
        grid-template-columns: 16px 1fr 1fr auto;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      .state-colors .sc-swatch {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 1px solid var(--divider-color);
      }
      .state-colors .sc-add {
        font: inherit;
        color: var(--primary-color);
        background: none;
        border: 1px solid color-mix(in srgb, var(--primary-color) 40%, transparent);
        border-radius: 16px;
        padding: 6px 14px;
        cursor: pointer;
      }
    </style>
    <div class="sc-title">${t('editor_state_colors')}</div>
    <div class="sc-help">${t('editor_state_colors_help')}</div>
    ${entries.map(
      ([state, color], i) =>
        html`<div class="sc-row">
          <span class="sc-swatch" style="background:${baseColor(color)}"></span>
          <ha-selector
            data-role="state"
            .hass=${ctx.hass}
            .label=${t('editor_state_colors_state')}
            .selector=${TEXT}
            .value=${state}
            @value-changed=${change(i, 0)}
          ></ha-selector>
          <ha-selector
            data-role="color"
            .hass=${ctx.hass}
            .label=${t('editor_state_colors_color')}
            .selector=${TEXT}
            .value=${color}
            @value-changed=${change(i, 1)}
          ></ha-selector>
          <ha-icon-button
            class="sc-remove"
            .path=${DELETE_ICON}
            .label=${t('editor_state_colors_remove')}
            @click=${() => set(entries.filter((_, j) => j !== i))}
          ></ha-icon-button>
        </div>`,
    )}
    <button
      type="button"
      class="sc-add"
      @click=${() => set([...entries, [suggestState(ctx.config, ctx.hass), 'primary']])}
    >
      ${t('editor_state_colors_add')}
    </button>
  </div>`;
}

export function timelineEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema(`timeline|${historyVariant(ctx.config)}`, ctx.hass, () => [
    ...timelineHistorySchema(ctx.hass, ctx.config),
    { name: 'bar_labels', selector: choice(ctx.hass, 'bar_labels', ['state', 'duration', 'both', 'none']) },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'x_axis', selector: { boolean: {} } },
        { name: 'grid_vertical', selector: { boolean: {} } },
        { name: 'tooltip', selector: { boolean: {} } },
        { name: 'compact', selector: { boolean: {} } },
      ],
    },
    { name: 'timeline_legend', selector: choice(ctx.hass, 'timeline_legend', ['above', 'hidden']) },
  ]);
  return html`${chartForm(ctx, 'chart', schema, TIMELINE_FIELDS)}${stateColorsEditor(ctx)}`;
}

const ENTITY_FIELDS: FieldBinding[] = [{ name: 'timeline_group', path: ['group'] }];

/** Each entity's group: rows that share one are drawn together under its name. */
export function timelineEntityFields(hass: HomeAssistant | undefined): EntityFields {
  return {
    schema: cachedSchema('timeline_entity', hass, () => [{ name: 'timeline_group', selector: { text: {} } }]),
    fields: ENTITY_FIELDS,
  };
}
