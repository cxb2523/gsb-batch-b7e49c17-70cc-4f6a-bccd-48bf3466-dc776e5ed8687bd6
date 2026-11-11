import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { FieldBinding } from '../editor/schemas';
import { energyValueText } from '../history/energy';
import type { Grouping } from '../history/group';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';
import type { ChartSeries } from './frame';

/*
 * Legend toggles: with `legend_toggle: true`, tapping a name in a history chart's header hides or
 * shows that series, and holding it (or shift-clicking) shows only that one. The chart then draws
 * from the series still shown, so the value axis refits to them. The hidden set is kept on the
 * card and in the browser's localStorage under a key made from the card's config, so a dashboard
 * comes back the way it was left; a changed config starts with everything shown again.
 */

/** How long a press must last to count as a hold (as for the card's own hold action). */
export const LEGEND_HOLD_MS = 500;
const STORAGE_PREFIX = 'chartdeck-legend-';

export const LEGEND_TOGGLE_FIELDS: FieldBinding[] = [
  { name: 'legend_toggle', path: ['legend_toggle'], default: false },
];
export const LEGEND_TOGGLE_SCHEMA = [{ name: 'legend_toggle', selector: { boolean: {} } }];

export function validateLegendToggle(raw: CardConfig): void {
  if (raw.legend_toggle !== undefined && typeof raw.legend_toggle !== 'boolean') {
    throw new Error('"legend_toggle" must be true or false');
  }
}

/** What a chart's header carries when its names toggle series: every series, and those that can't be hidden. */
export interface LegendItems {
  all: ChartSeries[];
  /** Series indexes always drawn (the candlestick's own entity): their names open the entity instead. */
  locked: ReadonlySet<number>;
}

/**
 * Toggling is on, and its header can be reached: the header is drawn (not hidden, not split into
 * small multiples, and showing a name or a value). Otherwise nothing is hidden, so a series can
 * never be left out with no way to bring it back.
 */
export function legendToggleActive(ctx: Pick<ChartContext, 'raw' | 'config'>): boolean {
  const { raw } = ctx;
  if (raw.legend_toggle !== true || raw.header === 'hidden' || raw.multiples === true) return false;
  return ctx.config.show.name || ctx.config.show.value;
}

/** One series' name in the hidden set: its entity, and the attribute when it plots one. */
export function seriesKey(entity: Pick<ResolvedEntity, 'entityId' | 'config'>): string {
  const attribute = entity.config.attribute;
  return attribute ? `${entity.entityId}|${attribute}` : entity.entityId;
}

/** A short, stable fingerprint of the card's config (FNV-1a), naming its stored hidden set. */
export function configHash(raw: unknown): string {
  const text = JSON.stringify(raw) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** `key` hidden if it was shown, shown if it was hidden. */
export function toggled(hidden: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(hidden);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Only `key` shown, every other series hidden. Asked again when that is already so, everything
 * comes back.
 */
export function isolated(hidden: ReadonlySet<string>, keys: string[], key: string): Set<string> {
  const others = keys.filter((k) => k !== key);
  const alone = !hidden.has(key) && others.every((k) => hidden.has(k));
  return alone ? new Set() : new Set(others);
}

interface CardLegend {
  storageKey: string;
  hidden: Set<string>;
  /** A press in progress on a name: its hold timer, and whether it already fired. */
  timer?: ReturnType<typeof setTimeout>;
  held: boolean;
}

const cards = new WeakMap<HTMLElement, CardLegend>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function load(storageKey: string): Set<string> {
  try {
    const stored = JSON.parse(storage()?.getItem(storageKey) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function save(state: CardLegend): void {
  try {
    const store = storage();
    if (!store) return;
    if (state.hidden.size === 0) store.removeItem(state.storageKey);
    else store.setItem(state.storageKey, JSON.stringify([...state.hidden]));
  } catch {
    // Private windows and full storage: the set still holds on the card until the page reloads.
  }
}

function stateFor(ctx: Pick<ChartContext, 'raw' | 'host'>): CardLegend {
  const storageKey = STORAGE_PREFIX + configHash(ctx.raw);
  let state = cards.get(ctx.host);
  if (!state || state.storageKey !== storageKey) {
    state = { storageKey, hidden: load(storageKey), held: false };
    cards.set(ctx.host, state);
  }
  return state;
}

/** The series this card has hidden (keys from `seriesKey`). */
export function hiddenSeries(ctx: Pick<ChartContext, 'raw' | 'host'>): ReadonlySet<string> {
  return stateFor(ctx).hidden;
}

/**
 * The frame with hidden series left out of `series` (and so out of the drawing, the axis, the
 * tooltip) and every series kept in `legend` for the header. `locked` series are always drawn.
 * Each series keeps its `index` and colour, so nothing else shifts when one is hidden.
 */
export function withLegend<F extends { series: ChartSeries[] }>(
  frame: F,
  ctx: ChartContext,
  locked: (s: ChartSeries) => boolean = () => false,
): F & { legend?: LegendItems } {
  if (!legendToggleActive(ctx)) return frame;
  const hidden = hiddenSeries(ctx);
  const lockedSet = new Set(frame.series.filter(locked).map((s) => s.index));
  return {
    ...frame,
    legend: { all: frame.series, locked: lockedSet },
    series: frame.series.filter((s) => lockedSet.has(s.index) || !hidden.has(seriesKey(s.entity))),
  };
}

function update(ctx: ChartContext, next: Set<string>): void {
  const state = stateFor(ctx);
  state.hidden = next;
  save(state);
  ctx.requestUpdate();
}

/** The header's names as toggles: tap hides or shows, hold (or shift-click) shows only that one. */
export function legendToggleHeader(legend: LegendItems, ctx: ChartContext, group?: Grouping): TemplateResult {
  const { show } = ctx.config;
  const state = stateFor(ctx);
  const keys = legend.all.filter((s) => !legend.locked.has(s.index)).map((s) => seriesKey(s.entity));
  const clear = () => {
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
  };
  const isolate = (key: string) => update(ctx, isolated(stateFor(ctx).hidden, keys, key));
  const hint = localize(ctx.hass, 'legend_toggle_hint');
  return html`<div class="series-header legend-toggles">
    ${legend.all.map((s) => {
      // As in the plain header: an Energy dashboard series reads its total over the span.
      const value = energyValueText(s.entity, s.points, group, ctx.hass) ?? s.entity.display;
      const body = html`<span class="swatch" style="background:${s.color}"></span>
        ${show.name ? html`<span class="series-name">${s.entity.name}</span>` : nothing}
        ${show.value && value ? html`<span class="series-value">${value}</span>` : nothing}`;
      if (legend.locked.has(s.index)) {
        return html`<div class="entity series-item" data-index=${s.index} tabindex="0" aria-label=${s.entity.label}>
          ${body}
        </div>`;
      }
      const key = seriesKey(s.entity);
      const off = state.hidden.has(key);
      return html`<button
        class="series-item series-toggle ${off ? 'off' : ''}"
        type="button"
        data-series=${s.index}
        aria-pressed=${off ? 'false' : 'true'}
        aria-label=${s.entity.label}
        title=${hint}
        @pointerdown=${(ev: PointerEvent) => {
          if (ev.button > 0) return;
          clear();
          state.held = false;
          state.timer = setTimeout(() => {
            state.timer = undefined;
            state.held = true;
            isolate(key);
          }, LEGEND_HOLD_MS);
        }}
        @pointerleave=${clear}
        @pointercancel=${clear}
        @contextmenu=${(ev: Event) => ev.preventDefault()}
        @click=${(ev: MouseEvent) => {
          ev.stopPropagation();
          clear();
          if (state.held) {
            state.held = false;
            return;
          }
          if (ev.shiftKey) isolate(key);
          else update(ctx, toggled(stateFor(ctx).hidden, key));
        }}
      >
        ${body}
      </button>`;
    })}
  </div>`;
}

/** Shown in place of the plot while every series is hidden. */
export function allHiddenMessage(ctx: ChartContext): TemplateResult {
  return html`<div class="chart-message">${localize(ctx.hass, 'legend_toggle_all_hidden')}</div>`;
}

export const legendToggleStyles = css`
  .series-toggle {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 2px 6px;
    margin: -2px -6px;
    border-radius: 12px;
    text-align: start;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .series-toggle:hover {
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
  .series-toggle.off .swatch {
    opacity: 0.35;
  }
  .series-toggle.off .series-name,
  .series-toggle.off .series-value {
    opacity: 0.6;
    text-decoration: line-through;
  }
`;
