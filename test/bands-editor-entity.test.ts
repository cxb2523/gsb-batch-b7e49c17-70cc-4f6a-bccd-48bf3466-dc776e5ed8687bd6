import { afterEach, describe, expect, it } from 'vitest';
import { makeHass } from './helpers/hass';
import type { Band } from '../src/types';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of ['ha-selector', 'ha-icon-button']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/bands-editor');

type BandsEditor = HTMLElement & { hass?: unknown; bands?: Band[]; updateComplete: Promise<boolean> };

async function mount(bands: Band[]) {
  const el = document.createElement('cd-bands-editor') as BandsEditor;
  el.hass = makeHass({ 'input_number.warn': '25', 'sensor.off': 'unavailable' });
  el.bands = bands;
  const events: Band[][] = [];
  el.addEventListener('value-changed', (e) => {
    events.push((e as CustomEvent).detail.value);
    el.bands = (e as CustomEvent).detail.value;
  });
  document.body.appendChild(el);
  await el.updateComplete;
  const q = (sel: string) => el.shadowRoot!.querySelector(sel) as Stub | null;
  return { el, events, q };
}

function pick(el: HTMLElement, value: unknown): void {
  el.dispatchEvent(new CustomEvent('value-changed', { detail: { value } }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('band start from an entity', () => {
  it('shows an entity start greyed out at its current value, with the picker below', async () => {
    const { q } = await mount([{ from: 'input_number.warn', color: 'red' }]);
    const from = q('ha-selector[data-role="from"]')!;
    expect(from.disabled).toBe(true);
    expect(from.value).toBe(25);
    expect(q('ha-selector[data-role="from-entity"]')!.value).toBe('input_number.warn');
    expect(q('ha-icon-button.from-mode')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('switching to an entity opens the picker without touching the config until one is picked', async () => {
    const { el, events, q } = await mount([{ from: 10, color: 'red' }]);
    expect(q('ha-selector[data-role="from-entity"]')).toBeNull();
    (q('ha-icon-button.from-mode') as HTMLElement).click();
    await el.updateComplete;
    expect(events).toHaveLength(0);
    expect(q('ha-selector[data-role="from"]')!.disabled).toBe(true);
    pick(q('ha-selector[data-role="from-entity"]')!, '');
    expect(events).toHaveLength(0);
    pick(q('ha-selector[data-role="from-entity"]')!, 'input_number.warn');
    expect(events.at(-1)).toEqual([{ from: 'input_number.warn', color: 'red' }]);
  });

  it('switching back before picking just closes the picker', async () => {
    const { el, events, q } = await mount([{ from: 10, color: 'red' }]);
    (q('ha-icon-button.from-mode') as HTMLElement).click();
    await el.updateComplete;
    (q('ha-icon-button.from-mode') as HTMLElement).click();
    await el.updateComplete;
    expect(events).toHaveLength(0);
    expect(q('ha-selector[data-role="from-entity"]')).toBeNull();
  });

  it("switching back to a number keeps the entity's current value, or 0 when it has none", async () => {
    const a = await mount([{ from: 'input_number.warn', color: 'red' }]);
    (a.q('ha-icon-button.from-mode') as HTMLElement).click();
    expect(a.events.at(-1)).toEqual([{ from: 25, color: 'red' }]);
    document.body.innerHTML = '';
    const b = await mount([{ from: 'sensor.off', color: 'red' }]);
    (b.q('ha-icon-button.from-mode') as HTMLElement).click();
    expect(b.events.at(-1)).toEqual([{ from: 0, color: 'red' }]);
  });

  it("adds the next band 10 above an entity start's current value", async () => {
    const { events, q } = await mount([{ from: 'input_number.warn', color: 'red' }]);
    (q('.add-band') as HTMLElement).click();
    expect(events.at(-1)!.at(-1)!.from).toBe(35);
  });
});
