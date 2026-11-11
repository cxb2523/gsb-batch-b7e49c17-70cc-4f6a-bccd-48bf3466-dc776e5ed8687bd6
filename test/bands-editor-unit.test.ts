import { afterEach, describe, expect, it } from 'vitest';
import { makeHass } from './helpers/hass';
import type { CardConfig } from '../src/types';

for (const tag of [
  'ha-form',
  'ha-expansion-panel',
  'ha-selector',
  'ha-entity-picker',
  'ha-icon-picker',
  'ha-icon-button',
  'ha-switch',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
}
await import('../src/editor/chartdeck-card-editor');

type Editor = HTMLElement & { setConfig(c: CardConfig): void; hass?: unknown; updateComplete: Promise<boolean> };
type Bands = HTMLElement & { unit?: string };

async function mount(config: Partial<CardConfig>) {
  const editor = document.createElement('chartdeck-card-editor') as Editor;
  editor.hass = makeHass({ 'sensor.a': ['42', { unit_of_measurement: '%' }] });
  editor.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
  document.body.appendChild(editor);
  for (let i = 0; i < 4; i += 1) {
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  return editor;
}

const cardBands = (editor: Editor) => editor.shadowRoot!.querySelector('.section-colours cd-bands-editor') as Bands;
async function entityBands(editor: Editor) {
  const list = editor.shadowRoot!.querySelector('cd-entities-editor')!;
  (list.shadowRoot!.querySelector('ha-icon-button.expand') as HTMLElement).click();
  await (list as unknown as { updateComplete: Promise<boolean> }).updateComplete;
  return list.shadowRoot!.querySelector('cd-bands-editor') as Bands;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('colour band thresholds show the unit the card displays', () => {
  it("per entity: the entity's override, else the card's unit, else the sensor's", async () => {
    expect((await entityBands(await mount({ entities: [{ entity: 'sensor.a', unit: 'kW' }], unit: 'W' }))).unit).toBe(
      'kW',
    );
    expect((await entityBands(await mount({ entities: ['sensor.a'], unit: 'W' }))).unit).toBe('W');
    expect((await entityBands(await mount({ entities: ['sensor.a'] }))).unit).toBe('%');
  });

  it("card-wide: the card's unit, else the first entity's sensor unit", async () => {
    expect(cardBands(await mount({ entities: ['sensor.a'], unit: 'W' })).unit).toBe('W');
    expect(cardBands(await mount({ entities: ['sensor.a'] })).unit).toBe('%');
    // Same as the legend: the first entity's own unit override wins over its sensor's.
    expect(cardBands(await mount({ entities: [{ entity: 'sensor.a', unit: 'kW' }] })).unit).toBe('kW');
  });
});
