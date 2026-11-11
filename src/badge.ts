import { LitElement, css, html, nothing, svg } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { attachActions, isInteractive } from './actions';
import { baseColor } from './bands';
import { downsample } from './chart/downsample';
import { runPath, runs } from './chart/paths';
import type { XY } from './chart/paths';
import { extent, linear, padDomain } from './chart/scale';
import { normalizeConfig } from './config';
import './editor/badge-editor';
import { key } from './history/fetch';
import { pauseStore, storeFor } from './history/store';
import type { Point } from './history/types';
import { LanguageController } from './language-controller';
import { iconOverride, resolveEntities, watchedEntityIds } from './resolve';
import type { ResolvedEntity } from './resolve';
import type { CardConfig, EntityConfig, HomeAssistant, NormalizedConfig } from './types';

/*
 * A Chartdeck badge for the Sections view's badge row (Home Assistant 2024.8 and later):
 * `type: custom:chartdeck-badge`, one entity, drawn as a pill like Home Assistant's own badges.
 * It reads the same options as the card (min, max, severity bands, unit, decimals, name,
 * attribute, actions) through the card's own config code, so a band or limit means the same in
 * both. Four looks:
 *
 * - value: the value and name beside the entity's icon, tinted with the band colour.
 * - sparkline: a small line of the last `hours` (24) of history, then the value.
 * - ring: a small ring filled to the value's place between min and max.
 * - thin: a short bar filled the same way.
 */

export const BADGE_STYLES = ['value', 'sparkline', 'ring', 'thin'] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];

export interface BadgeConfig extends Partial<EntityConfig> {
  type: string;
  entity?: string;
  style?: BadgeStyle;
  /** A colour for the badge when it has no severity bands (palette name or CSS colour). */
  color?: string;
  show_name?: boolean;
  show_icon?: boolean;
  /** Sparkline: hours of history drawn (default 24, at most a week). */
  hours?: number;
}

const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;
const HOUR = 3_600_000;
/** The sparkline's drawing box (px). */
const SPARK_W = 44;
const SPARK_H = 20;
/** Points kept in a sparkline: it is only 44 px wide. */
const SPARK_POINTS = 60;

/** Check a badge config and turn it into the card's normalised form (one entity). Throws a readable Error. */
export function normalizeBadge(raw: BadgeConfig): { config: NormalizedConfig; style: BadgeStyle; hours: number } {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid configuration');
  if (typeof raw.entity !== 'string' || !raw.entity) throw new Error('"entity" is required');
  const style = raw.style ?? 'value';
  if (!BADGE_STYLES.includes(style)) throw new Error(`"style" must be one of: ${BADGE_STYLES.join(', ')}`);
  const hours = raw.hours ?? DEFAULT_HOURS;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
    throw new Error(`"hours" must be a number of hours from 1 to ${MAX_HOURS}`);
  }
  for (const k of ['show_name', 'show_icon'] as const) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  if (raw.color !== undefined && typeof raw.color !== 'string') throw new Error('"color" must be a colour');
  // The card's own checks and merging: the badge is a card of one entity with the badge's options.
  const { type: _type, entity, attribute, style: _style, hours: _hours, show_name, show_icon, ...rest } = raw;
  void _type;
  void _style;
  void _hours;
  const card: CardConfig = {
    ...rest,
    type: 'custom:chartdeck-card',
    entities: [attribute ? { entity, attribute } : entity],
    show: { name: show_name !== false, icon: show_icon !== false, value: true, target: false, legend: false },
  };
  return { config: normalizeConfig(card), style, hours };
}

/** The badge's colour: its band's when it has bands, else its own `color`, else the theme's primary. */
export function badgeColor(e: ResolvedEntity, raw: BadgeConfig): string {
  if (Array.isArray(raw.severity) && raw.severity.length) return baseColor(e.band.color);
  return baseColor(raw.color ?? 'primary');
}

/** The sparkline's path(s) in a w × h box, one per unbroken run; '' with nothing to draw. */
export function sparkPath(points: Point[], range: { start: number; end: number }, w = SPARK_W, h = SPARK_H): string {
  const thin = downsample(points, SPARK_POINTS);
  const domain = extent([thin]);
  if (!domain || range.end <= range.start) return '';
  const x = linear([range.start, range.end], [1, w - 1]);
  const y = linear(padDomain(domain, 0.1), [h - 2, 2]);
  return runs(thin)
    .map((run) =>
      runPath(
        run.map((p): XY => [x(p.t), y(p.v as number)]),
        'smooth',
      ),
    )
    .join(' ');
}

export class ChartdeckBadge extends LitElement {
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    _raw: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _raw?: BadgeConfig;
  private _config?: NormalizedConfig;
  private _style: BadgeStyle = 'value';
  private _hours = DEFAULT_HOURS;
  private _watched = new Set<string>();
  private _item?: ResolvedEntity;
  private _detach?: () => void;

  static getConfigElement(): HTMLElement {
    return document.createElement('chartdeck-badge-editor');
  }

  /** A numeric sensor, batteries first (they read well as a badge), as the card's stub does. */
  static getStubConfig(hass: HomeAssistant): BadgeConfig {
    const numeric = Object.values(hass?.states ?? {}).filter(
      (s) => s.entity_id.startsWith('sensor.') && s.state.trim() !== '' && Number.isFinite(Number(s.state)),
    );
    numeric.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    const battery = numeric.find((s) => s.attributes?.device_class === 'battery');
    const entity = (battery ?? numeric[0])?.entity_id ?? 'sensor.example';
    return { type: 'custom:chartdeck-badge', entity, style: 'ring' };
  }

  setConfig(raw: BadgeConfig): void {
    const { config, style, hours } = normalizeBadge(raw);
    this._config = config;
    this._style = style;
    this._hours = hours;
    this._watched = watchedEntityIds(config);
    this._raw = raw;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size === 0 || !changed.has('hass') || changed.size > 1) return true;
    const prev = changed.get('hass') as HomeAssistant | undefined;
    const next = this.hass;
    if (!prev || !next) return true;
    for (const id of this._watched) if (prev.states[id] !== next.states[id]) return true;
    return prev.themes?.darkMode !== next.themes?.darkMode || prev.locale !== next.locale;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.requestUpdate();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    pauseStore(this);
    this._detach?.();
    this._detach = undefined;
  }

  protected updated(): void {
    const el = this.shadowRoot?.querySelector<HTMLElement>('.badge');
    if (el && !this._detach) this._detach = attachActions(el, () => this._item!.config);
  }

  private _spark(e: ResolvedEntity, color: string): TemplateResult {
    const now = Date.now();
    const range = { start: now - this._hours * HOUR, end: now };
    const request = { entity: e.entityId, attribute: e.config.attribute };
    const loaded = storeFor(this, () => this.requestUpdate()).get(this.hass!, [request], range, 'history');
    let points = loaded.data.get(key(request)) ?? [];
    // A sensor holds its last reading until it changes: carry it on to now.
    const last = points[points.length - 1];
    if (last && last.v !== null && last.t < now) points = [...points, { t: now, v: last.v }];
    const d = sparkPath(points, range);
    return html`<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">
      ${d ? svg`<path d=${d} stroke=${color}></path>` : svg`<line class="spark-empty" x1="2" x2=${SPARK_W - 2} y1=${SPARK_H / 2} y2=${SPARK_H / 2}></line>`}
    </svg>`;
  }

  private _visual(e: ResolvedEntity, color: string): TemplateResult | typeof nothing {
    const fill = e.available ? e.position : 0;
    switch (this._style) {
      case 'sparkline':
        return this._spark(e, color);
      case 'ring': {
        // pathLength 100 from 12 o'clock, clockwise.
        return html`<svg class="ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="track" cx="12" cy="12" r="9.5"></circle>
          ${
            fill > 0
              ? svg`<circle class="fill" cx="12" cy="12" r="9.5" pathLength="100" stroke=${color}
                  style="stroke-dasharray: ${Math.round(fill * 1000) / 10} 100"></circle>`
              : nothing
          }
        </svg>`;
      }
      case 'thin':
        return html`<div class="thin" aria-hidden="true">
          <div class="thin-fill" style="width: ${Math.round(fill * 1000) / 10}%; background: ${color}"></div>
        </div>`;
      default:
        return html`<div class="icon-wrap" style="--badge-color: ${color}" aria-hidden="true">
          ${
            this._config!.show.icon
              ? html`<ha-state-icon
                  class="icon"
                  .hass=${this.hass}
                  .stateObj=${e.stateObj}
                  .icon=${iconOverride(e)}
                ></ha-state-icon>`
              : html`<span class="dot"></span>`
          }
        </div>`;
    }
  }

  render() {
    const config = this._config;
    const hass = this.hass;
    if (!config || !hass || !this._raw) return nothing;
    const e = resolveEntities(config, hass)[0];
    this._item = e;
    const color = e.available ? badgeColor(e, this._raw) : 'var(--disabled-text-color, var(--secondary-text-color))';
    const interactive = isInteractive(e.config);
    return html`<div
      class="badge style-${this._style} ${interactive ? 'interactive' : ''} ${e.available ? '' : 'unavailable'}"
      role=${interactive ? 'button' : 'img'}
      tabindex=${interactive ? 0 : nothing}
      aria-label=${e.label}
      title=${e.label}
    >
      ${this._visual(e, color)}
      <div class="info">
        <span class="value">${e.display}</span>
        ${config.show.name ? html`<span class="name">${e.name}</span>` : nothing}
      </div>
    </div>`;
  }

  static styles = css`
    :host {
      display: inline-block;
      --cd-badge-track: color-mix(in srgb, var(--primary-text-color, #212121) 12%, transparent);
    }
    @supports not (color: color-mix(in srgb, red 50%, white)) {
      :host {
        --cd-badge-track: var(--divider-color, rgba(127, 127, 127, 0.2));
      }
    }
    /* The look of Home Assistant's own badges: a 36 px pill on the card background. */
    .badge {
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      height: var(--ha-badge-size, 36px);
      min-width: var(--ha-badge-size, 36px);
      padding: 0 12px 0 6px;
      border-radius: var(--ha-badge-border-radius, 18px);
      background: var(--ha-card-background, var(--card-background-color, #fff));
      border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
      box-shadow: var(--ha-card-box-shadow, none);
      color: var(--primary-text-color);
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .badge.style-sparkline,
    .badge.style-thin {
      padding-left: 10px;
    }
    .badge.interactive {
      cursor: pointer;
    }
    .badge:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }
    .info {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      line-height: 1.2;
    }
    .value {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
    .name {
      font-size: 10px;
      color: var(--secondary-text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }
    .unavailable .value {
      color: var(--secondary-text-color);
      font-weight: 400;
    }
    .icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--badge-color) 20%, transparent);
      color: var(--badge-color);
    }
    .icon {
      --mdc-icon-size: 16px;
      display: flex;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--badge-color);
    }
    .ring {
      flex: none;
      width: 24px;
      height: 24px;
      transform: rotate(-90deg);
    }
    .ring circle {
      fill: none;
      stroke-width: 3px;
    }
    .ring .track {
      stroke: var(--cd-badge-track);
    }
    .ring .fill {
      stroke-linecap: round;
    }
    .thin {
      flex: none;
      width: 32px;
      height: 4px;
      border-radius: 2px;
      overflow: hidden;
      background: var(--cd-badge-track);
    }
    .thin-fill {
      height: 100%;
      border-radius: 2px;
    }
    .spark {
      flex: none;
      width: 44px;
      height: 20px;
      overflow: visible;
    }
    .spark path {
      fill: none;
      stroke-width: 1.5px;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .spark-empty {
      stroke: var(--cd-badge-track);
      stroke-width: 1.5px;
      stroke-dasharray: 2 3;
    }
  `;
}

if (!customElements.get('chartdeck-badge')) {
  customElements.define('chartdeck-badge', ChartdeckBadge);
}

interface CustomBadgeEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}
const badges = ((window as unknown as { customBadges?: CustomBadgeEntry[] }).customBadges ??= []);
if (!badges.some((b) => b.type === 'chartdeck-badge')) {
  badges.push({
    type: 'chartdeck-badge',
    name: 'Chartdeck badge',
    description: 'A value, sparkline, ring or thin bar in the badge row, with the card’s colour bands.',
    preview: true,
    documentationURL: 'https://tempus2016.github.io/chartdeck/',
  });
}
