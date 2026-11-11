import { LitElement, css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { localize } from '../localize';
import { STYLE_NAMES } from '../types';
import type { Band, CardConfig, HomeAssistant, Limit, StyleName } from '../types';
import { fireConfigChanged, setOption } from './edit';
import {
  ACTION_FIELDS,
  COLOUR_TOGGLE_FIELDS,
  DISPLAY_FIELDS,
  DISPLAY_TOGGLE_FIELDS,
  GAUGE_FIELDS,
  TITLE_FIELDS,
  actionsSchema,
  applyFormData,
  deepEqual,
  displaySchema,
  formData,
  gaugeSchema,
  RULE_FIELDS,
  ruleSchema,
  titleSchema,
} from './schemas';
import type { FieldBinding } from './schemas';

/** The export menu's switch, in the Display section of chart styles. */
const EXPORT_FIELDS: FieldBinding[] = [{ name: 'export', path: ['export'], default: false }];

import { thumbnail } from './thumbnails';
import { cardConditionFields, conditionFields } from './condition-fields';
import { STYLES, STYLE_GROUPS, isChart } from '../styles/index';
import { sensorUnit } from './entities-editor';
import './bands-editor';
import './entities-editor';
import './limit-field';
import { GROUP_LEVELS } from '../chart/hierarchy';
import { LanguageController } from '../language-controller';
import { withCumulativeFields } from '../history/transform-cumulative';
import { withDerivativeFields } from '../history/transform-derivative';

/** Styles whose `group_by` groups entities by place rather than readings by time. */
const HIERARCHY_STYLES: StyleName[] = ['treemap', 'sunburst', 'icicle', 'radar', 'marimekko'];
/** Styles with the gauge options (angles, centre text, tick labels). */
const GAUGE_STYLES: StyleName[] = ['ring', 'arc', 'needle'];

interface CardHelpers {
  createCardElement(config: Record<string, unknown>): Promise<HTMLElement>;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

/** Make Home Assistant load its lazily-loaded form and pickers by asking a core card for its editor. */
export async function loadHaComponents(): Promise<void> {
  if (customElements.get('ha-entity-picker')) return;
  if (typeof window.loadCardHelpers !== 'function') return;
  try {
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: 'entities', entities: [] });
    const ctor = card?.constructor as { getConfigElement?: () => Promise<unknown> } | undefined;
    await ctor?.getConfigElement?.();
  } catch {
    // Not running inside Home Assistant's frontend; nothing to load.
  }
}

export class ChartdeckCardEditor extends LitElement {
  // Draws again once the user's language arrives.
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  static styles = css`
    :host {
      display: block;
    }
    .title {
      display: block;
      margin-bottom: 16px;
    }
    ha-expansion-panel {
      display: block;
      margin-bottom: 8px;
    }
    .panel {
      padding: 8px 0;
    }
    .toggles {
      margin-bottom: 16px;
    }
    .toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 48px;
    }
    .toggle span {
      flex: 1;
      cursor: pointer;
    }
    .rules-heading {
      margin: 16px 0 4px;
      font-weight: 500;
    }
    .rules-help,
    .gauge-help {
      margin: 0 0 8px;
      color: var(--secondary-text-color);
      font-size: 0.875em;
    }
    .section-limits {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .style-group {
      margin: 12px 0 6px;
      font-size: 0.875em;
      font-weight: 500;
      color: var(--secondary-text-color);
    }
    .style-group:first-child {
      margin-top: 0;
    }
    .styles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 8px;
    }
    .style {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 8px 4px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      border-radius: 8px;
      background: none;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 0.875em;
      cursor: pointer;
    }
    .style:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }
    .style[aria-pressed='true'] {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
      border-color: transparent;
    }
  `;

  declare hass?: HomeAssistant;
  declare _config?: CardConfig;

  /** Store the raw config as written, so keys the editor doesn't show are never lost. */
  setConfig(config: CardConfig): void {
    this._config = config;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void loadHaComponents();
  }

  private _label = (key: string): string => localize(this.hass, key);

  private _computeLabel = (schema: { name: string }): string => localize(this.hass, `editor_${schema.name}`);

  private _commit(config: CardConfig): void {
    this._config = config;
    fireConfigChanged(this, config);
  }

  private _formChanged(fields: FieldBinding[], ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    const value = (ev.detail?.value ?? {}) as Record<string, unknown>;
    this._commit(applyFormData(this._config, fields, value));
  }

  private _form(section: string, schema: unknown[], fields: FieldBinding[]): TemplateResult {
    return html`<ha-form
      data-section=${section}
      .hass=${this.hass}
      .data=${formData(this._config!, fields)}
      .schema=${schema}
      .computeLabel=${this._computeLabel}
      @value-changed=${(ev: CustomEvent) => this._formChanged(fields, ev)}
    ></ha-form>`;
  }

  private _panel(key: string, content: unknown): TemplateResult {
    return html`<ha-expansion-panel .header=${this._label(`editor_section_${key}`)} outlined>
      <div class="panel section-${key}">${content}</div>
    </ha-expansion-panel>`;
  }

  /** Commit a sub-editor's `value-changed` to `path`, keeping it from reaching HA's dialog. */
  private _subChanged(path: string[], ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    this._commit(setOption(this._config, path, ev.detail?.value));
  }

  /** The current chart style's per-entity options, if it has any. */
  private _chartFields() {
    const module = STYLES[(this._config?.style ?? 'bar') as StyleName];
    return module && isChart(module) && this._config ? module.entityFields?.(this.hass, this._config) : undefined;
  }

  /** The history transforms each entity can take, on charts that draw history as numbers. */
  private _transformFields() {
    if (!this._config) return undefined;
    const style = this._config.style ?? 'bar';
    return withDerivativeFields(
      style,
      this.hass,
      this._config,
      withCumulativeFields(style, this.hass, this._config, undefined),
    );
  }

  /** Entity list, pickers and per-entity overrides, then the rules that add more. */
  protected renderEntities(): unknown {
    return html`<cd-entities-editor
        .hass=${this.hass}
        .entities=${this._config?.entities ?? []}
        .unit=${this._config?.unit}
        .chartFields=${this._chartFields()}
        .transformFields=${this._transformFields()}
        .conditionFields=${conditionFields(this._config?.style)}
        @value-changed=${(ev: CustomEvent) => this._subChanged(['entities'], ev)}
      ></cd-entities-editor>
      ${this._ruleForm('include')} ${this._ruleForm('exclude')}`;
  }

  /** ha-form data for a rule: each key as a list, since the pickers are all multiple. */
  private _ruleData(field: 'include' | 'exclude'): Record<string, string[]> {
    const rule = this._config?.[field];
    const data: Record<string, string[]> = {};
    if (!rule || typeof rule !== 'object') return data;
    for (const [key, value] of Object.entries(rule)) {
      data[`${field}_${key}`] = Array.isArray(value) ? value : [value];
    }
    return data;
  }

  private _ruleChanged(field: 'include' | 'exclude', ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    const value = (ev.detail?.value ?? {}) as Record<string, unknown>;
    const before = this._ruleData(field);
    let next = this._config;
    for (const key of RULE_FIELDS[field]) {
      const name = `${field}_${key}`;
      const list = Array.isArray(value[name]) ? (value[name] as string[]) : [];
      if (deepEqual(before[name] ?? [], list)) continue;
      next = setOption(next, [field, key], list.length ? list : undefined);
    }
    if (next !== this._config) this._commit(next);
  }

  private _ruleForm(field: 'include' | 'exclude'): TemplateResult {
    return html`<div class="rules-heading">${this._label(`editor_${field}_heading`)}</div>
      <p class="rules-help">${this._label(`editor_${field}_help`)}</p>
      <ha-form
        data-section=${field}
        .hass=${this.hass}
        .data=${this._ruleData(field)}
        .schema=${ruleSchema(field, this.hass)}
        .computeLabel=${this._computeRuleLabel}
        @value-changed=${(ev: CustomEvent) => this._ruleChanged(field, ev)}
      ></ha-form>`;
  }

  private _computeRuleLabel = (schema: { name: string }): string =>
    localize(this.hass, `editor_rule_${schema.name.slice(schema.name.indexOf('_') + 1)}`);

  /** Card-level min, max and target. */
  protected renderLimits(): unknown {
    const fields: ['min' | 'max' | 'target', string][] = [
      ['min', '0'],
      ['max', '100'],
      ['target', this._label('editor_none')],
    ];
    return fields.map(
      ([key, defaultLabel]) =>
        html`<cd-limit-field
          data-limit=${key}
          .hass=${this.hass}
          .label=${this._label(`editor_${key}`)}
          .value=${this._config?.[key] as Limit | undefined}
          .defaultLabel=${defaultLabel}
          @value-changed=${(ev: CustomEvent) => this._subChanged([key], ev)}
        ></cd-limit-field>`,
    );
  }

  /** The icon-colour switch, then the severity bands. */
  protected renderColours(): unknown {
    return html`${this._toggles(COLOUR_TOGGLE_FIELDS)}<cd-bands-editor
        .hass=${this.hass}
        .bands=${this._config?.severity as Band[] | undefined}
        .unit=${this._config?.unit ?? this._firstEntityUnit()}
        @value-changed=${(ev: CustomEvent) => this._subChanged(['severity'], ev)}
      ></cd-bands-editor>`;
  }

  /** The legend and card-wide bands use the first entity's unit when the card sets none:
   *  its own override, else its sensor's. */
  private _firstEntityUnit(): string | undefined {
    const first = this._config?.entities?.[0];
    if (typeof first === 'string') return sensorUnit(this.hass, first);
    return first?.unit ?? sensorUnit(this.hass, first?.entity, first?.attribute);
  }

  private _selectStyle(style: StyleName): void {
    if (!this._config) return;
    let next = setOption(this._config, ['style'], style === 'bar' ? undefined : style);
    // `group_by` means places (floor, area…) on the hierarchy charts and times (hour, day…) on the
    // history charts: one the new style can't read is dropped rather than left to fail.
    const levels = ([] as unknown[]).concat(next.group_by ?? []);
    const places = levels.length > 0 && levels.every((l) => (GROUP_LEVELS as readonly unknown[]).includes(l));
    if (levels.length > 0 && places !== HIERARCHY_STYLES.includes(style))
      next = setOption(next, ['group_by'], undefined);
    // The battery grid reads best with the emptiest first, so picking it sorts lowest first
    // unless a sort is already set (YAML without one keeps the order listed, like every style).
    if (style === 'battery' && next.sort === undefined) next = setOption(next, ['sort'], 'ascending');
    this._commit(next);
  }

  /** The style picker, one group of thumbnails per kind of style (bars, gauges, charts…). */
  protected renderStyle(): TemplateResult {
    const current = this._config?.style ?? 'bar';
    return html`${STYLE_GROUPS.map((group) => {
      const names = STYLE_NAMES.filter((name) => STYLES[name].group === group);
      if (!names.length) return nothing;
      return html`<div class="style-group">${this._label(`editor_group_${group}`)}</div>
        <div class="styles" data-group=${group}>
          ${names.map((style) => {
            const module = STYLES[style];
            const picture = isChart(module)
              ? html`<svg class="thumbnail" viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">
                  ${module.thumbnail()}
                </svg>`
              : thumbnail(style);
            return html`<button
              type="button"
              class="style"
              data-style=${style}
              aria-pressed=${current === style ? 'true' : 'false'}
              @click=${() => this._selectStyle(style)}
            >
              ${picture}<span>${this._label(`editor_style_${style}`)}</span>
            </button>`;
          })}
        </div>`;
    })}
    ${
      GAUGE_STYLES.includes(current as StyleName)
        ? html`<p class="gauge-help">${this._label('editor_gauge_help')}</p>
            ${this._form('gauge', gaugeSchema(this.hass, current as StyleName, this._config?.center), GAUGE_FIELDS)}`
        : nothing
    }`;
  }

  /** The current chart style's own options, when it has any. */
  protected renderChart(): TemplateResult | typeof nothing {
    const module = STYLES[(this._config?.style ?? 'bar') as StyleName];
    if (!module || !isChart(module) || !module.editor || !this._config) return nothing;
    // History charts: the card's `when`, for every series without its own, in a form of its own.
    const when = cardConditionFields(this._config.style);
    return this._panel(
      'chart',
      html`${module.editor({ hass: this.hass, config: this._config, commit: (config) => this._commit(config) })}
      ${when ? this._form('card-condition', when.schema, when.fields) : nothing}`,
    );
  }

  protected renderDisplay(): TemplateResult {
    // Charts can carry the export menu (save a picture, copy the values or the YAML).
    const chart = isChart(STYLES[(this._config?.style ?? 'bar') as StyleName] ?? STYLES.bar);
    return html`${this._toggles(chart ? [...DISPLAY_TOGGLE_FIELDS, ...EXPORT_FIELDS] : DISPLAY_TOGGLE_FIELDS)}
    ${this._form('display', displaySchema(this.hass), DISPLAY_FIELDS)}`;
  }

  /**
   * On/off options as compact label + switch rows: ha-form spaces every field 24 px apart, which
   * turns a few switches into a tall column, so only inputs go through ha-form.
   */
  private _toggles(fields: FieldBinding[]): TemplateResult {
    const data = formData(this._config!, fields);
    return html`<div class="toggles">
      ${fields.map(({ name }) => {
        const label = this._label(`editor_${name}`);
        const on = data[name] === true;
        // ha-switch isn't labelable, so it carries its own name and the text toggles it too.
        return html`<div class="toggle">
          <span @click=${() => this._toggle(fields, name, !on)}>${label}</span
          ><ha-switch
            data-name=${name}
            aria-label=${label}
            .checked=${live(on)}
            @change=${(ev: Event) => this._toggle(fields, name, (ev.target as HTMLInputElement).checked)}
          ></ha-switch>
        </div>`;
      })}
    </div>`;
  }

  private _toggle(fields: FieldBinding[], name: string, checked: boolean): void {
    if (!this._config) return;
    const data = formData(this._config, fields);
    this._commit(applyFormData(this._config, fields, { ...data, [name]: checked }));
  }

  protected renderActions(): TemplateResult {
    return this._form('actions', actionsSchema(), ACTION_FIELDS);
  }

  render() {
    if (!this._config) return nothing;
    return html`<div class="title">${this._form('title', titleSchema(), TITLE_FIELDS)}</div>
      ${this._panel('entities', this.renderEntities())} ${this._panel('style', this.renderStyle())}
      ${this.renderChart()} ${this._panel('limits', this.renderLimits())}
      ${this._panel('colours', this.renderColours())} ${this._panel('display', this.renderDisplay())}
      ${this._panel('actions', this.renderActions())}`;
  }
}

if (!customElements.get('chartdeck-card-editor')) {
  customElements.define('chartdeck-card-editor', ChartdeckCardEditor);
}
