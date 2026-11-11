import { LitElement, css, html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { BAND_PRESETS, PALETTE, baseColor } from '../bands';
import { languageOf, localize } from '../localize';
import type { Band, HomeAssistant } from '../types';
import { deepEqual } from './schemas';
import { LanguageController } from '../language-controller';

export type PresetName = keyof typeof BAND_PRESETS;

const PRESET_NAMES = Object.keys(BAND_PRESETS) as PresetName[];
const COLOR_NAMES = Object.keys(PALETTE);
const CUSTOM = 'custom';
const DELETE_ICON = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';
const TEXT_SELECTOR = { text: {} };
const ENTITY_SELECTOR = { entity: { domain: ['sensor', 'input_number', 'number'] } };
const ICON_ENTITY =
  'M3.9,12C3.9,10.29 5.29,8.9 7,8.9H11V7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 3.9,13.71 3.9,12M8,13H16V11H8V13M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.71 18.71,15.1 17,15.1H13V17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7Z';
const ICON_NUMBER =
  'M4,17V9H2V7H6V17H4M22,15C22,16.11 21.1,17 20,17H16V15H20V13H18V11H20V9H16V7H20A2,2 0 0,1 22,9V10.5A1.5,1.5 0 0,1 20.5,12A1.5,1.5 0 0,1 22,13.5V15M14,15V17H8V13C8,11.89 8.9,11 10,11H12V9H8V7H12A2,2 0 0,1 14,9V11C14,12.11 13.1,13 12,13H10V15H14Z';

/** A band start that names an entity rather than a number (numeric text counts as a number). */
export function isEntityStart(from: unknown): from is string {
  return typeof from === 'string' && from.trim() !== '' && !Number.isFinite(Number(from));
}
const ICON_SELECTOR = { icon: {} };

/** The preset whose bands match exactly, `none` for no bands, otherwise `custom`. */
export function presetFor(bands: Band[] | undefined): PresetName | 'custom' {
  if (bands === undefined) return 'none';
  return PRESET_NAMES.find((name) => BAND_PRESETS[name] && deepEqual(BAND_PRESETS[name], bands)) ?? 'custom';
}

function isPaletteColor(color: string): boolean {
  return COLOR_NAMES.includes(color);
}

/** Severity bands: a preset picker, then one editable row per band. */
export class CdBandsEditor extends LitElement {
  // Draws again once the user's language arrives.
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    bands: { attribute: false },
    unit: { attribute: false },
    _customOpen: { state: true },
    _entityOpen: { state: true },
  };

  static styles = css`
    :host {
      display: block;
    }
    /* Two lines per band: where it starts and its colour, then its label and icon. */
    .band {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) minmax(0, 1fr) auto auto;
      grid-template-areas:
        'swatch from color mode remove'
        '. label icon icon icon';
      gap: 8px;
      align-items: center;
      margin-top: 12px;
    }
    .band + .band {
      padding-top: 12px;
      border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .swatch {
      grid-area: swatch;
    }
    [data-role='from'] {
      grid-area: from;
    }
    [data-role='color'] {
      grid-area: color;
    }
    [data-role='label'] {
      grid-area: label;
    }
    [data-role='icon'] {
      grid-area: icon;
    }
    .from-mode {
      grid-area: mode;
    }
    .remove {
      grid-area: remove;
    }
    .swatch {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--swatch);
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      box-sizing: border-box;
    }
    /* Optional extra lines go below the two named ones, so a band without them has no gap. */
    .custom,
    .from-entity {
      grid-column: 2 / -1;
    }
    .add-band {
      margin-top: 8px;
      padding: 6px 12px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      border-radius: 8px;
      background: none;
      color: var(--primary-color);
      font: inherit;
      cursor: pointer;
    }
    .add-band:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }
  `;

  declare hass?: HomeAssistant;
  declare bands?: Band[];
  declare unit?: string;
  /** Rows where "Custom…" was chosen but nothing typed yet: the field shows, the config is untouched. */
  declare _customOpen: Set<number>;
  /** Rows switched to "start from an entity" with no entity picked yet. */
  declare _entityOpen: Set<number>;

  constructor() {
    super();
    this._customOpen = new Set();
    this._entityOpen = new Set();
  }

  /** New bands (a preset, a YAML edit, a reorder, our own edits) close any half-open field. */
  protected willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('bands')) return;
    if (this._customOpen.size) this._customOpen = new Set();
    if (this._entityOpen.size) this._entityOpen = new Set();
  }

  /** The number an entity start currently reads, for the greyed-out From box. */
  private _entityValue(id: string): number | undefined {
    const state = this.hass?.states[id]?.state;
    const n = state === undefined || state.trim() === '' ? NaN : Number(state);
    return Number.isFinite(n) ? n : undefined;
  }

  private _selectors?: { key: string; preset: unknown; presetCustom: unknown; color: unknown; from: unknown };

  private _t(key: string): string {
    return localize(this.hass, key);
  }

  /** Selector objects, rebuilt only when the language or unit changes. */
  private _getSelectors() {
    const key = `${languageOf(this.hass)}|${this.unit ?? ''}`;
    if (this._selectors?.key === key) return this._selectors;
    const presetOptions = PRESET_NAMES.map((value) => ({ value, label: this._t(`editor_preset_${value}`) }));
    const select = (options: { value: string; label: string }[]) => ({ select: { mode: 'dropdown', options } });
    this._selectors = {
      key,
      preset: select(presetOptions),
      presetCustom: select([...presetOptions, { value: CUSTOM, label: this._t('editor_preset_custom') }]),
      color: select([...COLOR_NAMES, CUSTOM].map((value) => ({ value, label: this._t(`editor_color_${value}`) }))),
      from: { number: { mode: 'box', step: 'any', ...(this.unit ? { unit_of_measurement: this.unit } : {}) } },
    };
    return this._selectors;
  }

  private _emit(bands: Band[] | undefined): void {
    this.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: bands && bands.length ? bands : undefined } }),
    );
  }

  private _presetChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const name = ev.detail?.value as string | undefined;
    if (!name || name === CUSTOM || !PRESET_NAMES.includes(name as PresetName)) return;
    if (name === presetFor(this.bands)) return;
    const bands = BAND_PRESETS[name as PresetName];
    this._emit(bands ? structuredClone(bands) : undefined);
  }

  private _updateBand(index: number, key: keyof Band, value: unknown): void {
    const bands = [...(this.bands ?? [])];
    const band: Record<string, unknown> = { ...bands[index] };
    if (value === undefined || value === null || value === '') delete band[key];
    else band[key] = value;
    bands[index] = band as unknown as Band;
    this._emit(bands);
  }

  private _fromChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const n = Number(ev.detail?.value);
    if (ev.detail?.value === '' || ev.detail?.value == null || !Number.isFinite(n)) return;
    this._updateBand(index, 'from', n);
  }

  private _fromEntityChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const id = ev.detail?.value;
    // A cleared picker keeps the entity: a band needs a start, and Number mode is one click away.
    if (typeof id !== 'string' || id === '') return;
    this._updateBand(index, 'from', id);
  }

  /** Switch a band between a number start and an entity start. */
  private _toggleFromMode(index: number): void {
    const from = this.bands?.[index]?.from;
    const open = new Set(this._entityOpen);
    if (isEntityStart(from)) {
      // Back to a number: keep the start where the entity has it now.
      this._updateBand(index, 'from', this._entityValue(from) ?? 0);
    } else if (!open.delete(index)) {
      open.add(index);
    }
    this._entityOpen = open;
  }

  private _colorChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const choice = ev.detail?.value as string | undefined;
    const current = this.bands?.[index]?.color ?? 'primary';
    if (!choice) return;
    const open = new Set(this._customOpen);
    if (choice === CUSTOM) {
      // Show the field, pre-filled with the colour already shown; the config changes only
      // when something is typed.
      if (isPaletteColor(current)) this._customOpen = open.add(index);
      return;
    }
    open.delete(index);
    this._customOpen = open;
    if (choice !== current) this._updateBand(index, 'color', choice);
  }

  private _customColorChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const value = typeof ev.detail?.value === 'string' ? ev.detail.value.trim() : '';
    if (!value) return;
    const open = new Set(this._customOpen);
    open.delete(index);
    this._customOpen = open;
    this._updateBand(index, 'color', value);
  }

  private _iconChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    this._updateBand(index, 'icon', ev.detail?.value);
  }

  private _labelChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    this._updateBand(index, 'label', ev.detail?.value);
  }

  private _removeBand(index: number): void {
    const bands = [...(this.bands ?? [])];
    bands.splice(index, 1);
    this._emit(bands);
  }

  private _addBand(): void {
    const bands = [...(this.bands ?? [])];
    // YAML may hold the threshold as text ("20"); the card reads it as a number, so do the same
    // (but a blank or non-numeric value starts again at 0).
    const raw: unknown = bands[bands.length - 1]?.from;
    const last =
      typeof raw === 'number'
        ? raw
        : isEntityStart(raw)
          ? (this._entityValue(raw) ?? NaN)
          : typeof raw === 'string' && raw.trim() !== ''
            ? Number(raw)
            : NaN;
    bands.push({ from: Number.isFinite(last) ? last + 10 : 0, color: 'primary' });
    this._emit(bands);
  }

  private _renderBand(band: Band, index: number, selectors: ReturnType<CdBandsEditor['_getSelectors']>) {
    const custom = !isPaletteColor(band.color) || this._customOpen.has(index);
    const entity = isEntityStart(band.from) ? band.from : undefined;
    const entityMode = entity !== undefined || this._entityOpen.has(index);
    return html`<div class="band">
      <span class="swatch" style=${styleMap({ '--swatch': baseColor(band.color) })}></span>
      <ha-selector
        .required=${false}
        data-role="from"
        .hass=${this.hass}
        .label=${this._t('editor_band_from')}
        .selector=${selectors.from}
        .value=${entity !== undefined ? this._entityValue(entity) : band.from}
        .disabled=${entityMode}
        @value-changed=${(ev: CustomEvent) => this._fromChanged(index, ev)}
      ></ha-selector>
      <ha-selector
        .required=${true}
        data-role="color"
        .hass=${this.hass}
        .label=${this._t('editor_band_color')}
        .selector=${selectors.color}
        .value=${custom ? CUSTOM : band.color}
        @value-changed=${(ev: CustomEvent) => this._colorChanged(index, ev)}
      ></ha-selector>
      <ha-selector
        .required=${false}
        data-role="label"
        .hass=${this.hass}
        .label=${this._t('editor_band_label')}
        .selector=${TEXT_SELECTOR}
        .value=${band.label ?? ''}
        @value-changed=${(ev: CustomEvent) => this._labelChanged(index, ev)}
      ></ha-selector>
      <ha-selector
        .required=${false}
        data-role="icon"
        .hass=${this.hass}
        .label=${this._t('editor_band_icon')}
        .selector=${ICON_SELECTOR}
        .value=${band.icon ?? ''}
        @value-changed=${(ev: CustomEvent) => this._iconChanged(index, ev)}
      ></ha-selector>
      <ha-icon-button
        class="from-mode"
        .path=${entityMode ? ICON_NUMBER : ICON_ENTITY}
        .label=${this._t(entityMode ? 'editor_band_from_number' : 'editor_band_from_entity')}
        aria-pressed=${entityMode ? 'true' : 'false'}
        @click=${() => this._toggleFromMode(index)}
      ></ha-icon-button>
      <ha-icon-button
        class="remove"
        .path=${DELETE_ICON}
        .label=${this._t('editor_remove_band')}
        @click=${() => this._removeBand(index)}
      ></ha-icon-button>
      ${
        entityMode
          ? html`<ha-selector
              .required=${false}
              class="from-entity"
              data-role="from-entity"
              .hass=${this.hass}
              .label=${this._t('editor_band_from_entity_label')}
              .selector=${ENTITY_SELECTOR}
              .value=${entity ?? ''}
              @value-changed=${(ev: CustomEvent) => this._fromEntityChanged(index, ev)}
            ></ha-selector>`
          : nothing
      }
      ${
        custom
          ? html`<ha-selector
              .required=${false}
              class="custom"
              data-role="custom-color"
              .hass=${this.hass}
              .label=${this._t('editor_band_custom_color')}
              .selector=${TEXT_SELECTOR}
              .value=${isPaletteColor(band.color) ? baseColor(band.color) : band.color}
              @value-changed=${(ev: CustomEvent) => this._customColorChanged(index, ev)}
            ></ha-selector>`
          : nothing
      }
    </div>`;
  }

  render() {
    const selectors = this._getSelectors();
    const preset = presetFor(this.bands);
    return html`<ha-selector
        .required=${true}
        data-role="preset"
        .hass=${this.hass}
        .label=${this._t('editor_preset')}
        .selector=${preset === CUSTOM ? selectors.presetCustom : selectors.preset}
        .value=${preset}
        @value-changed=${this._presetChanged}
      ></ha-selector>
      ${(this.bands ?? []).map((band, i) => this._renderBand(band, i, selectors))}
      <button type="button" class="add-band" @click=${this._addBand}>${this._t('editor_add_band')}</button>`;
  }
}

if (!customElements.get('cd-bands-editor')) {
  customElements.define('cd-bands-editor', CdBandsEditor);
}
