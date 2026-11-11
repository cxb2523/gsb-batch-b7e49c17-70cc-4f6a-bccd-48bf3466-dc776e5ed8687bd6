import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';
import { findNode } from './hierarchy';
import type { TreeNode } from './hierarchy';

/**
 * Drilling down: tapping a group in a hierarchy chart (a treemap box, a sunburst ring, an icicle
 * cell) redraws the chart with that group as the whole, and a back button returns to the level
 * above. Where each card is stays with the card element, so a redraw or a new state keeps it.
 */
const paths = new WeakMap<HTMLElement, string[]>();

/** Whether the card lets groups be tapped into (`drill_down`, on unless set to false). */
export function drillEnabled(raw: CardConfig): boolean {
  return raw.drill_down !== false;
}

/** Checks for `drill_down`. */
export function validateDrill(raw: CardConfig): void {
  if (raw.drill_down !== undefined && typeof raw.drill_down !== 'boolean') {
    throw new Error('"drill_down" must be true or false');
  }
}

/**
 * The group the card is showing and the path to it. A path that no longer leads anywhere (the
 * group emptied, or the grouping changed) stops at the deepest group that still exists.
 */
export function drilledRoot(tree: TreeNode, path: string[]): { node: TreeNode; path: string[] } {
  let node = tree;
  const kept: string[] = [];
  for (const name of path) {
    const next = findNode(node, [name]);
    if (!next || next.value <= 0) break;
    node = next;
    kept.push(name);
  }
  return { node, path: kept };
}

/** The card's current drill path (empty: the whole). */
export function drillPath(host: HTMLElement): string[] {
  return paths.get(host) ?? [];
}

/** Show the group at `path` (empty: the whole) and redraw. */
export function drillTo(ctx: ChartContext, path: string[]): void {
  paths.set(ctx.host, path);
  ctx.requestUpdate();
}

/** What a card draws: the group it is drilled into, or the whole tree when drilling is off. */
export function drillView(ctx: ChartContext, tree: TreeNode): { node: TreeNode; path: string[] } {
  if (!drillEnabled(ctx.raw)) return { node: tree, path: [] };
  return drilledRoot(tree, drillPath(ctx.host));
}

/**
 * Attributes and handlers that make a group tappable: a click or Enter/Space drills into it.
 * Undefined when drilling is off, so the group stays a plain shape.
 */
export function drillTarget(ctx: ChartContext, node: TreeNode, label: string) {
  if (!drillEnabled(ctx.raw) || node.entity || node.value <= 0) return undefined;
  const go = () => drillTo(ctx, node.path);
  return {
    label: localize(ctx.hass, 'drill_into', { label }),
    click: (ev: Event) => {
      ev.stopPropagation();
      go();
    },
    keydown: (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      go();
    },
  };
}

/**
 * The row above a drilled-in chart: a back button named after the level above, and the group
 * being shown with its total. Nothing at the top level.
 */
export function drillBar(
  ctx: ChartContext,
  tree: TreeNode,
  view: { node: TreeNode; path: string[] },
  total: string,
): TemplateResult | typeof nothing {
  if (!view.path.length) return nothing;
  const up = view.path.slice(0, -1);
  const parent = (up.length && findNode(tree, up)?.name) || localize(ctx.hass, 'drill_top');
  return html`<div class="drill-bar">
    <button
      type="button"
      class="drill-back"
      aria-label=${localize(ctx.hass, 'drill_back', { name: parent })}
      @click=${() => drillTo(ctx, up)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" fill="currentColor"></path>
      </svg>
      <span>${parent}</span>
    </button>
    <div class="drill-current">
      <span class="drill-name">${view.node.name}</span>
      ${total ? html`<span class="drill-total">${total}</span>` : nothing}
    </div>
  </div>`;
}

/** Look of the back row and of tappable groups, shared by every chart that drills. */
export const drillStyles = css`
  .drill-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    min-width: 0;
  }
  .drill-back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 55%;
    padding: 4px 12px 4px 6px;
    border: none;
    border-radius: 16px;
    background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
    color: var(--primary-color, #03a9f4);
    font: inherit;
    font-size: 0.875em;
    font-weight: 500;
    cursor: pointer;
  }
  .drill-back span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drill-back:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  .drill-current {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 0;
    line-height: 1.2;
  }
  .drill-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .drill-total {
    color: var(--secondary-text-color);
    font-size: 0.875em;
  }
  .drillable {
    cursor: pointer;
    outline: none;
  }
`;
