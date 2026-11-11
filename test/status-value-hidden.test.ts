import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import type { ChartdeckCard } from '../src/chartdeck-card';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as ChartdeckCard;
  card.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
  card.hass = makeHass({ 'sensor.a': ['42', { unit_of_measurement: '%' }], 'sensor.b': 'unavailable' });
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('status with "Show value" off', () => {
  for (const style of ['bar', 'thin', 'tank'] as const) {
    it(`${style} still says when a sensor is unavailable or missing`, async () => {
      const card = await mount({ style, entities: ['sensor.a', 'sensor.b', 'sensor.missing'], show: { value: false } });
      const rows = [...card.shadowRoot!.querySelectorAll('.entity')];
      const text = (r: Element) => r.querySelector('.value')?.textContent?.trim() ?? null;
      expect(rows.map(text)).toEqual([null, 'Unavailable', 'Entity not found']);
    });
  }
});
