import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import type { ChartdeckCard } from '../src/chartdeck-card';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';

async function size(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as ChartdeckCard;
  card.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
  card.hass = makeHass({});
  document.body.appendChild(card);
  await card.updateComplete;
  return card.getCardSize();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('masonry height when columns drop', () => {
  it('counts the columns that fit a typical masonry card (about 400 px), not the configured maximum', async () => {
    const six = ['sensor.a', 'sensor.b', 'sensor.c', 'sensor.d', 'sensor.e', 'sensor.f'];
    // Bars need 160 px: 6 columns can't fit in ~368 px of content, 2 can -> 3 rows of 46 px.
    // 16 padding + 3 x 46 = 154 -> 4 rows of 50 (was 1 row: 62 -> 2).
    expect(await size({ style: 'bar', columns: 6, entities: six })).toBe(4);
    // Columns that do fit are kept: 2 bar columns -> 3 rows as well, against 6 rows for 1 column.
    expect(await size({ style: 'bar', columns: 2, entities: six })).toBe(4);
    expect(await size({ style: 'bar', columns: 1, entities: six })).toBe(Math.ceil((16 + 6 * 46) / 50));
  });

  it('counts the gauges that fit when no columns are set', async () => {
    // Rings need 128 px: 2 fit a ~368 px masonry card, so 3 rings take 2 rows of 155 px, not 1.
    expect(await size({ style: 'ring', entities: ['sensor.a', 'sensor.b', 'sensor.c'] })).toBe(
      Math.ceil((16 + 2 * 155) / 50),
    );
  });
});
