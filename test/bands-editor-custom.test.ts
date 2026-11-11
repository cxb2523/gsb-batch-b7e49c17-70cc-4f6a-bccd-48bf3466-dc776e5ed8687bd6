import { afterEach, describe, expect, it } from 'vitest';
import { makeHass } from './helpers/hass';
import type { Band } from '../src/types';

for (const tag of ['ha-selector', 'ha-icon-button']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
}
await import('../src/editor/bands-editor');

type BandsEditor = HTMLElement & { hass?: unknown; bands?: Band[]; updateComplete: Promise<boolean> };

async function mount(bands: Band[]) {
  const el = document.createElement('cd-bands-editor') as BandsEditor;
  el.hass = makeHass({});
  el.bands = bands;
  const events: (Band[] | undefined)[] = [];
  el.addEventListener('value-changed', (e) => events.push((e as CustomEvent).detail.value));
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, events };
}

const role = (el: BandsEditor, r: string) =>
  el.shadowRoot!.querySelector(`[data-role="${r}"]`) as (HTMLElement & { value?: unknown }) | null;
const pick = (target: HTMLElement, value: unknown) =>
  target.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('choosing a custom band colour', () => {
  it('opens the text field pre-filled without changing the config until something is typed', async () => {
    const { el, events } = await mount([{ from: 0, color: 'green' }]);
    pick(role(el, 'color')!, 'custom');
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(role(el, 'color')!.value).toBe('custom');
    expect(role(el, 'custom-color')!.value).toBe('var(--success-color, #1fae7a)');
    pick(role(el, 'custom-color')!, '#123456');
    expect(events.at(-1)).toEqual([{ from: 0, color: '#123456' }]);
  });

  it('goes back to the palette colour if a palette colour is picked again', async () => {
    const { el, events } = await mount([{ from: 0, color: 'green' }]);
    pick(role(el, 'color')!, 'custom');
    await el.updateComplete;
    pick(role(el, 'color')!, 'green');
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(role(el, 'custom-color')).toBeNull();
  });

  it('forgets an open custom field when the bands change (preset, YAML, reorder)', async () => {
    const { el } = await mount([
      { from: 0, color: 'green' },
      { from: 50, color: 'red' },
    ]);
    pick(role(el, 'color')!, 'custom');
    await el.updateComplete;
    expect(role(el, 'custom-color')).not.toBeNull();
    el.bands = [
      { from: 0, color: 'blue' },
      { from: 50, color: 'red' },
    ];
    await el.updateComplete;
    expect(role(el, 'custom-color')).toBeNull();
  });
});
