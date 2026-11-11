import { LitElement, css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { LanguageController } from '../language-controller';
import { languageOf, localize } from '../localize';
import type { Band, CardConfig, HomeAssistant, Limit } from '../types';
import './bands-editor';
import './limit-field';
import { setOption } from './edit';
import { loadHaComponents } from './chartdeck-card-editor';
import { applyFormData, formData } from './schemas';
import type { FieldBinding } from './schemas';

/*
 * The badge's visual editor: entity and look first, then what it reads and how it is labelled,
 * then min and max (the card's limit field: default, a number or an entity), colour bands (the
 * card's band editor) and actions. Every option the badge reads is here.
 * Labels are `editor_badge_<field>`, so they never clash with the card editor's.
 */

const STYLES = ['value', 'sparkline', 'ring', 'thin'] as const;

export const BADGE_FIELDS: FieldBinding[] = [
  { name: 'entity', path: ['entity'] },
  { name: 'style', path: ['style'], default: 'value' },
  { name: 'attribute', path: ['attribute'] },
  { name: 'name', path: ['name'] },
  { name: 'show_name', path: ['show_name'], default: true },
  { name: 'show_icon', path: ['show_icon'], default: true },
  { name: 'hours', path: ['hours'], default: 24 },
  { name: 'icon', path: ['icon'] },
  { name: 'unit', path: ['unit'] },
  { name: 'decimals', path: ['decimals'] },
  { name: 'color', path: ['color'] },
];

export const BADGE_ACTION_FIELDS: FieldBinding[] = [
  { name: 'tap_action', path: ['tap_action'], default: { action: 'more-info' } },
  { name: 'hold_action', path: ['hold_action'], default: { action: 'none' } },
  { name: 'double_tap_action', path: ['double_tap_action'], default: { action: 'none' } },
];

const schemas = new Map<string, unknown[]>();

/** Min and max with the card's defaults (`normalizeConfig`), edited with the card's limit field. */
export const BADGE_LIMITS: ['min' | 'max', string][] = [
  ['min', '0'],
  ['max', '100'],
];

/**
 * The form for a badge: the icon switch and icon picker only on the value look (the picker only
 * while the icon shows), hours only on the sparkline. Min and max are limit fields below it.
 */
export function badgeSchema(hass: HomeAssistant | undefined, config: CardConfig): unknown[] {
  const style = (config.style as string | undefined) ?? 'value';
  const entity = typeof config.entity === 'string' ? config.entity : '';
  const icon = style === 'value' && config.show_icon !== false;
  const cacheKey = `${languageOf(hass)}|${style}|${entity}|${icon}`;
  let schema = schemas.get(cacheKey);
  if (!schema) {
    schema = [
      { name: 'entity', required: true, selector: { entity: {} } },
      {
        name: 'style',
        selector: {
          select: {
            mode: 'dropdown',
            options: STYLES.map((value) => ({ value, label: localize(hass, `editor_badge_style_${value}`) })),
          },
        },
      },
      ...(entity ? [{ name: 'attribute', selector: { attribute: { entity_id: entity } } }] : []),
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'name', selector: { text: {} } },
          ...(style === 'sparkline'
            ? [{ name: 'hours', selector: { number: { min: 1, max: 168, mode: 'box', unit_of_measurement: 'h' } } }]
            : []),
        ],
      },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'show_name', selector: { boolean: {} } },
          ...(style === 'value' ? [{ name: 'show_icon', selector: { boolean: {} } }] : []),
        ],
      },
      ...(icon ? [{ name: 'icon', selector: { icon: {} }, context: { icon_entity: 'entity' } }] : []),
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'unit', selector: { text: {} } },
          { name: 'decimals', selector: { number: { min: 0, max: 20, mode: 'box' } } },
        ],
      },
      { name: 'color', selector: { text: {} } },
    ];
    schemas.set(cacheKey, schema);
  }
  return schema;
}

const ACTIONS_SCHEMA = ['tap_action', 'hold_action', 'double_tap_action'].map((name) => ({
  name,
  selector: { ui_action: {} },
}));

export class ChartdeckBadgeEditor extends LitElement {
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: CardConfig;

  setConfig(config: CardConfig): void {
    this._config = config;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void loadHaComponents();
  }

  private _label = (schema: { name: string }): string => localize(this.hass, `editor_badge_${schema.name}`);

  private _commit(config: CardConfig): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config } }));
  }

  private _formChanged(fields: FieldBinding[], ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    this._commit(applyFormData(this._config, fields, ev.detail.value as Record<string, unknown>));
  }

  /** Bands and limits come from the card's own elements, each writing one key. */
  private _optionChanged(key: string, ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    this._commit(setOption(this._config, [key], ev.detail.value));
  }

  private _form(section: string, schema: unknown[], fields: FieldBinding[]): TemplateResult {
    return html`<ha-form
      data-section=${section}
      .hass=${this.hass}
      .data=${formData(this._config!, fields)}
      .schema=${schema}
      .computeLabel=${this._label}
      @value-changed=${(ev: CustomEvent) => this._formChanged(fields, ev)}
    ></ha-form>`;
  }

  render() {
    if (!this._config) return nothing;
    const entity = typeof this._config.entity === 'string' ? this._config.entity : undefined;
    const unit =
      (this._config.unit as string | undefined) ?? this.hass?.states[entity ?? '']?.attributes?.unit_of_measurement;
    return html`${this._form('badge', badgeSchema(this.hass, this._config), BADGE_FIELDS)}
      <div class="limits">
        ${BADGE_LIMITS.map(
          ([key, defaultLabel]) =>
            html`<cd-limit-field
              data-limit=${key}
              .hass=${this.hass}
              .label=${localize(this.hass, `editor_badge_${key}`)}
              .value=${this._config?.[key] as Limit | undefined}
              .defaultLabel=${defaultLabel}
              @value-changed=${(ev: CustomEvent) => this._optionChanged(key, ev)}
            ></cd-limit-field>`,
        )}
      </div>
      <div class="heading">${localize(this.hass, 'editor_badge_bands')}</div>
      <p class="help">${localize(this.hass, 'editor_badge_bands_help')}</p>
      <cd-bands-editor
        .hass=${this.hass}
        .bands=${this._config.severity as Band[] | undefined}
        .unit=${unit}
        @value-changed=${(ev: CustomEvent) => this._optionChanged('severity', ev)}
      ></cd-bands-editor>
      <div class="heading">${localize(this.hass, 'editor_badge_actions')}</div>
      ${this._form('actions', ACTIONS_SCHEMA, BADGE_ACTION_FIELDS)}`;
  }

  static styles = css`
    :host {
      display: block;
    }
    .limits {
      display: grid;
      gap: 8px;
      margin-top: 16px;
    }
    .heading {
      margin-top: 24px;
      font-weight: 500;
    }
    .help {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
  `;
}

if (!customElements.get('chartdeck-badge-editor')) {
  customElements.define('chartdeck-badge-editor', ChartdeckBadgeEditor);
}
