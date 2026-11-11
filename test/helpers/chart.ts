import { vi } from 'vitest';
import type { CardConfig, HomeAssistant } from '../../src/types';
import { makeHass } from './hass';

/** Helpers for history chart tests: a card with canned history, queries and pointer events. */

export type Card = HTMLElement & {
  setConfig(c: CardConfig): void;
  hass?: HomeAssistant;
  updateComplete: Promise<boolean>;
};

export type Editor = HTMLElement & {
  setConfig(c: CardConfig): void;
  hass?: unknown;
  updateComplete: Promise<boolean>;
};

export class Stub extends HTMLElement {
  [key: string]: unknown;
}

/** Stand-ins for Home Assistant's form elements, so the editor renders in jsdom. */
export function stubEditorElements(): void {
  for (const tag of [
    'ha-form',
    'ha-expansion-panel',
    'ha-selector',
    'ha-entity-picker',
    'ha-icon-picker',
    'ha-icon-button',
    'ha-switch',
  ]) {
    if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
  }
}

export const H = 3_600_000;

/** Seconds since the epoch, `msAgo` before `now`. */
export const ago = (now: number, msAgo: number) => (now - msAgo) / 1000;

/**
 * A hass whose recorder answers every history call with `history` and every statistics call
 * with `statistics`, recording what it was asked.
 */
export function chartHass(
  states: Parameters<typeof makeHass>[0],
  history: Record<string, { s: string; lu: number }[]>,
  statistics: Record<string, Record<string, unknown>[]> = {},
  fail = false,
) {
  const hass = makeHass(states);
  hass.callWS = vi.fn(async (msg: { type: string }) => {
    if (fail) throw new Error('boom');
    return msg.type === 'recorder/statistics_during_period' ? statistics : history;
  }) as HomeAssistant['callWS'];
  return hass;
}

export async function mountCard(config: Partial<CardConfig>, hass: HomeAssistant): Promise<Card> {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

export const q = (card: Element, sel: string) => card.shadowRoot!.querySelector(sel);
export const qa = (card: Element, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

/** A pointer event at `frac` of the way across a 1000 px plot. */
export function pointAt(el: Element, type: string, frac: number, pointerType = 'mouse') {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: frac * 1000 });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
}

/** The text of every tooltip row, spaces tidied. */
export const tooltipRows = (card: Card) =>
  qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());

/** Mount the card editor on `raw` and return it with the config-changed events it fires. */
export async function mountEditor(raw: CardConfig, hass: unknown) {
  stubEditorElements();
  await import('../../src/editor/chartdeck-card-editor');
  const ed = document.createElement('chartdeck-card-editor') as Editor;
  const events: CardConfig[] = [];
  ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
  ed.hass = hass;
  ed.setConfig(raw);
  document.body.appendChild(ed);
  await ed.updateComplete;
  const form = () => ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
  const change = (patch: Record<string, unknown>) =>
    form().dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form().data as object), ...patch } } }),
    );
  const entityFields = () => {
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    return list.chartFields as { schema: unknown[]; fields: { name: string; path: string[] }[] };
  };
  return { ed, events, form, change, entityFields };
}
