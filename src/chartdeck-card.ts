import { LitElement, html, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { attachActions, isInteractive } from './actions';
import { colorStops, legendItems } from './bands';
import { exportMenu, exportStyles, forgetPlotted, placeExport, stopExport, validateExport } from './chart/export';
import { normalizeConfig } from './config';
import { energyChecked, energyConfig } from './history/energy';
import { energyTotals } from './history/energy-totals';
import { pauseStore } from './history/store';
import './editor/chartdeck-card-editor';
import { formatNumber } from './format';
import { localize } from './localize';
import { matchedIds, resolveBands, resolveEntities, sortEntities, watchedEntityIds } from './resolve';
import type { ResolvedEntity } from './resolve';
import { STYLES, isChart } from './styles/index';
import type { StyleModule, ValueStyleModule } from './styles/index';
import { shared } from './styles/shared';
import type { CardConfig, HomeAssistant, NormalizedConfig, StyleName } from './types';
import { VERSION } from './version';
import { LanguageController } from './language-controller';
// The badge (custom:chartdeck-badge) ships in the same file and registers itself.
import './badge';

console.info(`%c CHARTDECK %c ${VERSION} `, 'color:#fff;background:#3b8bff;font-weight:700', 'color:#3b8bff');

// ha-card's header as measured on a real dashboard (24 px title, 32 px line, its own padding).
const TITLE_HEIGHT = 73;
const PADDING_HEIGHT = 16;
const LEGEND_HEIGHT = 32;
/** How long the draw-in runs (the 900 ms --cd-duration, with a little slack). */
const DRAW_IN_MS = 1000;

/** Gap between columns (px): see .layout-rows and .layout-tiles in shared.ts. */
const COLUMN_GAP = { rows: 16, tiles: 8 };

/** Content width of a typical masonry card (about 400 px, less padding), for estimating height. */
const MASONRY_CONTENT_WIDTH = 368;

/** How many of the style's columns fit a typical masonry card, since `columns` is only a maximum. */
function columnsThatFit(style: ValueStyleModule): number {
  const gap = COLUMN_GAP[style.layout];
  return Math.max(1, Math.floor((MASONRY_CONTENT_WIDTH + gap) / ((style.minColumnWidth ?? 0) + gap)));
}

/**
 * The entities grid. A set `columns` is a maximum: each column keeps the style's minimum width,
 * so a narrow card drops to fewer columns rather than crushing or overlapping them.
 */
function columnsTemplate(style: ValueStyleModule, columns: number | undefined): string {
  if (columns === undefined) return style.layout === 'rows' ? 'grid-template-columns: repeat(1, minmax(0, 1fr))' : '';
  const gaps = (columns - 1) * COLUMN_GAP[style.layout];
  const min = style.minColumnWidth ?? 0;
  return `grid-template-columns: repeat(auto-fill, minmax(max(min(${min}px, 100%), calc((100% - ${gaps}px) / ${columns} - 0.5px)), 1fr))`;
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return !!window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;
}

export class ChartdeckCard extends LitElement {
  // Draws again once the user's language arrives.
  protected readonly languageController = new LanguageController(this);

  static properties = {
    hass: { attribute: false },
    preview: { type: Boolean },
    _config: { state: true },
  };

  static styles = [shared, exportStyles, ...Object.values(STYLES).map((s) => s.styles)];

  declare hass?: HomeAssistant;
  /** Set by Home Assistant on the editor's preview card, which it rebuilds on every change. */
  declare preview?: boolean;
  declare _config?: NormalizedConfig;

  private _watched = new Set<string>();
  /** Ids the include rule matched at the last render, to notice entities arriving or leaving. */
  private _matched: string[] = [];
  /** Entities as last rendered, indexed by each `.entity` element's data-index. */
  private _items: ResolvedEntity[] = [];
  private _detachers = new Map<HTMLElement, () => void>();
  private _readyScheduled = false;
  /** performance.now() when `ready` was set, i.e. when the draw-in started. */
  private _readyAt = -Infinity;

  static getStubConfig(hass: HomeAssistant): CardConfig {
    const numeric = Object.values(hass?.states ?? {}).filter(
      (s) => s.entity_id.startsWith('sensor.') && s.state.trim() !== '' && Number.isFinite(Number(s.state)),
    );
    const isBattery = (s: (typeof numeric)[number]) => s.attributes?.device_class === 'battery';
    numeric.sort((a, b) => {
      if (isBattery(a) !== isBattery(b)) return isBattery(a) ? -1 : 1;
      return a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0;
    });
    return {
      type: 'custom:chartdeck-card',
      style: 'bar',
      entities: numeric.slice(0, 3).map((s) => s.entity_id),
    };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('chartdeck-card-editor');
  }

  setConfig(config: CardConfig): void {
    const normalized = normalizeConfig(config);
    validateExport(config);
    // What an earlier config drew is not this one's to export.
    forgetPlotted(this);
    const style = STYLES[normalized.style];
    // The Energy dashboard source is checked here, then the chart checks it as the statistics it draws.
    const checked = energyChecked(config);
    if (isChart(style)) style.validate?.(checked);
    this._watched = watchedEntityIds(normalized);
    if (isChart(style)) for (const id of style.watch?.(config) ?? []) this._watched.add(id);
    // A different chart style may hold subscriptions the new one doesn't know about.
    if (this._config && this._config.style !== normalized.style) this._disconnectStyle();
    this._config = normalized;
  }

  private get _styleName(): StyleName {
    return this._config?.style ?? 'bar';
  }

  private get _style(): StyleModule {
    return STYLES[this._styleName];
  }

  /** Legend items, formatted with the first entity's decimals and unit. */
  private _legend(first?: ResolvedEntity): { color: string; text: string }[] {
    const config = this._config;
    if (!config?.show.legend || this._count() === 0) return [];
    const decimals = first?.decimals ?? 1;
    return legendItems(
      resolveBands(config.legendBands, this.hass, first?.unit),
      (n) => formatNumber(n, decimals, this.hass),
      first?.unit ?? '',
    );
  }

  /** How many entities the card shows: as last drawn, or as listed before the first draw. */
  private _count(): number {
    return this.hasUpdated && this.hass ? this._items.length : (this._config?.entities.length ?? 0);
  }

  /** Estimated content height in px (see the sizing rules). */
  private _contentHeight(): number {
    const config = this._config;
    if (!config) return 0;
    const style = this._style;
    const chrome = (config.title ? TITLE_HEIGHT : 0) + PADDING_HEIGHT + (this._legend().length > 0 ? LEGEND_HEIGHT : 0);
    if (isChart(style)) return chrome + style.height;
    const n = this._count();
    const perRow =
      config.columns !== undefined
        ? Math.min(config.columns, columnsThatFit(style))
        : style.layout === 'rows'
          ? 1
          : Math.min(n, style.tilesPerRow ?? 3, columnsThatFit(style));
    const rows = n === 0 ? 0 : Math.ceil(n / Math.max(1, perRow));
    return chrome + rows * style.height;
  }

  getCardSize(): number {
    return Math.max(1, Math.ceil(this._contentHeight() / 50));
  }

  /**
   * Sections sizing. Rows are left to the grid ('auto'): the real height depends on the card's
   * width (title wrapping, tiles per row), which an estimate can't know, and a fixed row count
   * that is too small lets the card spill over the one below it.
   */
  getGridOptions(): { columns: number; rows: 'auto'; min_columns: number; min_rows: number } {
    const n = this._count();
    // Charts need the room: a time axis squeezed into a quarter section is unreadable.
    if (isChart(this._style))
      return { columns: 12, min_columns: 6, min_rows: 2, ...this._style.gridOptions, rows: 'auto' };
    const rows = this._style.layout === 'rows';
    const columns = rows || n <= 1 ? 6 : 12;
    // Row styles need half a section: at 3 columns the icon, cells and value can't fit.
    return { columns, rows: 'auto', min_columns: rows ? 6 : 3, min_rows: 1 };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    // A bare requestUpdate() (a chart's data arriving) always draws.
    if (changed.size === 0) return true;
    if ([...changed.keys()].some((key) => key !== 'hass')) return true;
    if (!changed.has('hass')) return false;
    const prev = changed.get('hass') as HomeAssistant | undefined;
    const next = this.hass;
    if (!prev || !next) return true;
    for (const id of this._watched) {
      if (prev.states[id] !== next.states[id]) return true;
    }
    if (this._config?.include) {
      const matched = matchedIds(this._config, next);
      if (matched.length !== this._matched.length || matched.some((id, i) => id !== this._matched[i])) return true;
      for (const id of matched) {
        if (prev.states[id] !== next.states[id]) return true;
      }
    }
    return (
      prev.themes?.darkMode !== next.themes?.darkMode ||
      prev.themes?.theme !== next.themes?.theme ||
      prev.locale !== next.locale
    );
  }

  protected willUpdate(): void {
    const isStatic = this._config?.animate === false || prefersReducedMotion();
    this.toggleAttribute('static', isStatic);
    // An editor preview is rebuilt on every edit, so a draw-in there would replay per keystroke.
    if (isStatic || this.preview) this.setAttribute('ready', '');
  }

  /**
   * One frame after the first update that drew entities (normally the first update), set `ready`
   * so the marks transition in from empty. Later updates keep it, so config changes never replay.
   */
  private _scheduleReady(): void {
    if (this._readyScheduled || this.hasAttribute('ready') || this._items.length === 0) return;
    this._readyScheduled = true;
    const markReady = () => {
      // Force a style flush first: freshly inserted elements may not have had their not-ready
      // (empty) style computed yet, and without that start value the transition has nothing to
      // animate from, so bars would appear at full value instead of growing in.
      this.shadowRoot?.querySelector('.entity')?.getBoundingClientRect();
      this.setAttribute('ready', '');
      this._readyAt = performance.now();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(markReady);
    else setTimeout(markReady, 16);
  }

  protected updated(): void {
    this._scheduleReady();
    this._syncActions();
    placeExport(this);
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasUpdated) return;
    // A chart that was moved or hidden may have missed its data arriving: draw again.
    const style = this._config ? STYLES[this._config.style] : undefined;
    if (style && isChart(style)) this.requestUpdate();
    this._syncActions();
    // Moved while drawing in (masonry re-lays out its columns just after the first render): the
    // re-inserted element has lost its running transition and would snap to the final value, so
    // start the draw-in over. Re-attached later (e.g. switching views), it stays drawn.
    if (this.hasAttribute('ready') && !this.hasAttribute('static') && performance.now() - this._readyAt < DRAW_IN_MS) {
      this.removeAttribute('ready');
      this._readyScheduled = false;
      this._scheduleReady();
    }
  }

  private _disconnectStyle(): void {
    const style = this._config ? STYLES[this._config.style] : undefined;
    if (style && isChart(style)) style.disconnect?.(this);
    // A pie or Sankey of energy totals loads statistics too (no-op for any other card).
    pauseStore(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._disconnectStyle();
    stopExport(this);
    for (const detach of this._detachers.values()) detach();
    this._detachers.clear();
  }

  /** Attach gesture handlers once per `.entity` element; config is read at event time. */
  private _syncActions(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const current = new Set(root.querySelectorAll<HTMLElement>('.entity'));
    for (const [el, detach] of this._detachers) {
      if (!current.has(el)) {
        detach();
        this._detachers.delete(el);
      }
    }
    for (const el of current) {
      if (this._detachers.has(el)) continue;
      this._detachers.set(
        el,
        attachActions(el, () => this._items[Number(el.dataset.index)].config),
      );
    }
  }

  /** A value style's data arrived: draw again. */
  private _redraw = (): void => this.requestUpdate();

  private _renderEntity(e: ResolvedEntity, index: number, style: ValueStyleModule, hass: HomeAssistant) {
    const config = this._config!;
    const interactive = isInteractive(e.config);
    const stops = colorStops(e.band.color);
    const vars =
      `--start:${e.span[0]};--end:${e.span[1]};--pos:${e.position};--target:${e.targetPosition ?? 0};` +
      `--c-start:${stops.start};--c-end:${stops.end}`;
    return html`<div
      class="entity ${interactive ? 'interactive' : ''} ${e.available ? '' : 'unavailable'} ${
        config.colorIcon && e.available ? 'icon-band' : ''
      }"
      data-index=${index}
      role="meter"
      aria-valuenow=${e.available ? String(e.value) : nothing}
      aria-valuemin=${e.min}
      aria-valuemax=${e.max}
      aria-label=${e.label}
      tabindex=${interactive ? 0 : nothing}
      style=${vars}
    >
      ${style.render(e, { show: config.show, hass, requestUpdate: this._redraw })}
    </div>`;
  }

  render() {
    if (!this._config) return nothing;
    const hass = this.hass;
    // `source: energy`: the entities come from the Energy dashboard's settings, once they load.
    const energy = energyConfig(this._config, hass, () => this.requestUpdate());
    const config = energy.config;
    const style = this._style;
    let body;
    let first: ResolvedEntity | undefined;
    // Longest value text (characters), so row styles can give every row the same value width.
    let valueCh: number | undefined;
    const resolved = hass ? resolveEntities(config, hass) : [];
    this._matched = hass ? matchedIds(config, hass) : [];
    if (energy.message) {
      this._items = [];
      body = html`<div class="hint">${energy.message}</div>`;
    } else if (config.entities.length === 0 && !config.include) {
      this._items = [];
      body = html`<div class="hint">${localize(hass, 'no_entities')}</div>`;
    } else if (!hass) {
      this._items = [];
      body = nothing;
    } else if (resolved.length === 0) {
      this._items = [];
      body = html`<div class="hint">${localize(hass, config.include ? 'no_matches' : 'none_available')}</div>`;
    } else {
      first = resolved[0];
      // Key rows by entity id (config position breaks ties for a repeated id) so a re-sort moves
      // each entity's element rather than redrawing another entity's value into it.
      const keys = new Map<ResolvedEntity, string>();
      const seen = new Set<string>();
      resolved.forEach((e, i) => {
        keys.set(e, seen.has(e.entityId) ? `${e.entityId}#${i}` : e.entityId);
        seen.add(e.entityId);
      });
      this._items = sortEntities(resolved, config.sort).slice(0, config.limit);
      // Only real values set the shared width; status text ("Unavailable") widening every row
      // would squeeze all the cells.
      const values = this._items.filter((e) => e.available).map((e) => e.display.length);
      valueCh = values.length ? Math.max(...values) : undefined;
      if (isChart(style)) {
        const ctx = {
          items: this._items,
          config,
          raw: config.cardOptions as CardConfig,
          hass,
          requestUpdate: () => this.requestUpdate(),
          host: this,
        };
        // A pie or Sankey of the Energy dashboard draws each flow's total over its period.
        const totals = energy.totals ? energyTotals(ctx) : undefined;
        if (totals?.message !== undefined) {
          body = html`<div class="chart">
            <div class="chart-message ${totals.error ? 'error' : ''}">${totals.message}</div>
          </div>`;
        } else {
          if (totals) this._items = totals.items;
          body = html`<div class="chart">${style.render({ ...ctx, items: this._items })}</div>`;
        }
      } else {
        const tiles = style.layout === 'tiles';
        const grid = columnsTemplate(style, config.columns);
        body = html`<div
          class="entities layout-${style.layout} ${tiles && config.columns !== undefined ? 'has-columns' : ''}"
          style=${grid}
        >
          ${repeat(
            this._items,
            (e) => keys.get(e),
            (e, i) => this._renderEntity(e, i, style, hass),
          )}
        </div>`;
      }
    }
    const legend = this._legend(first);
    const menu =
      isChart(style) && hass
        ? exportMenu({
            host: this,
            hass,
            raw: config.cardOptions as CardConfig,
            items: this._items,
            content: () => this.shadowRoot?.querySelector<HTMLElement>('.content') ?? null,
            requestUpdate: () => this.requestUpdate(),
          })
        : nothing;
    return html`<ha-card .header=${config.title}>
      ${menu}
      <div
        class="content style-${this._styleName}"
        style=${valueCh === undefined ? nothing : `--cd-value-ch: ${valueCh}`}
      >
        ${body}
      </div>
      ${
        legend.length
          ? html`<div class="legend">
              ${legend.map(
                (item) =>
                  html`<span class="legend-item"
                    ><span class="dot" style="background:${item.color}"></span>${item.text}</span
                  >`,
              )}
            </div>`
          : nothing
      }
    </ha-card>`;
  }
}

if (!customElements.get('chartdeck-card')) {
  customElements.define('chartdeck-card', ChartdeckCard);
}

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}
const registry = ((window as unknown as { customCards?: CustomCardEntry[] }).customCards ??= []);
if (!registry.some((card) => card.type === 'chartdeck-card')) {
  registry.push({
    type: 'chartdeck-card',
    name: 'Chartdeck',
    description: 'Bars, gauges and charts, set up entirely from the visual editor.',
    preview: true,
    documentationURL: 'https://tempus2016.github.io/chartdeck/',
  });
}
