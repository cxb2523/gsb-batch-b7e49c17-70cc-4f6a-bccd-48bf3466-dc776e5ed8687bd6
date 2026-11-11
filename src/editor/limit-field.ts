import { LitElement, css, html, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { localize } from '../localize';
import type { HomeAssistant, Limit } from '../types';
import { LanguageController } from '../language-controller';

export type LimitMode = 'default' | 'number' | 'entity';

const NUMBER_SELECTOR = { number: { mode: 'box', step: 'any' } };
const ENTITY_SELECTOR = { entity: { domain: ['sensor', 'input_number', 'number'] } };

/** How a stored limit is edited: absent, a number (or numeric string), or an entity id. */
export function limitMode(value: Limit | undefined): LimitMode {
  if (value === undefined || value === null || value === '') return 'default';
  if (typeof value === 'number') return 'number';
  return value.trim() !== '' && Number.isFinite(Number(value)) ? 'number' : 'entity';
}

/** A min / max / target picker: the card's default, a fixed number, or an entity's state. */
export class CdLimitField extends LitElement {
  // Draws again once the user's language arrives.
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    label: { attribute: false },
    value: { attribute: false },
    defaultLabel: { attribute: false },
    _mode: { state: true },
  };

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 8px;
      align-items: start;
    }
  `;

  declare hass?: HomeAssistant;
  declare label?: string;
  declare value?: Limit;
  declare defaultLabel?: string;
  /** The mode the user picked before entering a value; cleared once the value implies a mode. */
  declare _mode?: LimitMode;

  private _modeSelector?: { key: string; selector: unknown };

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('value') && limitMode(this.value) !== 'default') this._mode = undefined;
  }

  /** The mode dropdown's selector, rebuilt only when its labels change. */
  private _modeSelectorFor(): unknown {
    const t = (key: string, vars?: Record<string, string>) => localize(this.hass, key, vars);
    const options = [
      { value: 'default', label: t('editor_limit_default', { value: this.defaultLabel ?? '' }) },
      { value: 'number', label: t('editor_limit_number') },
      { value: 'entity', label: t('editor_limit_entity') },
    ];
    const key = options.map((o) => o.label).join('|');
    if (this._modeSelector?.key !== key) {
      this._modeSelector = { key, selector: { select: { mode: 'dropdown', options } } };
    }
    return this._modeSelector.selector;
  }

  private get _currentMode(): LimitMode {
    return this._mode ?? limitMode(this.value);
  }

  private _emit(value: Limit | undefined): void {
    this.dispatchEvent(new CustomEvent('value-changed', { detail: { value } }));
  }

  private _modeChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const mode = ev.detail?.value as LimitMode | undefined;
    if (!mode || mode === this._currentMode) return;
    this._mode = mode;
    if (this.value !== undefined) this._emit(undefined);
  }

  private _numberChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const raw = ev.detail?.value;
    const n = typeof raw === 'number' ? raw : raw === '' || raw == null ? NaN : Number(raw);
    // Clearing the box removes the key; stay in Number mode so the box doesn't vanish mid-edit.
    this._mode = 'number';
    this._emit(Number.isFinite(n) ? n : undefined);
  }

  private _entityChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const id = ev.detail?.value;
    this._mode = 'entity';
    this._emit(typeof id === 'string' && id !== '' ? id : undefined);
  }

  render() {
    const t = (key: string) => localize(this.hass, key);
    const mode = this._currentMode;
    return html`<ha-selector
        .required=${true}
        data-role="mode"
        .hass=${this.hass}
        .label=${this.label}
        .selector=${this._modeSelectorFor()}
        .value=${mode}
        @value-changed=${this._modeChanged}
      ></ha-selector>
      ${
        mode === 'number'
          ? html`<ha-selector
              .required=${false}
              data-role="number"
              .hass=${this.hass}
              .label=${t('editor_limit_number')}
              .selector=${NUMBER_SELECTOR}
              .value=${this.value === undefined ? undefined : Number(this.value)}
              @value-changed=${this._numberChanged}
            ></ha-selector>`
          : mode === 'entity'
            ? html`<ha-selector
                .required=${false}
                data-role="entity"
                .hass=${this.hass}
                .label=${t('editor_limit_entity')}
                .selector=${ENTITY_SELECTOR}
                .value=${this.value}
                @value-changed=${this._entityChanged}
              ></ha-selector>`
            : nothing
      }`;
  }
}

if (!customElements.get('cd-limit-field')) {
  customElements.define('cd-limit-field', CdLimitField);
}
