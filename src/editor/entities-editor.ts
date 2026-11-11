import { LitElement, css, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { localize } from '../localize';
import type { EntityFields } from '../styles/index';
import type { CardConfig, EntityConfig, HomeAssistant, Limit } from '../types';
import { addEntity, entityId, moveEntity, removeEntity, setEntityOption } from './edit';
import {
  ENTITY_ACTION_FIELDS,
  ENTITY_ATTRIBUTE_FIELDS,
  ENTITY_TEXT_FIELDS,
  applyFormData,
  entityActionsSchema,
  entityAttributeSchema,
  entityTextSchema,
  formData,
} from './schemas';
import type { FieldBinding } from './schemas';
import './bands-editor';
import './limit-field';
import { LanguageController } from '../language-controller';

type Item = string | EntityConfig;

const ICON_UP = 'M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z';
const ICON_DOWN = 'M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z';
const ICON_DELETE = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';
const ICON_CHEVRON = 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z';
const LIMITS = ['min', 'max', 'target'] as const;

/**
 * The unit a sensor reports, which the card shows when no unit is configured. It belongs to the
 * state, so an entity read from an attribute has none.
 */
export function sensorUnit(
  hass: HomeAssistant | undefined,
  id: string | undefined,
  attribute?: string,
): string | undefined {
  const unit = id && !attribute ? hass?.states[id]?.attributes?.unit_of_measurement : undefined;
  return typeof unit === 'string' && unit ? unit : undefined;
}

/** The entity list: pick, reorder and remove entities, and edit each one's overrides. */
export class CdEntitiesEditor extends LitElement {
  // Draws again once the user's language arrives.
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    entities: { attribute: false },
    unit: { attribute: false },
    chartFields: { attribute: false },
    transformFields: { attribute: false },
    conditionFields: { attribute: false },
    _expanded: { state: true },
  };

  static styles = css`
    :host {
      display: block;
    }
    .entity {
      border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      padding: 8px 0;
    }
    .label {
      display: block;
      font-size: 0.875em;
      color: var(--secondary-text-color);
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .label.missing {
      color: var(--error-color, #db4437);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .header ha-entity-picker {
      flex: 1;
      min-width: 0;
    }
    .expand {
      transition: transform 0.2s ease;
    }
    .expand[aria-expanded='true'] {
      transform: rotate(180deg);
    }
    @media (prefers-reduced-motion: reduce) {
      .expand {
        transition: none;
      }
    }
    .overrides {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 0 8px 12px;
      border-left: 2px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      margin-top: 8px;
    }
    .add {
      display: block;
      margin-top: 8px;
    }
  `;

  declare hass?: HomeAssistant;
  declare entities?: Item[];
  /** The card-wide unit, which entities without their own inherit. */
  declare unit?: string;
  /** The chart style's own per-entity options, when the card is a chart that has any. */
  declare chartFields?: EntityFields;
  /** History charts: the per-entity transforms (running total, rate of change), in a form of their own. */
  declare transformFields?: EntityFields;
  /** History charts: when each series is shown (its `when`), in a form of its own. */
  declare conditionFields?: EntityFields;
  /** Indexes of rows whose overrides are open. */
  declare _expanded: Set<number>;

  constructor() {
    super();
    this._expanded = new Set();
  }

  private _t(key: string, vars?: Record<string, string>): string {
    return localize(this.hass, key, vars);
  }

  private _computeLabel = (schema: { name: string }): string => this._t(`editor_${schema.name}`);

  /** Wrap the list so the shared config helpers can edit it. */
  private get _asConfig(): CardConfig {
    return { type: '', entities: this.entities ?? [] };
  }

  private _emit(config: CardConfig): void {
    if (config.entities === this.entities) return;
    this.dispatchEvent(new CustomEvent('value-changed', { detail: { value: config.entities ?? [] } }));
  }

  private _set(index: number, key: string, value: unknown): void {
    this._emit(setEntityOption(this._asConfig, index, key, value));
  }

  private _move(index: number, to: number): void {
    const expanded = new Set<number>();
    for (const i of this._expanded) expanded.add(i === index ? to : i === to ? index : i);
    this._expanded = expanded;
    this._emit(moveEntity(this._asConfig, index, to));
  }

  private _remove(index: number): void {
    const expanded = new Set<number>();
    for (const i of this._expanded) if (i !== index) expanded.add(i > index ? i - 1 : i);
    this._expanded = expanded;
    this._emit(removeEntity(this._asConfig, index));
  }

  private _toggle(index: number): void {
    const expanded = new Set(this._expanded);
    if (!expanded.delete(index)) expanded.add(index);
    this._expanded = expanded;
  }

  private _add(ev: CustomEvent): void {
    ev.stopPropagation();
    const id = ev.detail?.value;
    if (typeof id !== 'string' || id === '') return;
    (ev.target as HTMLElement & { value?: string }).value = '';
    this._emit(addEntity(this._asConfig, id));
  }

  private _formChanged(index: number, fields: FieldBinding[], ev: CustomEvent): void {
    ev.stopPropagation();
    const item = this.entities?.[index];
    if (item === undefined) return;
    const own = (typeof item === 'string' ? { entity: item } : item) as unknown as CardConfig;
    const next = applyFormData(own, fields, (ev.detail?.value ?? {}) as Record<string, unknown>);
    if (next === own) return;
    const entities = [...(this.entities ?? [])];
    const keys = Object.keys(next);
    entities[index] =
      keys.length === 1 && keys[0] === 'entity' ? (next.entity as string) : (next as unknown as EntityConfig);
    this._emit({ type: '', entities });
  }

  private _rowLabel(id: string): { text: string; missing: boolean } {
    const state = this.hass?.states[id];
    if (state) return { text: (state.attributes.friendly_name as string | undefined) || id, missing: false };
    if (!this.hass) return { text: id, missing: false };
    return { text: this._t('editor_not_found', { entity: id }), missing: true };
  }

  private _form(section: string, index: number, own: EntityConfig, schema: unknown[], fields: FieldBinding[]) {
    return html`<ha-form
      data-section=${section}
      .hass=${this.hass}
      .data=${formData(own as unknown as CardConfig, fields)}
      .schema=${schema}
      .computeLabel=${this._computeLabel}
      @value-changed=${(ev: CustomEvent) => this._formChanged(index, fields, ev)}
    ></ha-form>`;
  }

  private _renderOverrides(own: EntityConfig, index: number) {
    const stop = (fn: (value: unknown) => void) => (ev: CustomEvent) => {
      ev.stopPropagation();
      fn(ev.detail?.value);
    };
    return html`<div class="overrides">
      ${this._form('entity-attribute', index, own, entityAttributeSchema(own.entity), ENTITY_ATTRIBUTE_FIELDS)}
      ${this._form(
        'entity-text',
        index,
        own,
        entityTextSchema(sensorUnit(this.hass, own.entity, own.attribute)),
        ENTITY_TEXT_FIELDS,
      )}
      ${
        this.chartFields
          ? this._form('entity-chart', index, own, this.chartFields.schema, this.chartFields.fields)
          : nothing
      }
      ${
        this.transformFields
          ? this._form('entity-transform', index, own, this.transformFields.schema, this.transformFields.fields)
          : nothing
      }
      ${
        this.conditionFields
          ? this._form('entity-condition', index, own, this.conditionFields.schema, this.conditionFields.fields)
          : nothing
      }
      <ha-icon-picker
        .hass=${this.hass}
        .label=${this._t('editor_icon')}
        .value=${own.icon ?? ''}
        @value-changed=${stop((v) => this._set(index, 'icon', v))}
      ></ha-icon-picker>
      ${LIMITS.map(
        (key) =>
          html`<cd-limit-field
            data-limit=${key}
            .hass=${this.hass}
            .label=${this._t(`editor_${key}`)}
            .value=${own[key] as Limit | undefined}
            .defaultLabel=${this._t('editor_card_setting')}
            @value-changed=${stop((v) => this._set(index, key, v))}
          ></cd-limit-field>`,
      )}
      <cd-bands-editor
        .hass=${this.hass}
        .bands=${own.severity}
        .unit=${own.unit ?? this.unit ?? sensorUnit(this.hass, own.entity, own.attribute)}
        @value-changed=${stop((v) => this._set(index, 'severity', v))}
      ></cd-bands-editor>
      ${this._form('entity-actions', index, own, entityActionsSchema(), ENTITY_ACTION_FIELDS)}
    </div>`;
  }

  private _renderRow(item: Item, index: number, count: number) {
    const id = entityId(item);
    const own: EntityConfig = typeof item === 'string' ? { entity: item } : item;
    const label = this._rowLabel(id);
    const open = this._expanded.has(index);
    return html`<div class="entity">
      <span class="label ${label.missing ? 'missing' : ''}">${label.text}</span>
      <div class="header">
        <ha-entity-picker
          .hass=${this.hass}
          .value=${live(id)}
          allow-custom-entity
          @value-changed=${(ev: CustomEvent) => {
            ev.stopPropagation();
            this._set(index, 'entity', ev.detail?.value);
            // A cleared picker is ignored; re-render so live() puts the stored id back.
            this.requestUpdate();
          }}
        ></ha-entity-picker>
        <ha-icon-button
          class="up"
          .path=${ICON_UP}
          .label=${this._t('editor_move_up')}
          .disabled=${index === 0}
          @click=${() => this._move(index, index - 1)}
        ></ha-icon-button>
        <ha-icon-button
          class="down"
          .path=${ICON_DOWN}
          .label=${this._t('editor_move_down')}
          .disabled=${index === count - 1}
          @click=${() => this._move(index, index + 1)}
        ></ha-icon-button>
        <ha-icon-button
          class="remove"
          .path=${ICON_DELETE}
          .label=${this._t('editor_remove_entity')}
          @click=${() => this._remove(index)}
        ></ha-icon-button>
        <ha-icon-button
          class="expand"
          .path=${ICON_CHEVRON}
          .label=${this._t(open ? 'editor_hide_options' : 'editor_show_options')}
          aria-expanded=${open ? 'true' : 'false'}
          @click=${() => this._toggle(index)}
        ></ha-icon-button>
      </div>
      ${open ? this._renderOverrides(own, index) : nothing}
    </div>`;
  }

  render() {
    const entities = this.entities ?? [];
    return html`${entities.map((item, i) => this._renderRow(item, i, entities.length))}
      <ha-entity-picker
        class="add"
        .hass=${this.hass}
        .label=${this._t('editor_add_entity')}
        .value=${''}
        allow-custom-entity
        @value-changed=${this._add}
      ></ha-entity-picker>`;
  }
}

if (!customElements.get('cd-entities-editor')) {
  customElements.define('cd-entities-editor', CdEntitiesEditor);
}
