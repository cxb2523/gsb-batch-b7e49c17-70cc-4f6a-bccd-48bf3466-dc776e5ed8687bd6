import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { parseBearing, normalizeDegrees } from '../src/history/bearing';
import { key, loadHistory, parseHistory } from '../src/history/fetch';
import { HistoryStore } from '../src/history/store';
import {
  bandIndex,
  pairWind,
  petalPath,
  polarPoint,
  ringSteps,
  sectorName,
  sectorOf,
  speedDefaults,
  strongest,
  windRose,
} from '../src/chart/wind';
import { STYLES } from '../src/styles/index';
import { windPeriod, windSectors } from '../src/styles/wind-rose';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
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
await import('../src/editor/chartdeck-card-editor');

const M = 60_000;
const H = 3_600_000;

describe('wind direction parsing', () => {
  it('reads degrees, folding them into 0–360', () => {
    expect(parseBearing('225')).toBe(225);
    expect(parseBearing(' 225.5 ° ')).toBe(225.5);
    expect(parseBearing(360)).toBe(0);
    expect(parseBearing(-90)).toBe(270);
    expect(parseBearing('725')).toBe(5);
    expect(normalizeDegrees(-0.0)).toBe(0);
  });

  it('reads compass points in any case, and full names', () => {
    expect(parseBearing('N')).toBe(0);
    expect(parseBearing('nne')).toBe(22.5);
    expect(parseBearing('SW')).toBe(225);
    expect(parseBearing('wsw')).toBe(247.5);
    expect(parseBearing('NNW')).toBe(337.5);
    expect(parseBearing('North-East')).toBe(45);
    expect(parseBearing('south west')).toBe(225);
    expect(parseBearing('West')).toBe(270);
  });

  it('ignores what it cannot read', () => {
    for (const raw of ['unavailable', 'unknown', '', 'variable', 'NX', null, undefined, NaN, {}]) {
      expect(parseBearing(raw)).toBeNull();
    }
  });

  it('loads a direction series as bearings, under its own key', async () => {
    expect(
      parseHistory(
        [
          { s: 'SW', lu: 1 },
          { s: 'calm', lu: 2 },
        ],
        undefined,
        false,
        parseBearing,
      ),
    ).toEqual([
      { t: 1000, v: 225 },
      { t: 2000, v: null },
    ]);
    expect(key({ entity: 'sensor.d', bearing: true })).toBe('sensor.d#bearing');
    const hass = makeHass({});
    hass.callWS = vi.fn(async () => ({ 'sensor.d': [{ s: 'NE', lu: 1 }] })) as HomeAssistant['callWS'];
    const out = await loadHistory(hass, [{ entity: 'sensor.d', bearing: true }, { entity: 'sensor.d' }], {
      start: 0,
      end: 2000,
    });
    expect(out.get('sensor.d#bearing')).toEqual([{ t: 1000, v: 45 }]);
    expect(out.get('sensor.d')).toEqual([{ t: 1000, v: null }]);
  });

  it('appends live compass states as bearings', async () => {
    const hass = makeHass({ 'sensor.d': 'N' });
    hass.callWS = vi.fn(async () => ({ 'sensor.d': [{ s: 'N', lu: 1 }] })) as HomeAssistant['callWS'];
    const store = new HistoryStore(() => undefined);
    const req = [{ entity: 'sensor.d', bearing: true }];
    store.get(hass, req, { start: 0, end: Date.now() }, 'history');
    await new Promise((r) => setTimeout(r, 0));
    const next = {
      ...hass,
      states: {
        'sensor.d': { entity_id: 'sensor.d', state: 'ssw', attributes: {}, last_updated: new Date().toISOString() },
      },
    };
    const got = store.get(next, req, { start: 0, end: Date.now() }, 'history');
    expect(got.data.get('sensor.d#bearing')!.map((p) => p.v)).toEqual([0, 202.5]);
  });
});

describe('wind rose sectors', () => {
  it('centres sector i on i × 360 / n, north running 348.75 up to 11.25', () => {
    expect(sectorOf(0, 16)).toBe(0);
    expect(sectorOf(360, 16)).toBe(0);
    expect(sectorOf(348.75, 16)).toBe(0);
    expect(sectorOf(348.7, 16)).toBe(15);
    expect(sectorOf(11.2, 16)).toBe(0);
    expect(sectorOf(11.25, 16)).toBe(1);
    expect(sectorOf(247.5, 16)).toBe(11);
    expect(sectorOf(-10, 16)).toBe(0);
    expect(sectorOf(337.5, 8)).toBe(0);
    expect(sectorOf(337.4, 8)).toBe(7);
    expect(sectorOf(225, 4)).toBe(3);
    expect(sectorOf(224.9, 4)).toBe(2);
  });

  it('names sectors for 16, 8 and 4', () => {
    expect(sectorName(11, 16)).toBe('WSW');
    expect(sectorName(5, 8)).toBe('SW');
    expect(sectorName(3, 4)).toBe('W');
  });
});

describe('pairing direction with speed', () => {
  it('weights by how long each pair held, on the union of change times', () => {
    // Direction changes at 0 and 30 min; speed at 0, 10 and 50 min; until 60 min.
    const dir = [
      { t: 0, v: 270 },
      { t: 30 * M, v: 180 },
    ];
    const speed = [
      { t: 0, v: 2 },
      { t: 10 * M, v: 8 },
      { t: 50 * M, v: 12 },
    ];
    expect(pairWind(dir, speed, 60 * M)).toEqual([
      { dir: 270, speed: 2, ms: 10 * M },
      { dir: 270, speed: 8, ms: 20 * M },
      { dir: 180, speed: 8, ms: 20 * M },
      { dir: 180, speed: 12, ms: 10 * M },
    ]);
  });

  it('counts time, not rows: a gusty minute of many readings weighs a minute', () => {
    const dir = [
      { t: 0, v: 90 },
      { t: 59 * M, v: 270 },
    ];
    // Ten readings from the west in the last minute, one steady hour from the east before.
    const speed = [{ t: 0, v: 5 }, ...Array.from({ length: 10 }, (_, i) => ({ t: 59 * M + i * 6000, v: 10 + i }))];
    const rose = windRose(pairWind(dir, speed, 60 * M), 4, [0, 9]);
    expect(rose.totals[1]).toBeCloseTo(59 / 60);
    expect(rose.totals[3]).toBeCloseTo(1 / 60);
    expect(rose.prevailing).toBe(1);
  });

  it('drops gaps in either series, and merges repeats', () => {
    const dir = [
      { t: 0, v: 0 },
      { t: 10 * M, v: null },
      { t: 20 * M, v: 0 },
    ];
    const speed = [
      { t: 0, v: 4 },
      { t: 25 * M, v: null },
      { t: 28 * M, v: 4 },
    ];
    // 0–10 min, then 20–25 and 28–30: the same pair, so one sample of 17 minutes.
    expect(pairWind(dir, speed, 30 * M)).toEqual([{ dir: 0, speed: 4, ms: 17 * M }]);
    expect(
      pairWind(
        [
          { t: 0, v: 90 },
          { t: 5 * M, v: 90 },
        ],
        undefined,
        10 * M,
      ),
    ).toEqual([{ dir: 90, speed: null, ms: 10 * M }]);
    expect(pairWind([], [{ t: 0, v: 3 }], 10 * M)).toEqual([]);
  });

  it('holds a statistics row only for its own period', () => {
    const dir = [
      { t: 0, v: 90 },
      { t: 3 * H, v: 90 },
    ];
    // Hours 0 and 3 count; the two missing hours between don't.
    expect(pairWind(dir, undefined, 4 * H, H)).toEqual([{ dir: 90, speed: null, ms: 2 * H }]);
  });
});

describe('wind rose numbers', () => {
  it('has unit defaults: m/s bands, Beaufort-ish for km/h, mph and knots, calm 0.5 m/s', () => {
    expect(speedDefaults('m/s')).toEqual({ from: [0, 3, 6, 9, 12], calm: 0.5 });
    expect(speedDefaults('km/h')).toEqual({ from: [0, 12, 20, 29, 39], calm: 1.8 });
    expect(speedDefaults('mph').from).toEqual([0, 8, 13, 19, 25]);
    expect(speedDefaults('kn').from).toEqual([0, 7, 11, 17, 22]);
    expect(speedDefaults('Knots').calm).toBe(1);
    expect(speedDefaults('ft/s').from).toEqual([0, 10, 20, 30, 40]);
    expect(speedDefaults(undefined)).toEqual(speedDefaults('m/s'));
    expect(speedDefaults('kph')).toEqual(speedDefaults('km/h'));
  });

  it('bins speeds into bands', () => {
    const from = [0, 3, 6, 9, 12];
    expect(bandIndex(0, from)).toBe(0);
    expect(bandIndex(2.99, from)).toBe(0);
    expect(bandIndex(3, from)).toBe(1);
    expect(bandIndex(30, from)).toBe(4);
    expect(bandIndex(-1, [2, 5])).toBe(0);
  });

  it('counts calm apart from the petals, as a share of all the time', () => {
    const rose = windRose(
      [
        { dir: 0, speed: 0.2, ms: 10 },
        { dir: 270, speed: 4, ms: 60 },
        { dir: 270, speed: 13, ms: 20 },
        { dir: 90, speed: 7, ms: 10 },
      ],
      16,
      [0, 3, 6, 9, 12],
      0.5,
    );
    expect(rose.total).toBe(100);
    expect(rose.calm).toBeCloseTo(0.1);
    expect(rose.totals[0]).toBe(0);
    expect(rose.sectors[12]).toEqual([0, 0.6, 0, 0, 0.2]);
    expect(rose.totals[4]).toBeCloseTo(0.1);
    expect(rose.prevailing).toBe(12);
    expect(rose.meanSpeed).toBeCloseTo((0.2 * 10 + 4 * 60 + 13 * 20 + 7 * 10) / 100);
    const still = windRose([], 8, [0]);
    expect(still.prevailing).toBe(-1);
    expect(still.meanSpeed).toBeNull();
    expect(still.calm).toBe(0);
  });

  it('finds the strongest speed, from statistics max when there is one', () => {
    expect(
      strongest([
        { t: 0, v: 3 },
        { t: 1, v: null },
        { t: 2, v: 9 },
      ]),
    ).toBe(9);
    expect(strongest([{ t: 0, v: 3, max: 14 }])).toBe(14);
    expect(strongest([])).toBeNull();
  });

  it('picks round ring steps', () => {
    expect(ringSteps(11)).toEqual([5, 10, 15]);
    expect(ringSteps(12)).toEqual([5, 10, 15]);
    expect(ringSteps(6.5)).toEqual([2.5, 5, 7.5]);
    expect(ringSteps(100)).toEqual([50, 100]);
    expect(ringSteps(0.9)).toEqual([0.5, 1]);
    expect(ringSteps(0)).toEqual([]);
  });

  it('draws petals clockwise from north', () => {
    expect(polarPoint(10, Math.PI / 2)).toEqual([10, 0]);
    expect(petalPath(0, 10, 0, Math.PI / 2)).toBe('M0 -10A10 10 0 0 1 10 0L0 0Z');
    expect(petalPath(5, 10, 0, Math.PI / 2)).toBe('M0 -10A10 10 0 0 1 10 0L5 0A5 5 0 0 0 0 -5Z');
    expect(petalPath(10, 10, 0, 1)).toBe('');
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

// The fixture is relative to the moment the file loads and the shares are of time up to the moment it renders, so seconds passing
// between the two shrink them. Pin the clock; only Date is faked, timers stay real.
const now = new Date(2026, 10, 7, 15, 0, 0).getTime();
const sec = (msAgo: number) => (now - msAgo) / 1000;
const D = 24 * H;

function windHass(history: Record<string, { s: string; lu: number }[]>, fail = false, extra = {}) {
  const hass = makeHass({
    'sensor.dir': ['250', { friendly_name: 'Direction', unit_of_measurement: '°' }],
    'sensor.compass': ['SW', { friendly_name: 'Compass' }],
    'sensor.speed': ['7', { friendly_name: 'Speed', unit_of_measurement: 'm/s' }],
    'sensor.kmh': ['20', { friendly_name: 'Speed', unit_of_measurement: 'km/h' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off', unit_of_measurement: 'm/s' }],
    ...extra,
  });
  hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    if (fail) throw new Error('boom');
    if (msg.type === 'recorder/statistics_during_period') {
      return {
        'sensor.dir': [
          { start: now - 3 * H, mean: 270, max: 270 },
          { start: now - 2 * H, mean: 90, max: 90 },
        ],
        'sensor.speed': [
          { start: now - 3 * H, mean: 8, max: 20 },
          { start: now - 2 * H, mean: 4, max: 6 },
        ],
      };
    }
    return history;
  }) as HomeAssistant['callWS'];
  return hass;
}

// 10 days of WSW at 8 m/s, 2 of calm, 2 from the east at 4 m/s.
const history = {
  'sensor.dir': [
    { s: '250', lu: sec(14 * D) },
    { s: '90', lu: sec(4 * D) },
    { s: '0', lu: sec(2 * D) },
  ],
  'sensor.compass': [
    { s: 'WSW', lu: sec(14 * D) },
    { s: 'e', lu: sec(4 * D) },
    { s: 'N', lu: sec(2 * D) },
  ],
  'sensor.speed': [
    { s: '8', lu: sec(14 * D) },
    { s: '4', lu: sec(4 * D) },
    { s: '0.1', lu: sec(2 * D) },
  ],
  'sensor.kmh': [
    { s: '30', lu: sec(14 * D) },
    { s: '1', lu: sec(2 * D) },
  ],
  'sensor.off': [{ s: 'unavailable', lu: sec(14 * D) }],
};

async function mount(config: Partial<CardConfig>, hass = windHass(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'wind_rose',
    entities: ['sensor.dir', 'sensor.speed'],
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const stats = (card: Card) =>
  Object.fromEntries(
    qa(card, '.stat').map((e) => [
      e.querySelector('.stat-label')!.textContent!.trim(),
      e.querySelector('.stat-value')!.textContent!.trim(),
    ]),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('wind rose card', () => {
  it('is in the Distributions group and loads the last 30 days by default', async () => {
    expect(STYLES.wind_rose.group).toBe('distribution');
    const card = await mount({});
    const msg = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, string>;
    const days = (Date.parse(msg.end_time) - Date.parse(msg.start_time)) / D;
    expect(days).toBeCloseTo(30, 1);
    expect(msg.entity_ids).toEqual(['sensor.dir', 'sensor.speed']);
  });

  it('draws petals stacked by speed band, the readout and the legend', async () => {
    const card = await mount({});
    const petals = qa(card, '.petal');
    // WSW, E and (calm, so no) N.
    expect(petals.map((p) => p.getAttribute('data-sector'))).toEqual(['4', '11']);
    expect(petals.every((p) => p.classList.contains('entity') && p.getAttribute('data-index') === '0')).toBe(true);
    expect(petals[1].querySelectorAll('path')).toHaveLength(1);
    expect(stats(card)).toEqual({
      Prevailing: 'WSW · 71%',
      'Mean speed': '6.3 m/s',
      Strongest: '8.0 m/s',
      Calm: '14%',
    });
    expect(qa(card, '.key-label').map((e) => e.textContent)).toEqual(['0–3', '3–6', '6–9', '9–12', '12+']);
    expect(q(card, '.speed-legend .stat-label')!.textContent).toBe('Speed (m/s)');
    expect(q(card, 'svg.rose')!.getAttribute('role')).toBe('img');
    expect(q(card, 'svg.rose')!.getAttribute('aria-label')).toBe('Wind rose, prevailing WSW 71%, calm 14%');
    expect(qa(card, '.ring-label').map((e) => e.textContent)).toEqual(['25%', '50%', '75%']);
    expect(qa(card, '.compass').map((e) => e.textContent)).toEqual(['N', 'E', 'S', 'W']);
    expect(q(card, '.stat-mean')!.getAttribute('data-index')).toBe('1');
  });

  it('reads compass points, 8 sectors and km/h bands', async () => {
    const card = await mount({ entities: ['sensor.compass', 'sensor.kmh'], sectors: 8 } as Partial<CardConfig>);
    expect(qa(card, '.petal').map((p) => p.getAttribute('data-sector'))).toEqual(['2', '6']);
    expect(qa(card, '.key-label').map((e) => e.textContent)).toEqual(['0–12', '12–20', '20–29', '29–39', '39+']);
    expect(stats(card).Prevailing).toBe('W · 71%');
  });

  it('uses the card colour bands for speed when set', async () => {
    const card = await mount({
      severity: [
        { from: 0, color: 'green' },
        { from: 5, color: 'red', label: 'Windy' },
      ],
    } as Partial<CardConfig>);
    expect(qa(card, '.key-label').map((e) => e.textContent)).toEqual(['0–5', 'Windy']);
    expect((q(card, '.key-swatch') as HTMLElement).style.background).toContain('--success-color');
  });

  it('draws directions only without a speed, or when the speed has no readings', async () => {
    for (const entities of [['sensor.dir'], ['sensor.dir', 'sensor.off'], ['sensor.dir', 'sensor.gone']]) {
      const card = await mount({ entities } as Partial<CardConfig>);
      expect(Object.keys(stats(card))).toEqual(['Prevailing']);
      expect(q(card, '.speed-legend')).toBeNull();
      expect(qa(card, '.petal').map((p) => p.getAttribute('data-sector'))).toEqual(['0', '4', '11']);
      expect(q(card, 'svg.rose')!.getAttribute('aria-label')).toMatch(/^Wind rose, prevailing WSW 71%$/);
    }
  });

  it('says when loading, failed, or there is nothing to draw', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'x', style: 'wind_rose', entities: ['sensor.dir'] } as CardConfig);
    card.hass = windHass(history);
    document.body.appendChild(card);
    await card.updateComplete;
    expect(q(card, '.chart-message')!.textContent).toBe('Loading history…');
    const failed = await mount({}, windHass(history, true));
    expect(q(failed, '.chart-message.error')!.textContent!.trim()).toBe("Couldn't load history: boom");
    const missing = await mount({ entities: ['sensor.nothing', 'sensor.speed'] } as Partial<CardConfig>);
    expect(q(missing, '.chart-message')!.textContent).toBe('No readings in this period.');
    const unreadable = await mount(
      { entities: ['sensor.dir'] } as Partial<CardConfig>,
      windHass({ 'sensor.dir': [{ s: 'variable', lu: sec(D) }] }),
    );
    expect(q(unreadable, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('shows all calm as an empty rose', async () => {
    const card = await mount(
      {},
      windHass({ 'sensor.dir': [{ s: '10', lu: sec(D) }], 'sensor.speed': [{ s: '0', lu: sec(D) }] }),
    );
    expect(qa(card, '.petal')).toHaveLength(0);
    expect(stats(card).Calm).toBe('100%');
    expect(q(card, 'svg.rose')!.getAttribute('aria-label')).toBe('Wind rose, calm 100%');
  });

  it('keeps roles by listed order when sorted or hiding unavailable', async () => {
    const card = await mount({
      entities: ['sensor.compass', 'sensor.speed'],
      hide_unavailable: true,
      sort: 'descending',
    } as Partial<CardConfig>);
    expect(stats(card).Prevailing).toBe('WSW · 71%');
    // The compass sensor isn't drawn as an entity (it has no number), so its petals don't open it.
    expect(qa(card, '.petal.entity')).toHaveLength(0);
  });

  it('shows a petal’s share and band split on hover or focus', async () => {
    const card = await mount({});
    const petal = q(card, '.petal[data-sector="11"]')!;
    petal.dispatchEvent(new Event('pointerenter'));
    await card.updateComplete;
    expect(q(card, '.rose-tip .tooltip-time')!.textContent).toBe('WSW · 71.4%');
    expect(qa(card, '.rose-tip .tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      '6–9 m/s 71.4%',
    ]);
    expect(q(card, '.rose-tip')!.classList.contains('right')).toBe(true);
    petal.dispatchEvent(new Event('pointerleave'));
    await card.updateComplete;
    expect(q(card, '.rose-tip')).toBeNull();
    const east = q(card, '.petal[data-sector="4"]')!;
    east.dispatchEvent(new Event('focus'));
    await card.updateComplete;
    expect(q(card, '.rose-tip')!.classList.contains('left')).toBe(true);
    east.dispatchEvent(new Event('blur'));
    const off = await mount({ tooltip: false } as Partial<CardConfig>);
    q(off, '.petal')!.dispatchEvent(new Event('pointerenter'));
    await off.updateComplete;
    expect(q(off, '.rose-tip')).toBeNull();
    const only = await mount({ entities: ['sensor.dir'] } as Partial<CardConfig>);
    q(only, '.petal[data-sector="11"]')!.dispatchEvent(new Event('pointerenter'));
    await only.updateComplete;
    expect(q(only, '.rose-tip .tooltip-name')!.textContent).toBe('Of the time');
  });

  it('opens the direction from a petal and the speed from its readout', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    for (const el of [q(card, '.petal')!, q(card, '.stat-strongest')!]) {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    }
    expect(fired).toEqual(['sensor.dir', 'sensor.speed']);
  });

  it('reads hourly statistics, with the speed max as the strongest', async () => {
    const card = await mount({ source: 'statistics', compact: true } as Partial<CardConfig>);
    const msg = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(msg.period).toBe('hour');
    expect(msg.types).toEqual(['mean', 'max']);
    expect(stats(card)).toMatchObject({ Prevailing: 'E · 50%', Strongest: '20.0 m/s', 'Mean speed': '6.0 m/s' });
    expect(q(card, '.frame.compact')).not.toBeNull();
  });

  it('steps back a period with the buttons', async () => {
    const card = await mount({ period: { calendar: 'week', navigate: true } } as Partial<CardConfig>);
    expect(q(card, '.period-label')!.textContent).toBe('This week');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'wind_rose', entities: ['sensor.dir'], ...extra } as CardConfig);
    expect(set({ sectors: 12 })).toThrow('"sectors" must be one of: 4, 8, 16');
    expect(set({ calm: -1 })).toThrow(/calm/);
    expect(set({ calm: 'still' })).toThrow(/calm/);
    expect(set({ period: { last: 0 } })).toThrow(/period/);
    expect(set({ period: 'week' })).toThrow(/period/);
    expect(set({ tooltip: 'yes' })).toThrow(/tooltip/);
    expect(set({ sectors: '8', calm: '1' })).not.toThrow();
    expect(windSectors({ type: 'x', sectors: '4' })).toBe(4);
    expect(windPeriod({ type: 'x', period: { last: 7 } })).toMatchObject({ last: 7, unit: 'day' });
  });

  it('pauses on disconnect', async () => {
    const card = await mount({});
    card.remove();
    expect(q(card, '.petal')).not.toBeNull();
  });
});

describe('wind rose editor', () => {
  it('says which entity is which, and writes period, sectors and calm', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = windHass(history);
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'wind_rose',
      entities: ['sensor.dir', { entity: 'sensor.speed', name: 'Gusts' }],
      sectors: 8,
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('.wind-roles')!.textContent).toContain('Direction: Direction. Speed: Gusts.');
    expect(ed.shadowRoot!.querySelector('.wind-statistics')).toBeNull();
    expect(
      ed
        .shadowRoot!.querySelector('button[data-style="wind_rose"]')!
        .closest('[data-group]')!
        .getAttribute('data-group'),
    ).toBe('distribution');
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      period_calendar: 'rolling',
      period_last: 30,
      period_unit: 'day',
      period_offset: 0,
      period_until: 'now',
      period_navigate: false,
      source: 'history',
      sectors: '8',
      tooltip: true,
      compact: false,
    });
    const names = JSON.stringify(form.schema);
    expect(names).not.toContain('group_by');
    expect(names).toContain('"calm"');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), sectors: '16', period_last: 7, calm: 1 } },
      }),
    );
    const rest: CardConfig = { ...raw };
    delete rest.sectors;
    expect(events.at(-1)).toEqual({ ...rest, period: { last: 7 }, calm: 1 });
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), sectors: '4' } } }),
    );
    expect(events.at(-1)!.sectors).toBe(4);
  });

  it('warns about statistics and names a missing speed', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = windHass(history);
    ed.setConfig({ type: 'x', style: 'wind_rose', source: 'statistics', entities: ['sensor.nowhere'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('.wind-roles')!.textContent).toContain(
      'Direction: sensor.nowhere. Speed: none.',
    );
    expect(ed.shadowRoot!.querySelector('.wind-statistics')!.textContent).toContain('measurement_angle');
  });
});
