import { afterEach, describe, expect, it } from 'vitest';
import { makeHass } from './helpers/hass';
import type { Band } from '../src/types';

for (const tag of ['ha-selector', 'ha-icon-button']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
}
await import('../src/editor/bands-editor');

type BandsEditor = HTMLElement & { hass?: unknown; bands?: Band[]; updateComplete: Promise<boolean> };

async function addTo(bands: Band[]) {
  const el = document.createElement('cd-bands-editor') as BandsEditor;
  el.hass = makeHass({});
  el.bands = bands;
  const events: Band[][] = [];
  el.addEventListener('value-changed', (e) => events.push((e as CustomEvent).detail.value));
  document.body.appendChild(el);
  await el.updateComplete;
  (el.shadowRoot!.querySelector('.add-band') as HTMLElement).click();
  return events.at(-1)!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('adding a band', () => {
  it('continues 10 above the last threshold, also when YAML gave it as text', async () => {
    expect((await addTo([{ from: 20, color: 'red' }])).at(-1)!.from).toBe(30);
    expect((await addTo([{ from: '20' as unknown as number, color: 'red' }])).at(-1)!.from).toBe(30);
    expect((await addTo([])).at(-1)!.from).toBe(0);
    expect((await addTo([{ from: 'low' as unknown as number, color: 'red' }])).at(-1)!.from).toBe(0);
    expect((await addTo([{ from: ' 20 ' as unknown as number, color: 'red' }])).at(-1)!.from).toBe(30);
    for (const blank of ['', ' ', null, true]) {
      expect((await addTo([{ from: blank as unknown as number, color: 'red' }])).at(-1)!.from, String(blank)).toBe(0);
    }
  });
});
