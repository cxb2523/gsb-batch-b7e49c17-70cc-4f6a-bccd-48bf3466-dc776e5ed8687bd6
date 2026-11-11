import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

/**
 * Wave 3 options that act on the same series, together: unit conversion first, then the series'
 * condition (`when`), then its transform (running total), then grouping and error bars.
 */

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass() {
  const h = makeHass({
    'sensor.power': ['3', { friendly_name: 'Power', unit_of_measurement: 'kW' }],
    'person.john': ['home', { friendly_name: 'John' }],
  });
  h.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    const ids = msg.entity_ids as string[];
    if (ids.includes('person.john')) {
      return {
        'person.john': [
          { s: 'away', lu: sec(30 * H) },
          { s: 'home', lu: sec(20 * H) },
          { s: 'away', lu: sec(12 * H) },
          { s: 'home', lu: sec(4 * H) },
        ],
      };
    }
    return {
      'sensor.power': [
        { s: '1', lu: sec(23 * H) },
        { s: '9', lu: sec(16 * H) },
        { s: '30', lu: sec(8 * H) },
        { s: '3', lu: sec(2 * H) },
      ],
    };
  }) as HomeAssistant['callWS'];
  return h;
}

async function mount(config: Record<string, unknown>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', period: { last: 24, unit: 'hour' }, ...config } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  for (let i = 0; i < 4; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await card.updateComplete;
  return card;
}

const header = (card: Card) =>
  card.shadowRoot!.querySelector('.series-value')!.textContent!.replace(/\s+/g, ' ').trim();
const digits = (text: string) => Number(text.replace(/[^\d]/g, ''));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('unit conversion, a condition and a running total on one series', () => {
  it('converts, keeps only the time the condition held, then totals in the shown unit', async () => {
    const card = await mount({
      style: 'line',
      entities: [
        {
          entity: 'sensor.power',
          unit: 'W',
          decimals: 0,
          transform: 'cumulative',
          when: { entity: 'person.john', state: 'home' },
        },
      ],
    });
    // Home 20 h to 12 h ago (1 kW for 4 h, 9 kW for 4 h) and from 4 h ago (30 kW for 2 h, 3 kW for
    // 2 h): 106 kWh, shown as Wh because the readings were converted to W before the total.
    const text = header(card);
    expect(text).toContain('Wh');
    // The last reading counts on to now, so a slow run adds a few Wh: allow 10 s of 3000 W.
    expect(Math.abs(digits(text) - 106_000)).toBeLessThanOrEqual(10);
  });

  it('totals every reading without the condition', async () => {
    const card = await mount({
      style: 'line',
      entities: [{ entity: 'sensor.power', unit: 'kW', decimals: 0, transform: 'cumulative' }],
    });
    // From 24 h ago: 1 kW for 7 h, 9 kW for 8 h, 30 kW for 6 h, 3 kW for 2 h = 7 + 72 + 180 + 6.
    expect(digits(header(card))).toBe(265);
  });
});
